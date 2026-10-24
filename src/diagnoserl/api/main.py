"""FastAPI application factory.

Run: ``uvicorn diagnoserl.api.main:app_factory --factory`` (settings from ``DIAGNOSERL_*``).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from diagnoserl import __version__
from diagnoserl.api import orm
from diagnoserl.api.database import make_engine, make_session_factory
from diagnoserl.api.errors import register_error_handlers
from diagnoserl.api.routers import diagnostics, experiments, health, models, scenarios
from diagnoserl.api.security import BodySizeLimitMiddleware, SlidingWindowLimiter, TimeoutMiddleware
from diagnoserl.api.services.engine import PolicyRuntime, ScenarioRegistry
from diagnoserl.api.services.experiments import ExperimentService
from diagnoserl.api.services.registry import ModelRegistry
from diagnoserl.api.services.sessions import SessionService
from diagnoserl.api.settings import Settings, get_settings
from diagnoserl.logging_config import configure_logging


def create_app(settings: Settings | None = None, *, create_tables: bool = False) -> FastAPI:
    """Build the application. ``create_tables`` is for dev/tests; production uses Alembic."""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        settings.artifact_dir.mkdir(parents=True, exist_ok=True)
        if create_tables:
            orm.Base.metadata.create_all(app.state.engine)
        yield
        app.state.engine.dispose()

    app = FastAPI(
        title="DiagnoseRL API",
        version=__version__,
        description="Adaptive, cost-aware fault diagnosis with Bayesian beliefs and RL policies.",
        lifespan=lifespan,
    )
    engine = make_engine(settings.database_url)
    scenarios_registry = ScenarioRegistry()
    runtime = PolicyRuntime(settings.artifact_dir)
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = make_session_factory(engine)
    app.state.scenarios = scenarios_registry
    app.state.sessions = SessionService(scenarios_registry, runtime)
    app.state.registry = ModelRegistry(settings.artifact_dir, scenarios_registry)
    app.state.experiments = ExperimentService(settings, scenarios_registry)
    app.state.limiter = SlidingWindowLimiter(limit=settings.expensive_rate_limit_per_minute)

    app.add_middleware(
        TimeoutMiddleware,
        seconds=settings.request_timeout_seconds,
        max_concurrent=settings.max_concurrent_requests,
    )
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_body_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-API-Key"],
    )
    register_error_handlers(app)

    app.include_router(health.router)
    for router in (
        diagnostics.router,
        models.router,
        experiments.router,
        scenarios.router,
    ):
        app.include_router(router, prefix="/api/v1")
    return app


def app_factory() -> FastAPI:  # pragma: no cover - exercised by uvicorn
    """Entry point for ``uvicorn --factory`` (creates tables only in dev)."""
    configure_logging()
    return create_app(create_tables=get_settings().environment == "dev")
