"""Filtered analytics over diagnostic sessions (what the Overview dashboard shows).

Everything is computed from stored sessions. "Accuracy" is ``correct / finished`` where finished
sessions include truncated ones (no declaration counts as a failure), matching the evaluation
pipeline. The true fault is only used for sessions that have already ended.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from diagnoserl.api import orm

MAX_SESSIONS = 5000  # most recent finished sessions considered


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _start(d: date | None) -> datetime | None:
    return datetime.combine(d, time.min, tzinfo=UTC) if d else None


def _end_exclusive(d: date | None) -> datetime | None:
    return datetime.combine(d + timedelta(days=1), time.min, tzinfo=UTC) if d else None


def analytics(
    db: Session,
    *,
    scenario: str | None = None,
    policy: str | None = None,
    since: date | None = None,
    until: date | None = None,
) -> dict[str, Any]:
    S = orm.DiagnosticSession
    filters = []
    if scenario:
        filters.append(S.scenario == scenario)
    if policy:
        filters.append(S.policy == policy)
    if since:
        filters.append(S.created_at >= _start(since))
    if until:
        filters.append(S.created_at < _end_exclusive(until))

    rows = (
        db.execute(
            select(S)
            .where(*filters)
            .options(selectinload(S.tests), selectinload(S.declaration))
            .order_by(S.created_at.desc())
            .limit(MAX_SESSIONS)
        )
        .scalars()
        .all()
    )
    finished = [r for r in rows if r.status != "active"]

    def stats(group: list[orm.DiagnosticSession]) -> dict[str, Any]:
        correct = sum(1 for r in group if r.declaration and r.declaration.correct)
        return {
            "sessions": len(group),
            "correct": correct,
            "accuracy": correct / len(group) if group else None,
            "mean_tests": _mean([float(len(r.tests)) for r in group]),
            "mean_duration": _mean([r.elapsed for r in group]),
            "mean_cost": _mean([r.cost for r in group]),
            "mean_reward": _mean([r.total_reward for r in group]),
        }

    by_day: dict[str, list[orm.DiagnosticSession]] = defaultdict(list)
    by_policy: dict[str, list[orm.DiagnosticSession]] = defaultdict(list)
    faults: dict[str, dict[str, int]] = defaultdict(lambda: {"count": 0, "correct": 0})
    for r in finished:
        by_day[r.created_at.date().isoformat()].append(r)
        by_policy[r.policy].append(r)
        faults[r.true_fault]["count"] += 1
        if r.declaration and r.declaration.correct:
            faults[r.true_fault]["correct"] += 1

    declared = [r for r in finished if r.status == "declared"]
    return {
        "filters": {
            "scenario": scenario,
            "policy": policy,
            "since": since.isoformat() if since else None,
            "until": until.isoformat() if until else None,
        },
        "total_investigations": len(rows),
        "active": len(rows) - len(finished),
        "finished": len(finished),
        "declared": len(declared),
        "truncated": len(finished) - len(declared),
        **{k: v for k, v in stats(finished).items() if k != "sessions"},
        "timeseries": [{"date": day, **stats(group)} for day, group in sorted(by_day.items())],
        "by_policy": [{"policy": p, **stats(g)} for p, g in sorted(by_policy.items())],
        "fault_frequency": sorted(
            (
                {
                    "fault": f,
                    "count": v["count"],
                    "identified": v["correct"],
                    "identification_rate": v["correct"] / v["count"],
                }
                for f, v in faults.items()
            ),
            key=lambda x: -x["count"],
        ),
        "recent": [
            {
                "id": str(r.id),
                "scenario": r.scenario,
                "policy": r.policy,
                "status": r.status,
                "steps": r.steps,
                "tests": len(r.tests),
                "cost": r.cost,
                "created_at": r.created_at.isoformat(),
                "declared_fault": r.declaration.fault_id if r.declaration else None,
                "true_fault": r.true_fault if r.status != "active" else None,
                "correct": r.declaration.correct if r.declaration else None,
            }
            for r in rows[:10]
        ],
        "truncated_to_most_recent": len(rows) >= MAX_SESSIONS,
    }


def filter_options(db: Session) -> dict[str, list[str]]:
    """Distinct scenarios and policies present in stored sessions (for the filter controls)."""
    S = orm.DiagnosticSession
    return {
        "scenarios": sorted(db.execute(select(S.scenario).distinct()).scalars().all()),
        "policies": sorted(db.execute(select(S.policy).distinct()).scalars().all()),
    }
