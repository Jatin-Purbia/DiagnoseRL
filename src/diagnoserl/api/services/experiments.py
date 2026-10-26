"""Training experiments and evaluation runs (durable jobs executed by the worker)."""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from diagnoserl.api import orm, schemas
from diagnoserl.api.errors import ApiError, bad_request, conflict, not_found
from diagnoserl.api.services.engine import ScenarioRegistry, resolve_artifact
from diagnoserl.api.services.registry import audit
from diagnoserl.api.settings import Settings
from diagnoserl.training.config import TrainConfig

MAX_TIMESTEPS = 5_000_000
MAX_ENVS = 16
ARTIFACT_FILES = (
    "config.json",
    "metrics.jsonl",
    "summary.json",
    "train_metrics.jsonl",
    "train.log",
)
MAX_CURVE_POINTS = 500
FIGURE_RE = re.compile(r"^[A-Za-z0-9_\-]+\.png$")


def _slug(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_\-]+", "-", name).strip("-")[:40] or "experiment"


class ExperimentService:
    def __init__(self, settings: Settings, scenarios: ScenarioRegistry) -> None:
        self.settings = settings
        self.scenarios = scenarios

    # ------------------------------------------------------------- training
    def enqueue_training(
        self, db: Session, req: schemas.TrainingRequest, actor: str
    ) -> orm.TrainingExperiment:
        raw = dict(req.config)
        scenario = raw.get("scenario", "standard")
        if scenario not in self.scenarios.names():  # bundled only: no arbitrary file paths
            raise bad_request(
                "unknown_scenario",
                f"unknown scenario {scenario!r}",
                scenarios=self.scenarios.names(),
            )
        run_name = f"{_slug(req.name)}-{uuid.uuid4().hex[:8]}"
        raw.update(
            run_name=run_name,
            output_dir=str(self.settings.runs_dir),
            mlflow_tracking_uri=f"sqlite:///{self.settings.artifact_dir.as_posix()}/mlflow.db",
        )
        try:
            cfg = TrainConfig.model_validate(raw)
        except ValidationError as exc:
            raise ApiError(
                422,
                "invalid_config",
                "invalid training config",
                {
                    "errors": [
                        {"loc": [str(x) for x in e["loc"]], "msg": e["msg"]} for e in exc.errors()
                    ]
                },
            ) from exc
        if cfg.total_timesteps > MAX_TIMESTEPS or cfg.n_envs > MAX_ENVS:
            raise bad_request(
                "limits_exceeded",
                "config exceeds server limits",
                max_timesteps=MAX_TIMESTEPS,
                max_envs=MAX_ENVS,
            )
        exp = orm.TrainingExperiment(
            name=req.name,
            config=cfg.model_dump(),
            run_name=cfg.resolved_run_name,
            seed=cfg.seed,
            total_timesteps=cfg.total_timesteps,
            requested_by=actor,
        )
        db.add(exp)
        db.flush()
        audit(
            db,
            actor,
            "training.enqueue",
            str(exp.id),
            {"run_name": exp.run_name, "scenario": cfg.scenario},
        )
        return exp

    def get(self, db: Session, exp_id: uuid.UUID) -> orm.TrainingExperiment:
        exp = db.get(orm.TrainingExperiment, exp_id)
        if exp is None:
            raise not_found("experiment", exp_id)
        return exp

    def list_experiments(self, db: Session, limit: int, offset: int) -> schemas.Page:
        total = db.execute(select(func.count()).select_from(orm.TrainingExperiment)).scalar_one()
        rows = db.execute(
            select(orm.TrainingExperiment)
            .order_by(orm.TrainingExperiment.created_at.desc())
            .limit(limit)
            .offset(offset)
        ).scalars()
        return schemas.Page(
            items=[self.out(r) for r in rows], total=total, limit=limit, offset=offset
        )

    def curve(self, exp: orm.TrainingExperiment) -> list[dict[str, Any]]:
        path = self.settings.runs_dir / exp.run_name / "metrics.jsonl"
        if not path.is_file():
            return []
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def training_curve(self, exp: orm.TrainingExperiment) -> list[dict[str, Any]]:
        """PPO's own diagnostics (reward, losses, entropy), thinned to a plottable size.

        Empty for runs trained before telemetry existed (those only have validation metrics).
        """
        path = self.settings.runs_dir / exp.run_name / "train_metrics.jsonl"
        if not path.is_file():
            return []
        rows = [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        if len(rows) > MAX_CURVE_POINTS:
            step = len(rows) / MAX_CURVE_POINTS
            rows = [rows[int(i * step)] for i in range(MAX_CURVE_POINTS)] + [rows[-1]]
        return rows

    def elapsed_seconds(self, exp: orm.TrainingExperiment) -> float | None:
        """Wall-clock time the job has been (or was) running."""
        if exp.started_at is None:
            return None
        end = exp.finished_at or orm.utcnow()
        start = exp.started_at
        if start.tzinfo is None and end.tzinfo is not None:  # SQLite returns naive datetimes
            start = start.replace(tzinfo=end.tzinfo)
        elif end.tzinfo is None and start.tzinfo is not None:
            end = end.replace(tzinfo=start.tzinfo)
        return max(0.0, (end - start).total_seconds())

    def out(self, exp: orm.TrainingExperiment) -> schemas.ExperimentOut:
        curve = self.curve(exp) if exp.status in ("running", "succeeded", "failed") else []
        out = schemas.ExperimentOut.model_validate(exp)
        out.progress_timesteps = int(curve[-1]["timesteps"]) if curve else 0
        return out

    def cancel(self, db: Session, exp_id: uuid.UUID, actor: str) -> orm.TrainingExperiment:
        exp = self.get(db, exp_id)
        if exp.status != "queued":
            raise conflict(
                "not_cancellable", "only queued experiments can be cancelled", status=exp.status
            )
        exp.status = "cancelled"
        audit(db, actor, "training.cancel", str(exp.id))
        return exp

    def artifact_names(self, exp: orm.TrainingExperiment) -> list[str]:
        run_dir = self.settings.runs_dir / exp.run_name
        return [n for n in ARTIFACT_FILES if (run_dir / n).is_file()]

    def artifact_path(self, exp: orm.TrainingExperiment, name: str) -> Path:
        if name not in ARTIFACT_FILES:
            raise not_found("artifact", name)
        path = resolve_artifact(self.settings.artifact_dir, f"runs/{exp.run_name}/{name}")
        if not path.is_file():
            raise not_found("artifact", name)
        return path

    # ----------------------------------------------------------- evaluations
    def enqueue_evaluation(
        self, db: Session, req: schemas.EvaluationRequest, actor: str
    ) -> orm.EvaluationRun:
        for run in req.run_names:
            if not re.fullmatch(r"[A-Za-z0-9_.\-]+", run):
                raise bad_request("invalid_run_name", f"invalid run name {run!r}")
            run_dir = resolve_artifact(self.settings.artifact_dir, f"runs/{run}")
            if not (run_dir / "config.json").is_file():
                raise not_found("training run", run)
        ev = orm.EvaluationRun(params=req.model_dump())
        db.add(ev)
        db.flush()
        audit(db, actor, "evaluation.enqueue", str(ev.id), {"runs": req.run_names})
        return ev

    def get_evaluation(self, db: Session, eval_id: uuid.UUID) -> orm.EvaluationRun:
        ev = db.get(orm.EvaluationRun, eval_id)
        if ev is None:
            raise not_found("evaluation", eval_id)
        return ev

    def list_evaluations(self, db: Session, limit: int, offset: int) -> schemas.Page:
        total = db.execute(select(func.count()).select_from(orm.EvaluationRun)).scalar_one()
        rows = db.execute(
            select(orm.EvaluationRun)
            .order_by(orm.EvaluationRun.created_at.desc())
            .limit(limit)
            .offset(offset)
        ).scalars()
        return schemas.Page(
            items=[schemas.EvaluationOut.model_validate(r) for r in rows],
            total=total,
            limit=limit,
            offset=offset,
        )

    def evaluation_results(self, ev: orm.EvaluationRun) -> dict[str, Any]:
        if ev.status != "succeeded" or not ev.results_dir:
            raise conflict("evaluation_not_ready", "evaluation has not succeeded", status=ev.status)
        path = resolve_artifact(self.settings.artifact_dir, f"{ev.results_dir}/results.json")
        if not path.is_file():
            raise not_found("results", ev.id)
        data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        return data

    def figure_path(self, ev: orm.EvaluationRun, name: str) -> Path:
        if not FIGURE_RE.fullmatch(name) or not ev.results_dir:
            raise not_found("figure", name)
        path = resolve_artifact(self.settings.artifact_dir, f"{ev.results_dir}/figures/{name}")
        if not path.is_file():
            raise not_found("figure", name)
        return path

    def record_metrics(self, db: Session, ev: orm.EvaluationRun, results: dict[str, Any]) -> None:
        """Flatten key results into ``evaluation_metrics`` rows."""
        keys = (
            "accuracy",
            "mean_tests",
            "mean_cost",
            "mean_duration",
            "mean_reward",
            "no_diagnosis_rate",
        )
        for name, entry in results.get("baselines", {}).items():
            ci = entry.get("reward_ci", [None, None])
            for k in keys:
                db.add(
                    orm.EvaluationMetric(
                        evaluation_id=ev.id,
                        policy=name,
                        metric=k,
                        value=float(entry["summary"][k]),
                        ci_low=ci[0] if k == "mean_reward" else None,
                        ci_high=ci[1] if k == "mean_reward" else None,
                    )
                )
        rl = results.get("rl") or {}
        for k, agg in rl.get("aggregate", {}).items():
            if k in keys:
                db.add(
                    orm.EvaluationMetric(
                        evaluation_id=ev.id,
                        policy="ppo",
                        metric=k,
                        value=float(agg["mean"]),
                        ci_low=float(agg["mean"] - agg["std"]),
                        ci_high=float(agg["mean"] + agg["std"]),
                    )
                )
