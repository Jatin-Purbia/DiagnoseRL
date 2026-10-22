"""Dashboard aggregates."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from diagnoserl.api import orm


def overview(db: Session) -> dict[str, Any]:
    S = orm.DiagnosticSession
    total = db.execute(select(func.count()).select_from(S)).scalar_one()
    finished = db.execute(
        select(func.count()).select_from(S).where(S.status != "active")
    ).scalar_one()
    declared = db.execute(
        select(func.count()).select_from(S).where(S.status == "declared")
    ).scalar_one()
    correct = db.execute(
        select(func.count())
        .select_from(orm.FaultDeclaration)
        .where(orm.FaultDeclaration.correct.is_(True))
    ).scalar_one()
    avg = db.execute(
        select(func.avg(S.steps), func.avg(S.elapsed), func.avg(S.cost)).where(S.status != "active")
    ).one()

    by_policy = []
    for policy, n, avg_reward, avg_cost in db.execute(
        select(S.policy, func.count(), func.avg(S.total_reward), func.avg(S.cost))
        .where(S.status != "active")
        .group_by(S.policy)
    ):
        n_correct = db.execute(
            select(func.count())
            .select_from(orm.FaultDeclaration)
            .join(S, S.id == orm.FaultDeclaration.session_id)
            .where(S.policy == policy, orm.FaultDeclaration.correct.is_(True))
        ).scalar_one()
        by_policy.append(
            {
                "policy": policy,
                "sessions": n,
                "accuracy": n_correct / n if n else None,
                "mean_reward": float(avg_reward) if avg_reward is not None else None,
                "mean_cost": float(avg_cost) if avg_cost is not None else None,
            }
        )

    recent = db.execute(select(S).order_by(S.created_at.desc()).limit(8)).scalars()
    active_models = db.execute(
        select(orm.ModelVersion).where(orm.ModelVersion.is_active.is_(True))
    ).scalars()

    latest_eval = db.execute(
        select(orm.EvaluationRun)
        .where(orm.EvaluationRun.status == "succeeded")
        .order_by(orm.EvaluationRun.finished_at.desc())
        .limit(1)
    ).scalar_one_or_none()
    strategy: list[dict[str, Any]] = []
    if latest_eval is not None:
        table: dict[str, dict[str, Any]] = {}
        for m in latest_eval.metrics:
            table.setdefault(m.policy, {"policy": m.policy})[m.metric] = m.value
        strategy = sorted(
            table.values(), key=lambda r: r.get("mean_reward", float("-inf")), reverse=True
        )

    return {
        "total_sessions": total,
        "finished_sessions": finished,
        "declared_sessions": declared,
        "success_rate": (correct / declared) if declared else None,
        "avg_tests": float(avg[0]) if avg[0] is not None else None,
        "avg_duration": float(avg[1]) if avg[1] is not None else None,
        "avg_cost": float(avg[2]) if avg[2] is not None else None,
        "active_models": [
            {"id": str(m.id), "name": m.name, "scenario": m.scenario} for m in active_models
        ],
        "recent_sessions": [
            {
                "id": str(r.id),
                "scenario": r.scenario,
                "policy": r.policy,
                "status": r.status,
                "steps": r.steps,
                "created_at": r.created_at.isoformat(),
            }
            for r in recent
        ],
        "by_policy": by_policy,
        "strategy_comparison": strategy,
        "latest_evaluation_id": str(latest_eval.id) if latest_eval else None,
    }
