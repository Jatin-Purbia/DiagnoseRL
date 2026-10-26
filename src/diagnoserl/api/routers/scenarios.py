"""Scenario catalogue and validation."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from diagnoserl.api import schemas
from diagnoserl.api.deps import get_scenarios
from diagnoserl.api.services.engine import ScenarioRegistry
from diagnoserl.config import ScenarioConfig

router = APIRouter(prefix="/scenarios", tags=["scenarios"])


def _summary(cfg: ScenarioConfig) -> schemas.ScenarioSummary:
    return schemas.ScenarioSummary(
        name=cfg.name,
        description=cfg.description,
        n_faults=sum(1 for f in cfg.faults if f.enabled),
        n_tests=len(cfg.tests),
        max_steps=cfg.max_steps,
    )


@router.get("", response_model=list[schemas.ScenarioSummary])
def list_scenarios(reg: ScenarioRegistry = Depends(get_scenarios)) -> list[schemas.ScenarioSummary]:
    return [_summary(reg.config(n)) for n in reg.names()]


@router.get("/{name}")
def get_scenario(name: str, reg: ScenarioRegistry = Depends(get_scenarios)) -> dict[str, Any]:
    """Faults, tests and the outcome distributions ``P(result | fault, test)``."""
    cfg = reg.config(name)
    model = reg.model(name)
    return {
        **_summary(cfg).model_dump(),
        "outcomes": model.outcome_labels,
        "faults": [
            {
                "id": f.id,
                "name": f.name,
                "description": f.description,
                "category": f.category,
                "prior": float(model.prior[model.fault_ids.index(f.id)]),
            }
            for f in cfg.faults
            if f.enabled
        ],
        "tests": [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "category": t.category,
                "cost": t.cost,
                "duration": t.duration,
                "outcomes": t.outcomes,
                "requires": t.requires,
                # likelihood[fault][outcome] aligned with `faults` and `outcomes`
                "likelihood": model.likelihood[i].tolist(),
            }
            for i, t in enumerate(cfg.tests)
        ],
    }
