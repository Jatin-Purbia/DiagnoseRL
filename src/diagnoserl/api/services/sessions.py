"""Diagnostic session service.

State machine: ``active -> declared | truncated`` (terminal). All mutations run inside one
transaction with a row lock (``SELECT ... FOR UPDATE`` on PostgreSQL) plus an optimistic
``version`` column, so concurrent requests cannot corrupt a session. Test execution is
idempotent given ``expected_step``: a retry of an already-applied step returns the recorded
result instead of failing or double-applying.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import numpy as np
from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import Session, selectinload

from diagnoserl import bayes
from diagnoserl.api import orm, schemas
from diagnoserl.api.errors import ApiError, bad_request, conflict, not_found
from diagnoserl.api.services.engine import (
    POLICIES,
    PolicyRuntime,
    ScenarioRegistry,
    recommendation_payload,
    replay,
)
from diagnoserl.config import DiagnosticModel
from diagnoserl.env import RewardConfig
from diagnoserl.incident import sample_incident

TERMINAL = {"declared", "truncated"}


def _as_utc(value: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; every stored timestamp is UTC."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


class SessionService:
    def __init__(self, scenarios: ScenarioRegistry, runtime: PolicyRuntime) -> None:
        self.scenarios = scenarios
        self.runtime = runtime

    # ------------------------------------------------------------- helpers
    def _load(
        self, db: Session, session_id: uuid.UUID, *, lock: bool = False
    ) -> orm.DiagnosticSession:
        stmt = (
            select(orm.DiagnosticSession)
            .where(orm.DiagnosticSession.id == session_id)
            .options(
                selectinload(orm.DiagnosticSession.tests),
                selectinload(orm.DiagnosticSession.snapshots),
                selectinload(orm.DiagnosticSession.declaration),
            )
        )
        if lock:
            stmt = stmt.with_for_update()
        row = db.execute(stmt).scalar_one_or_none()
        if row is None:
            raise not_found("session", session_id)
        return row

    def _model(self, row: orm.DiagnosticSession) -> DiagnosticModel:
        return self.scenarios.model(row.scenario)

    def _version(self, db: Session, row: orm.DiagnosticSession) -> orm.ModelVersion | None:
        if row.model_version_id is None:
            return None
        return db.get(orm.ModelVersion, row.model_version_id)

    def _replay(self, db: Session, row: orm.DiagnosticSession):  # type: ignore[no-untyped-def]
        model = self._model(row)
        version = self._version(db, row)
        include_posterior = version.include_posterior if version else True
        executed = [model.test_ids.index(t.test_id) for t in row.tests]
        fault_index = model.fault_ids.index(row.true_fault)
        return replay(
            model,
            RewardConfig(**row.reward_config),
            include_posterior,
            fault_index,
            list(row.outcomes),
            executed,
        )

    def _posterior(self, model: DiagnosticModel, row: orm.DiagnosticSession) -> np.ndarray:
        evidence = {
            model.test_ids.index(t.test_id): model.outcome_labels.index(t.outcome)
            for t in row.tests
        }
        return bayes.posterior_from_evidence(model, evidence)

    def _fault_probs(self, model: DiagnosticModel, p: np.ndarray) -> list[schemas.FaultProbability]:
        return [
            schemas.FaultProbability(id=fid, name=fname, probability=float(pi))
            for fid, fname, pi in zip(model.fault_ids, model.fault_names, p, strict=True)
        ]

    def _executed_out(self, model: DiagnosticModel, t: orm.ExecutedTest) -> schemas.ExecutedTestOut:
        return schemas.ExecutedTestOut(
            step=t.step,
            test_id=t.test_id,
            test_name=model.test_names[model.test_ids.index(t.test_id)],
            outcome=t.outcome,
            cost=t.cost,
            duration=t.duration,
            posterior_before=[float(x) for x in t.posterior_before],
            posterior_after=[float(x) for x in t.posterior_after],
            recommendation=t.recommendation,
            followed_recommendation=t.followed_recommendation,
            executed_at=_as_utc(t.created_at),
        )

    def _view(self, row: orm.DiagnosticSession) -> schemas.SessionOut:
        """Public view of a session. Never includes the hidden fault while active."""
        model = self._model(row)
        p = self._posterior(model, row)
        executed = np.zeros(model.n_tests, dtype=bool)
        for t in row.tests:
            executed[model.test_ids.index(t.test_id)] = True
        if row.status in TERMINAL:
            available: list[str] = []
        else:
            mask = model.available_tests(executed)
            available = [model.test_ids[i] for i in np.flatnonzero(mask)]
        return schemas.SessionOut(
            id=row.id,
            scenario=row.scenario,
            policy=row.policy,
            model_version_id=row.model_version_id,
            status=row.status,
            steps=row.steps,
            max_steps=model.max_steps,
            cost=row.cost,
            elapsed=row.elapsed,
            total_reward=row.total_reward,
            fault_ids=list(model.fault_ids),
            posterior=self._fault_probs(model, p),
            entropy_bits=bayes.entropy(p),
            confidence=bayes.confidence(p),
            executed=[self._executed_out(model, t) for t in row.tests],
            available_tests=available,
            created_at=row.created_at,
            completed_at=row.completed_at,
        )

    # ------------------------------------------------------------- commands
    def create(self, db: Session, req: schemas.SessionCreate) -> schemas.SessionOut:
        if req.policy not in POLICIES:
            raise bad_request("unknown_policy", f"unknown policy {req.policy!r}", policies=POLICIES)
        model = self.scenarios.model(req.scenario)  # 404 for unknown scenarios
        version: orm.ModelVersion | None = None
        if req.policy == "ppo":
            version = db.execute(
                select(orm.ModelVersion).where(
                    orm.ModelVersion.scenario == req.scenario, orm.ModelVersion.is_active.is_(True)
                )
            ).scalar_one_or_none()
            if version is None:
                raise conflict("no_active_model", f"no active model for scenario {req.scenario!r}")
        seed = req.seed if req.seed is not None else int(np.random.SeedSequence().entropy % 2**31)  # type: ignore[operator]
        incident = sample_incident(model, np.random.default_rng(seed), incident_id=seed)
        reward = RewardConfig()
        row = orm.DiagnosticSession(
            scenario=req.scenario,
            policy=req.policy,
            model_version_id=version.id if version else None,
            seed=seed,
            incident_id=incident.incident_id,
            true_fault=model.fault_ids[incident.fault],
            outcomes=[int(o) for o in incident.outcomes],
            reward_config=reward.__dict__.copy(),
        )
        db.add(row)
        db.flush()
        prior = model.prior
        row.snapshots.append(
            orm.PosteriorSnapshot(
                step=0, posterior=[float(x) for x in prior], entropy=bayes.entropy(prior)
            )
        )
        db.flush()
        return self._view(self._load(db, row.id))

    def get(self, db: Session, session_id: uuid.UUID) -> schemas.SessionOut:
        return self._view(self._load(db, session_id))

    def list_sessions(
        self,
        db: Session,
        *,
        limit: int,
        offset: int,
        status: str | None = None,
        scenario: str | None = None,
        policy: str | None = None,
        q: str | None = None,
    ) -> schemas.Page:
        filters = []
        if status:
            filters.append(orm.DiagnosticSession.status == status)
        if scenario:
            filters.append(orm.DiagnosticSession.scenario == scenario)
        if policy:
            filters.append(orm.DiagnosticSession.policy == policy)
        if q:
            # search by id prefix (ids are UUIDs; compare on the canonical string form)
            needle = q.strip().lower().replace("-", "")
            filters.append(
                func.replace(func.lower(cast(orm.DiagnosticSession.id, String)), "-", "").like(
                    f"{needle}%"
                )
            )
<<<<<<< HEAD
        stmt = select(orm.DiagnosticSession).options(
            selectinload(orm.DiagnosticSession.declaration)
        )
=======
        stmt = select(orm.DiagnosticSession).options(selectinload(orm.DiagnosticSession.declaration))
>>>>>>> 46abdb8 (Fix N+1 queries in session listing)
        stmt = stmt.where(*filters)
        count = select(func.count()).select_from(orm.DiagnosticSession).where(*filters)
        rows = db.execute(
            stmt.order_by(orm.DiagnosticSession.created_at.desc()).limit(limit).offset(offset)
        ).scalars()
        # _summary only reads row.declaration, so a single batched selectinload
        # above covers the page; avoid re-querying each row individually (the
        # previous self._load(db, r.id) per row turned a page of N into 1+4N
        # queries by also eager-loading tests/snapshots that _summary never uses).
        items = [self._summary(r) for r in rows]
        return schemas.Page(
            items=items, total=db.execute(count).scalar_one(), limit=limit, offset=offset
        )

    def _summary(self, row: orm.DiagnosticSession) -> dict[str, Any]:
        finished = row.status in TERMINAL
        return {
            "id": str(row.id),
            "scenario": row.scenario,
            "policy": row.policy,
            "status": row.status,
            "steps": row.steps,
            "cost": row.cost,
            "elapsed": row.elapsed,
            "total_reward": row.total_reward,
            "created_at": row.created_at.isoformat(),
            "completed_at": row.completed_at.isoformat() if row.completed_at else None,
            "declared_fault": row.declaration.fault_id if row.declaration else None,
            # The true fault is only revealed once the investigation has ended.
            "true_fault": row.true_fault if finished else None,
            "correct": row.declaration.correct if row.declaration else None,
        }

    def tests(self, db: Session, session_id: uuid.UUID) -> list[schemas.TestOut]:
        row = self._load(db, session_id)
        model = self._model(row)
        cfg = self.scenarios.config(row.scenario)
        executed = {t.test_id for t in row.tests}
        arr = np.array([tid in executed for tid in model.test_ids])
        mask = model.available_tests(arr) if row.status not in TERMINAL else np.zeros_like(arr)
        out = []
        for i, spec in enumerate(cfg.tests):
            out.append(
                schemas.TestOut(
                    id=spec.id,
                    name=spec.name,
                    category=spec.category,
                    cost=spec.cost,
                    duration=spec.duration,
                    outcomes=list(spec.outcomes),
                    requires=list(spec.requires),
                    executed=spec.id in executed,
                    available=bool(mask[i]),
                )
            )
        return out

    def _recommend(self, db: Session, row: orm.DiagnosticSession) -> dict[str, Any]:
        model = self._model(row)
        env, obs, _ = self._replay(db, row)
        reward = RewardConfig(**row.reward_config)
        policy = self.runtime.build(
            row.policy, model, reward, seed=row.seed, step=row.steps, version=self._version(db, row)
        )
        policy.reset(seed=row.seed * 1_000_003 + row.steps)
        return recommendation_payload(model, policy, env.public_state(), obs, row.policy)

    def recommend(self, db: Session, session_id: uuid.UUID) -> schemas.RecommendationOut:
        row = self._load(db, session_id)
        if row.status in TERMINAL:
            raise conflict("session_finished", "session is already finished")
        return schemas.RecommendationOut(**self._recommend(db, row))

    def execute_test(
        self, db: Session, session_id: uuid.UUID, req: schemas.ExecuteTestRequest
    ) -> schemas.ExecuteTestResponse:
        row = self._load(db, session_id, lock=True)
        model = self._model(row)
        if req.test_id not in model.test_ids:
            raise bad_request("unknown_test", f"unknown test {req.test_id!r}")

        # Idempotent retry: the client already applied this step.
        if req.expected_step is not None and row.steps > req.expected_step:
            recorded = next((t for t in row.tests if t.step == req.expected_step + 1), None)
            if recorded is not None and recorded.test_id == req.test_id:
                return schemas.ExecuteTestResponse(
                    result=self._executed_out(model, recorded),
                    replayed=True,
                    session=self._view(row),
                )
            raise conflict(
                "stale_step",
                "session has advanced past expected_step",
                steps=row.steps,
                expected_step=req.expected_step,
            )
        if row.status in TERMINAL:
            raise conflict("session_finished", "session is already finished")
        if req.expected_step is not None and req.expected_step != row.steps:
            raise conflict(
                "stale_step",
                "expected_step does not match",
                steps=row.steps,
                expected_step=req.expected_step,
            )
        if any(t.test_id == req.test_id for t in row.tests):
            raise conflict("test_already_executed", f"test {req.test_id!r} was already executed")

        env, _, _ = self._replay(db, row)
        t_idx = model.test_ids.index(req.test_id)
        if not env.action_masks()[t_idx]:
            raise conflict("test_not_available", f"test {req.test_id!r} is not currently eligible")

        # Policy recommendation shown for this step (best effort; never blocks execution).
        recommendation: dict[str, Any] | None
        try:
            recommendation = self._recommend(db, row)
        except ApiError:
            recommendation = None
        before = env.public_state().belief
        _, reward, _, truncated, info = env.step(t_idx)
        after = env.public_state().belief
        outcome_idx = int(row.outcomes[t_idx])

        followed = None
        if recommendation is not None:
            act = recommendation["action"]
            followed = act["type"] == "test" and act["id"] == req.test_id

        row.tests.append(
            orm.ExecutedTest(
                step=row.steps + 1,
                test_id=req.test_id,
                outcome=model.outcome_labels[outcome_idx],
                cost=float(model.cost[t_idx]),
                duration=float(model.duration[t_idx]),
                posterior_before=[float(x) for x in before],
                posterior_after=[float(x) for x in after],
                recommendation=recommendation,
                followed_recommendation=followed,
            )
        )
        row.snapshots.append(
            orm.PosteriorSnapshot(
                step=row.steps + 1,
                posterior=[float(x) for x in after],
                entropy=bayes.entropy(after),
            )
        )
        row.steps += 1
        row.cost = float(info["cost"])
        row.elapsed = float(info["elapsed"])
        row.total_reward += reward
        if truncated:
            row.status = "truncated"
            row.completed_at = _now()
        db.flush()
        fresh = self._load(db, row.id)
        return schemas.ExecuteTestResponse(
            result=self._executed_out(model, fresh.tests[-1]),
            replayed=False,
            session=self._view(fresh),
        )

    def declare(
        self, db: Session, session_id: uuid.UUID, req: schemas.DeclareRequest
    ) -> schemas.DeclareResponse:
        row = self._load(db, session_id, lock=True)
        model = self._model(row)
        if req.fault_id not in model.fault_ids:
            raise bad_request("unknown_fault", f"unknown fault {req.fault_id!r}")
        if row.declaration is not None:
            if row.declaration.fault_id == req.fault_id:  # idempotent retry
                return self._declare_response(row)
            raise conflict("already_declared", "a different fault was already declared")
        if row.status in TERMINAL:
            raise conflict("session_finished", "session is already finished")

        reward_cfg = RewardConfig(**row.reward_config)
        correct = req.fault_id == row.true_fault
        reward = reward_cfg.reward_correct if correct else -reward_cfg.penalty_wrong
        row.steps += 1
        row.total_reward += reward
        row.status = "declared"
        row.completed_at = _now()
        row.declaration = orm.FaultDeclaration(
            fault_id=req.fault_id,
            correct=correct,
            reward=reward,
            posterior=[float(x) for x in self._posterior(model, row)],
        )
        db.flush()
        return self._declare_response(self._load(db, row.id))

    def _declare_response(self, row: orm.DiagnosticSession) -> schemas.DeclareResponse:
        assert row.declaration is not None
        return schemas.DeclareResponse(
            declaration=schemas.DeclarationOut(
                fault_id=row.declaration.fault_id,
                correct=row.declaration.correct,
                reward=row.declaration.reward,
            ),
            true_fault=row.true_fault,
            session=self._view(row),
        )

    def report(self, db: Session, session_id: uuid.UUID) -> schemas.ReportOut:
        row = self._load(db, session_id)
        if row.status not in TERMINAL:
            raise conflict("session_active", "report is available once the session has finished")
        model = self._model(row)
        view = self._view(row)
        decl = row.declaration
        return schemas.ReportOut(
            session=view,
            initial_prior=self._fault_probs(model, model.prior),
            true_fault=row.true_fault,
            true_fault_name=model.fault_names[model.fault_ids.index(row.true_fault)],
            declared_fault=decl.fault_id if decl else None,
            correct=bool(decl and decl.correct),
            timeout=row.status == "truncated",
            posterior_trace=[
                {"step": s.step, "posterior": s.posterior, "entropy_bits": s.entropy}
                for s in row.snapshots
            ],
        )


def _now() -> datetime:
    return orm.utcnow()
