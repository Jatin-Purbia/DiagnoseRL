"""Liveness and readiness probes."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
def ready(request: Request) -> Any:
    checks: dict[str, str] = {}
    try:
        with request.app.state.engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        checks["database"] = "unavailable"
    artifact_dir = request.app.state.settings.artifact_dir
    checks["artifacts"] = "ok" if artifact_dir.exists() else "missing"
    healthy = all(v == "ok" for v in checks.values())
    return JSONResponse(
        {"status": "ready" if healthy else "not_ready", "checks": checks},
        status_code=200 if healthy else 503,
    )
