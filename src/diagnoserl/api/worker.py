"""Background worker: executes queued training experiments and evaluation runs.

Jobs are rows in the database (durable). The API only enqueues; this process claims a job
with an atomic ``UPDATE ... WHERE status = 'queued'``, runs it, and records the outcome.
On start-up, jobs left in ``running`` by a crashed worker are marked ``failed``.

Run: ``python -m diagnoserl.api.worker``
"""

from __future__ import annotations

import argparse
import json
import logging
import time
import traceback
from pathlib import Path
from typing import Any, cast

from sqlalchemy import CursorResult, select, update
from sqlalchemy.orm import Session, sessionmaker

from diagnoserl.api import orm
from diagnoserl.api.database import make_engine, make_session_factory, session_scope
from diagnoserl.api.services.engine import ScenarioRegistry
from diagnoserl.api.services.experiments import ExperimentService
from diagnoserl.api.services.registry import ModelRegistry, audit
from diagnoserl.api.settings import Settings, get_settings
from diagnoserl.logging_config import configure_logging

log = logging.getLogger(__name__)


class Worker:
    def __init__(self, settings: Settings, factory: sessionmaker[Session] | None = None) -> None:
        self.settings = settings
        if factory is None:
            engine = make_engine(settings.database_url)
            if settings.environment == "dev":
                orm.Base.metadata.create_all(engine)
            factory = make_session_factory(engine)
        self.factory = factory
        scenarios = ScenarioRegistry()
        self.registry = ModelRegistry(settings.artifact_dir, scenarios)
        self.experiments = ExperimentService(settings, scenarios)

    # ---------------------------------------------------------------- queue
    def recover(self) -> int:
        """Mark jobs orphaned by a previous worker as failed."""
        n = 0
        with session_scope(self.factory) as db:
            for cls in (orm.TrainingExperiment, orm.EvaluationRun):
                res = db.execute(
                    update(cls)
                    .where(cls.status == "running")
                    .values(
                        status="failed",
                        error="worker restarted while the job was running",
                        finished_at=orm.utcnow(),
                    )
                )
                n += cast(CursorResult[Any], res).rowcount or 0
        return n

    def _claim(self, cls: Any) -> Any:
        with session_scope(self.factory) as db:
            row = db.execute(
                select(cls).where(cls.status == "queued").order_by(cls.created_at).limit(1)
            ).scalar_one_or_none()
            if row is None:
                return None
            res = db.execute(
                update(cls)
                .where(cls.id == row.id, cls.status == "queued")
                .values(status="running", started_at=orm.utcnow())
            )
            return row.id if cast(CursorResult[Any], res).rowcount == 1 else None

    def run_one(self) -> bool:
        """Process at most one job; returns whether any job was run."""
        exp_id = self._claim(orm.TrainingExperiment)
        if exp_id is not None:
            self._run_training(exp_id)
            return True
        eval_id = self._claim(orm.EvaluationRun)
        if eval_id is not None:
            self._run_evaluation(eval_id)
            return True
        return False

    # ----------------------------------------------------------------- jobs
    def _run_training(self, exp_id: Any) -> None:
        from diagnoserl.training.config import TrainConfig
        from diagnoserl.training.train import train

        with session_scope(self.factory) as db:
            exp = db.get(orm.TrainingExperiment, exp_id)
            assert exp is not None
            cfg = TrainConfig.model_validate(exp.config)
        log.info(
            "training started", extra={"experiment": str(exp_id), "run": cfg.resolved_run_name}
        )
        try:
            train(cfg)
        except Exception:
            self._finish(orm.TrainingExperiment, exp_id, "failed", traceback.format_exc(limit=3))
            log.exception("training failed", extra={"experiment": str(exp_id)})
            return
        with session_scope(self.factory) as db:
            exp = db.get(orm.TrainingExperiment, exp_id)
            assert exp is not None
            try:
                version = self.registry.register_run(db, exp.run_name, "best", experiment_id=exp.id)
                audit(db, "worker", "model.register", str(version.id), {"experiment": str(exp.id)})
            except Exception:
                exp.error = "training succeeded but model registration failed"
            exp.status = "succeeded"
            exp.finished_at = orm.utcnow()
        log.info("training finished", extra={"experiment": str(exp_id)})

    def _run_evaluation(self, eval_id: Any) -> None:
        from diagnoserl.evaluation.run import run as run_evaluation

        with session_scope(self.factory) as db:
            ev = db.get(orm.EvaluationRun, eval_id)
            assert ev is not None
            params = dict(ev.params)
        rel_out = f"eval/{eval_id}"
        args = argparse.Namespace(
            runs=[str(self.settings.runs_dir / r) for r in params["run_names"]],
            out=str(self.settings.artifact_dir / rel_out),
            model=params["model"],
            n_test=params["n_test"],
            n_val=params["n_val"],
            n_robust=params["n_robust"],
            skip_robustness=params["skip_robustness"],
        )
        try:
            run_evaluation(args)
            results = json.loads((Path(args.out) / "results.json").read_text(encoding="utf-8"))
        except Exception:
            self._finish(orm.EvaluationRun, eval_id, "failed", traceback.format_exc(limit=3))
            log.exception("evaluation failed", extra={"evaluation": str(eval_id)})
            return
        with session_scope(self.factory) as db:
            ev = db.get(orm.EvaluationRun, eval_id)
            assert ev is not None
            self.experiments.record_metrics(db, ev, results)
            ev.results_dir = rel_out
            ev.status = "succeeded"
            ev.finished_at = orm.utcnow()

    def _finish(self, cls: Any, job_id: Any, status: str, error: str | None) -> None:
        with session_scope(self.factory) as db:
            row = db.get(cls, job_id)
            if row is not None:
                row.status = status
                row.error = error
                row.finished_at = orm.utcnow()

    def loop(self) -> None:  # pragma: no cover - long-running
        recovered = self.recover()
        if recovered:
            log.warning("recovered orphaned jobs", extra={"count": recovered})
        while True:
            if not self.run_one():
                time.sleep(self.settings.worker_poll_seconds)


def main() -> None:  # pragma: no cover
    configure_logging()
    Worker(get_settings()).loop()


if __name__ == "__main__":
    main()
