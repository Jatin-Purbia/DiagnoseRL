"""FastAPI dependencies that expose application services from ``app.state``."""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Request
from sqlalchemy.orm import Session

from diagnoserl.api.services.engine import ScenarioRegistry
from diagnoserl.api.services.experiments import ExperimentService
from diagnoserl.api.services.registry import ModelRegistry
from diagnoserl.api.services.sessions import SessionService


def get_db(request: Request) -> Iterator[Session]:
    """One session per request. Mutating endpoints commit explicitly; errors roll back."""
    db: Session = request.app.state.session_factory()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_sessions(request: Request) -> SessionService:
    service: SessionService = request.app.state.sessions
    return service


def get_scenarios(request: Request) -> ScenarioRegistry:
    registry: ScenarioRegistry = request.app.state.scenarios
    return registry


def get_registry(request: Request) -> ModelRegistry:
    registry: ModelRegistry = request.app.state.registry
    return registry


def get_experiments(request: Request) -> ExperimentService:
    service: ExperimentService = request.app.state.experiments
    return service
