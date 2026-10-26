"""Model registry endpoints."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from diagnoserl.api import schemas
from diagnoserl.api.deps import get_db, get_registry
from diagnoserl.api.security import Actor, require_admin
from diagnoserl.api.services.registry import ModelRegistry, audit

router = APIRouter(prefix="/models", tags=["models"])


@router.get("", response_model=list[schemas.ModelVersionOut])
def list_models(
    db: Session = Depends(get_db), registry: ModelRegistry = Depends(get_registry)
) -> list[Any]:
    return registry.list_models(db)


@router.post("/register", response_model=schemas.ModelVersionOut, status_code=201)
def register_model(
    req: schemas.RegisterModelRequest,
    db: Session = Depends(get_db),
    registry: ModelRegistry = Depends(get_registry),
    actor: Actor = Depends(require_admin),
) -> Any:
    version = registry.register_run(db, req.run_name, req.checkpoint)
    audit(db, actor.name, "model.register", str(version.id), {"name": version.name})
    db.commit()
    return version


@router.get("/{model_id}", response_model=schemas.ModelVersionOut)
def get_model(
    model_id: uuid.UUID,
    db: Session = Depends(get_db),
    registry: ModelRegistry = Depends(get_registry),
) -> Any:
    return registry.get(db, model_id)


@router.post("/{model_id}/activate", response_model=schemas.ModelVersionOut)
def activate_model(
    model_id: uuid.UUID,
    db: Session = Depends(get_db),
    registry: ModelRegistry = Depends(get_registry),
    actor: Actor = Depends(require_admin),
) -> Any:
    version = registry.activate(db, model_id, actor.name)
    db.commit()
    return version


@router.post("/{model_id}/deactivate", response_model=schemas.ModelVersionOut)
def deactivate_model(
    model_id: uuid.UUID,
    db: Session = Depends(get_db),
    registry: ModelRegistry = Depends(get_registry),
    actor: Actor = Depends(require_admin),
) -> Any:
    version = registry.deactivate(db, model_id, actor.name)
    db.commit()
    return version
