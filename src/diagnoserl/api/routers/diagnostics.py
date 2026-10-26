"""Diagnostic sessions."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from diagnoserl.api import orm, schemas
from diagnoserl.api.deps import get_db, get_sessions
from diagnoserl.api.errors import bad_request
from diagnoserl.api.services import analytics as analytics_service
from diagnoserl.api.services import overview as overview_service
from diagnoserl.api.services.engine import POLICIES
from diagnoserl.api.services.sessions import SessionService

router = APIRouter(tags=["diagnostics"])


@router.get("/policies")
def list_policies(db: Session = Depends(get_db)) -> dict[str, Any]:
    active = db.execute(
        select(orm.ModelVersion).where(orm.ModelVersion.is_active.is_(True))
    ).scalars()
    ppo_scenarios = sorted({m.scenario for m in active})
    return {"policies": list(POLICIES), "ppo_available_for_scenarios": ppo_scenarios}


@router.post("/sessions", response_model=schemas.SessionOut, status_code=201)
def create_session(
    req: schemas.SessionCreate,
    db: Session = Depends(get_db),
    svc: SessionService = Depends(get_sessions),
) -> schemas.SessionOut:
    out = svc.create(db, req)
    db.commit()
    return out


@router.get("/sessions", response_model=schemas.Page)
def list_sessions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None, pattern="^(active|declared|truncated)$"),
    scenario: str | None = Query(None, max_length=100),
    policy: str | None = Query(None, max_length=50),
    q: str | None = Query(None, max_length=64, description="session id prefix"),
    db: Session = Depends(get_db),
    svc: SessionService = Depends(get_sessions),
) -> schemas.Page:
    return svc.list_sessions(
        db, limit=limit, offset=offset, status=status, scenario=scenario, policy=policy, q=q
    )


@router.get("/sessions/{session_id}", response_model=schemas.SessionOut)
def get_session(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    svc: SessionService = Depends(get_sessions),
) -> schemas.SessionOut:
    return svc.get(db, session_id)


@router.get("/sessions/{session_id}/tests", response_model=list[schemas.TestOut])
def get_tests(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    svc: SessionService = Depends(get_sessions),
) -> list[schemas.TestOut]:
    return svc.tests(db, session_id)


@router.post("/sessions/{session_id}/tests", response_model=schemas.ExecuteTestResponse)
def execute_test(
    session_id: uuid.UUID,
    req: schemas.ExecuteTestRequest,
    db: Session = Depends(get_db),
    svc: SessionService = Depends(get_sessions),
) -> schemas.ExecuteTestResponse:
    out = svc.execute_test(db, session_id, req)
    db.commit()
    return out


@router.get("/sessions/{session_id}/recommendation", response_model=schemas.RecommendationOut)
def get_recommendation(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    svc: SessionService = Depends(get_sessions),
) -> schemas.RecommendationOut:
    return svc.recommend(db, session_id)


@router.post("/sessions/{session_id}/declare", response_model=schemas.DeclareResponse)
def declare(
    session_id: uuid.UUID,
    req: schemas.DeclareRequest,
    db: Session = Depends(get_db),
    svc: SessionService = Depends(get_sessions),
) -> schemas.DeclareResponse:
    out = svc.declare(db, session_id, req)
    db.commit()
    return out


@router.get("/sessions/{session_id}/report", response_model=schemas.ReportOut)
def get_report(
    session_id: uuid.UUID,
    db: Session = Depends(get_db),
    svc: SessionService = Depends(get_sessions),
) -> schemas.ReportOut:
    return svc.report(db, session_id)


@router.get("/overview")
def get_overview(db: Session = Depends(get_db)) -> dict[str, Any]:
    return overview_service.overview(db)


@router.get("/analytics")
def get_analytics(
    scenario: str | None = Query(None, max_length=100),
    policy: str | None = Query(None, max_length=50),
    since: date | None = Query(None, description="first day (UTC), inclusive"),
    until: date | None = Query(None, description="last day (UTC), inclusive"),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Statistics over finished sessions, optionally filtered by scenario, policy and date range."""
    if since and until and since > until:
        raise bad_request("invalid_range", "since must not be after until")
    return {
        **analytics_service.analytics(
            db, scenario=scenario, policy=policy, since=since, until=until
        ),
        "options": analytics_service.filter_options(db),
    }
