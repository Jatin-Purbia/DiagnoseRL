"""Training experiments and evaluation runs."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from diagnoserl.api import schemas
from diagnoserl.api.deps import get_db, get_experiments
from diagnoserl.api.security import Actor, rate_limit_expensive, require_admin
from diagnoserl.api.services.experiments import ExperimentService

router = APIRouter(tags=["experiments"])


@router.post(
    "/experiments/training",
    response_model=schemas.ExperimentOut,
    status_code=202,
    dependencies=[Depends(rate_limit_expensive)],
)
def start_training(
    req: schemas.TrainingRequest,
    db: Session = Depends(get_db),
    svc: ExperimentService = Depends(get_experiments),
    actor: Actor = Depends(require_admin),
) -> schemas.ExperimentOut:
    exp = svc.enqueue_training(db, req, actor.name)
    db.commit()
    return svc.out(exp)


@router.get("/experiments", response_model=schemas.Page)
def list_experiments(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    svc: ExperimentService = Depends(get_experiments),
) -> schemas.Page:
    return svc.list_experiments(db, limit, offset)


@router.get("/experiments/{exp_id}")
def get_experiment(
    exp_id: uuid.UUID,
    db: Session = Depends(get_db),
    svc: ExperimentService = Depends(get_experiments),
) -> dict[str, Any]:
    exp = svc.get(db, exp_id)
    return {
        **svc.out(exp).model_dump(mode="json"),
        "validation_curve": svc.curve(exp),
        "training_curve": svc.training_curve(exp),
        "elapsed_seconds": svc.elapsed_seconds(exp),
        "artifacts": svc.artifact_names(exp),
    }


@router.post("/experiments/{exp_id}/cancel", response_model=schemas.ExperimentOut)
def cancel_experiment(
    exp_id: uuid.UUID,
    db: Session = Depends(get_db),
    svc: ExperimentService = Depends(get_experiments),
    actor: Actor = Depends(require_admin),
) -> schemas.ExperimentOut:
    exp = svc.cancel(db, exp_id, actor.name)
    db.commit()
    return svc.out(exp)


@router.get("/experiments/{exp_id}/artifacts")
def list_artifacts(
    exp_id: uuid.UUID,
    db: Session = Depends(get_db),
    svc: ExperimentService = Depends(get_experiments),
) -> dict[str, Any]:
    return {"artifacts": svc.artifact_names(svc.get(db, exp_id))}


@router.get("/experiments/{exp_id}/artifacts/{name}")
def download_artifact(
    exp_id: uuid.UUID,
    name: str,
    db: Session = Depends(get_db),
    svc: ExperimentService = Depends(get_experiments),
) -> FileResponse:
    return FileResponse(svc.artifact_path(svc.get(db, exp_id), name))


@router.post(
    "/evaluations",
    response_model=schemas.EvaluationOut,
    status_code=202,
    dependencies=[Depends(rate_limit_expensive)],
)
def start_evaluation(
    req: schemas.EvaluationRequest,
    db: Session = Depends(get_db),
    svc: ExperimentService = Depends(get_experiments),
    actor: Actor = Depends(require_admin),
) -> Any:
    ev = svc.enqueue_evaluation(db, req, actor.name)
    db.commit()
    return ev


@router.get("/evaluations", response_model=schemas.Page)
def list_evaluations(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    svc: ExperimentService = Depends(get_experiments),
) -> schemas.Page:
    return svc.list_evaluations(db, limit, offset)


@router.get("/evaluations/{eval_id}", response_model=schemas.EvaluationOut)
def get_evaluation(
    eval_id: uuid.UUID,
    db: Session = Depends(get_db),
    svc: ExperimentService = Depends(get_experiments),
) -> Any:
    return svc.get_evaluation(db, eval_id)


@router.get("/evaluations/{eval_id}/results")
def get_evaluation_results(
    eval_id: uuid.UUID,
    db: Session = Depends(get_db),
    svc: ExperimentService = Depends(get_experiments),
) -> dict[str, Any]:
    return svc.evaluation_results(svc.get_evaluation(db, eval_id))


@router.get("/evaluations/{eval_id}/figures/{name}")
def get_evaluation_figure(
    eval_id: uuid.UUID,
    name: str,
    db: Session = Depends(get_db),
    svc: ExperimentService = Depends(get_experiments),
) -> FileResponse:
    return FileResponse(svc.figure_path(svc.get_evaluation(db, eval_id), name))
