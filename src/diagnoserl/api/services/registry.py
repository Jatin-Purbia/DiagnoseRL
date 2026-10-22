"""Model registry: registration, validation and activation of trained checkpoints."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from diagnoserl.api import orm
from diagnoserl.api.errors import ApiError, bad_request, conflict, not_found
from diagnoserl.api.services.engine import ScenarioRegistry, resolve_artifact, sha256_file
from diagnoserl.env import DiagnoseRLEnv, RewardConfig
from diagnoserl.training.config import TrainConfig


def audit(
    db: Session, actor: str, action: str, target: str, detail: dict[str, Any] | None = None
) -> None:
    db.add(orm.AuditEvent(actor=actor, action=action, target=target, detail=detail or {}))


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _validation_row(run_dir: Path, checkpoint: str, summary: dict[str, Any]) -> dict[str, Any]:
    """Validation metrics belonging to the chosen checkpoint (best = max reward row)."""
    rows = [
        json.loads(line)
        for line in (run_dir / "metrics.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not rows:
        return {}
    if checkpoint == "best":
        return max(rows, key=lambda r: r["mean_reward"])
    return rows[-1] if rows else dict(summary.get("final_val", {}))


class ModelRegistry:
    def __init__(self, artifact_dir: Path, scenarios: ScenarioRegistry) -> None:
        self.artifact_dir = artifact_dir
        self.runs_dir = artifact_dir / "runs"
        self.scenarios = scenarios

    def register_run(
        self,
        db: Session,
        run_name: str,
        checkpoint: str = "best",
        *,
        experiment_id: uuid.UUID | None = None,
    ) -> orm.ModelVersion:
        run_dir = resolve_artifact(self.artifact_dir, f"runs/{run_name}")
        ckpt = run_dir / f"{checkpoint}_model.zip"
        if not (run_dir / "config.json").is_file() or not ckpt.is_file():
            raise not_found("training run / checkpoint", f"{run_name}:{checkpoint}")
        name = f"{run_name}:{checkpoint}"
        existing = db.execute(
            select(orm.ModelVersion).where(orm.ModelVersion.name == name)
        ).scalar_one_or_none()
        if existing is not None:
            return existing  # idempotent
        cfg = TrainConfig.model_validate(_read_json(run_dir / "config.json"))
        summary = (
            _read_json(run_dir / "summary.json") if (run_dir / "summary.json").is_file() else {}
        )
        scenario_name = cfg.load_scenario().name
        version = orm.ModelVersion(
            name=name,
            scenario=scenario_name,
            experiment_id=experiment_id,
            artifact_path=str(ckpt.relative_to(self.artifact_dir.resolve())).replace("\\", "/"),
            sha256=sha256_file(ckpt),
            include_posterior=cfg.include_posterior,
            seed=cfg.seed,
            metrics={
                "checkpoint": checkpoint,
                "validation": _validation_row(run_dir, checkpoint, summary),
            },
        )
        db.add(version)
        db.flush()
        return version

    def get(self, db: Session, version_id: uuid.UUID) -> orm.ModelVersion:
        version = db.get(orm.ModelVersion, version_id)
        if version is None:
            raise not_found("model", version_id)
        return version

    def list_models(self, db: Session) -> list[orm.ModelVersion]:
        return list(
            db.execute(
                select(orm.ModelVersion).order_by(orm.ModelVersion.created_at.desc())
            ).scalars()
        )

    def validate(self, version: orm.ModelVersion) -> list[str]:
        """Return a list of problems that block activation (empty = valid)."""
        problems: list[str] = []
        try:
            path = resolve_artifact(self.artifact_dir, version.artifact_path)
        except ApiError as exc:
            return [exc.message]
        if not path.is_file():
            return ["checkpoint file is missing"]
        if sha256_file(path) != version.sha256:
            problems.append("checkpoint hash does not match the registered hash")
        if version.scenario not in self.scenarios.names():
            problems.append(f"unknown scenario {version.scenario!r}")
        if not version.metrics.get("validation"):
            problems.append("model has no recorded validation metrics")
        if problems:
            return problems
        # Compatibility: load the (trusted, in-artifact-dir, hash-verified) checkpoint and
        # check that its spaces match the scenario environment.
        from sb3_contrib import MaskablePPO

        model = self.scenarios.model(version.scenario)
        env = DiagnoseRLEnv(model, RewardConfig(), include_posterior=version.include_posterior)
        try:
            loaded = MaskablePPO.load(str(path), device="cpu")
        except Exception as exc:  # pragma: no cover - corrupt zip etc.
            return [f"checkpoint cannot be loaded: {type(exc).__name__}"]
        if loaded.observation_space.shape != env.observation_space.shape:
            problems.append("observation space does not match the scenario")
        if loaded.action_space.n != env.action_space.n:  # type: ignore[attr-defined]
            problems.append("action space does not match the scenario")
        return problems

    def activate(self, db: Session, version_id: uuid.UUID, actor: str) -> orm.ModelVersion:
        version = self.get(db, version_id)
        problems = self.validate(version)
        if problems:
            raise bad_request("model_invalid", "model failed validation", problems=problems)
        db.execute(
            update(orm.ModelVersion)
            .where(orm.ModelVersion.scenario == version.scenario, orm.ModelVersion.id != version.id)
            .values(is_active=False)
        )
        version.is_active = True
        audit(
            db,
            actor,
            "model.activate",
            str(version.id),
            {"name": version.name, "scenario": version.scenario},
        )
        db.flush()
        return version

    def deactivate(self, db: Session, version_id: uuid.UUID, actor: str) -> orm.ModelVersion:
        version = self.get(db, version_id)
        if not version.is_active:
            raise conflict("not_active", "model is not active")
        version.is_active = False
        audit(db, actor, "model.deactivate", str(version.id), {"name": version.name})
        db.flush()
        return version
