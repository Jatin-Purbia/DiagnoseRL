"""Relational schema (SQLAlchemy 2.0).

Large artifacts (model checkpoints, figures) stay on disk under the configured artifact
directory; these tables store only metadata and validated relative paths.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

JsonType = JSON().with_variant(JSONB(), "postgresql")


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    type_annotation_map = {dict[str, Any]: JsonType, list[Any]: JsonType}  # noqa: RUF012


class DiagnosticSession(Base):
    """One investigation. ``true_fault`` / ``outcomes`` are hidden until it ends."""

    __tablename__ = "diagnostic_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    scenario: Mapped[str] = mapped_column(String(100), index=True)
    policy: Mapped[str] = mapped_column(String(50))
    model_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("model_versions.id"), nullable=True
    )
    # active -> declared | truncated (terminal)
    status: Mapped[str] = mapped_column(String(20), default="active", index=True)
    seed: Mapped[int] = mapped_column(Integer)
    incident_id: Mapped[int] = mapped_column(Integer, default=0)
    true_fault: Mapped[str] = mapped_column(String(100))  # hidden while active
    outcomes: Mapped[list[Any]] = mapped_column(JsonType)  # hidden: outcome index per test
    reward_config: Mapped[dict[str, Any]] = mapped_column(JsonType)
    steps: Mapped[int] = mapped_column(Integer, default=0)
    cost: Mapped[float] = mapped_column(Float, default=0.0)
    elapsed: Mapped[float] = mapped_column(Float, default=0.0)
    total_reward: Mapped[float] = mapped_column(Float, default=0.0)
    version: Mapped[int] = mapped_column(Integer, default=1)  # optimistic locking
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __mapper_args__ = {"version_id_col": version}  # noqa: RUF012

    tests: Mapped[list[ExecutedTest]] = relationship(
        back_populates="session", order_by="ExecutedTest.step", cascade="all, delete-orphan"
    )
    snapshots: Mapped[list[PosteriorSnapshot]] = relationship(
        order_by="PosteriorSnapshot.step", cascade="all, delete-orphan"
    )
    declaration: Mapped[FaultDeclaration | None] = relationship(
        back_populates="session", uselist=False, cascade="all, delete-orphan"
    )


class ExecutedTest(Base):
    __tablename__ = "executed_tests"
    __table_args__ = (
        UniqueConstraint("session_id", "step"),
        UniqueConstraint("session_id", "test_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("diagnostic_sessions.id", ondelete="CASCADE"), index=True
    )
    step: Mapped[int] = mapped_column(Integer)  # 1-based
    test_id: Mapped[str] = mapped_column(String(100))
    outcome: Mapped[str] = mapped_column(String(50))
    cost: Mapped[float] = mapped_column(Float)
    duration: Mapped[float] = mapped_column(Float)
    posterior_before: Mapped[list[Any]] = mapped_column(JsonType)
    posterior_after: Mapped[list[Any]] = mapped_column(JsonType)
    # The policy's recommendation at this step, and whether the user followed it.
    recommendation: Mapped[dict[str, Any] | None] = mapped_column(JsonType, nullable=True)
    followed_recommendation: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    session: Mapped[DiagnosticSession] = relationship(back_populates="tests")


class PosteriorSnapshot(Base):
    """Posterior over faults at each step (step 0 = prior)."""

    __tablename__ = "posterior_snapshots"
    __table_args__ = (UniqueConstraint("session_id", "step"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("diagnostic_sessions.id", ondelete="CASCADE"), index=True
    )
    step: Mapped[int] = mapped_column(Integer)
    posterior: Mapped[list[Any]] = mapped_column(JsonType)
    entropy: Mapped[float] = mapped_column(Float)


class FaultDeclaration(Base):
    __tablename__ = "fault_declarations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("diagnostic_sessions.id", ondelete="CASCADE"), unique=True
    )
    fault_id: Mapped[str] = mapped_column(String(100))
    correct: Mapped[bool] = mapped_column(Boolean)
    reward: Mapped[float] = mapped_column(Float)
    posterior: Mapped[list[Any]] = mapped_column(JsonType)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    session: Mapped[DiagnosticSession] = relationship(back_populates="declaration")


class ModelVersion(Base):
    __tablename__ = "model_versions"
    __table_args__ = (Index("ix_model_versions_scenario_active", "scenario", "is_active"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    scenario: Mapped[str] = mapped_column(String(100))
    experiment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("training_experiments.id"), nullable=True
    )
    artifact_path: Mapped[str] = mapped_column(String(500))  # relative to artifact_dir
    sha256: Mapped[str] = mapped_column(String(64))
    include_posterior: Mapped[bool] = mapped_column(Boolean, default=True)
    seed: Mapped[int] = mapped_column(Integer, default=0)
    metrics: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)  # validation metrics
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TrainingExperiment(Base):
    __tablename__ = "training_experiments"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200))
    # queued -> running -> succeeded | failed | cancelled
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    config: Mapped[dict[str, Any]] = mapped_column(JsonType)
    run_name: Mapped[str] = mapped_column(String(200), unique=True)
    seed: Mapped[int] = mapped_column(Integer, default=0)
    total_timesteps: Mapped[int] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    requested_by: Mapped[str] = mapped_column(String(100), default="admin")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class EvaluationRun(Base):
    __tablename__ = "evaluation_runs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)
    params: Mapped[dict[str, Any]] = mapped_column(JsonType)
    results_dir: Mapped[str | None] = mapped_column(String(500), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    metrics: Mapped[list[EvaluationMetric]] = relationship(
        back_populates="evaluation", cascade="all, delete-orphan"
    )


class EvaluationMetric(Base):
    __tablename__ = "evaluation_metrics"
    __table_args__ = (UniqueConstraint("evaluation_id", "policy", "metric"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    evaluation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("evaluation_runs.id", ondelete="CASCADE"), index=True
    )
    policy: Mapped[str] = mapped_column(String(100))
    metric: Mapped[str] = mapped_column(String(100))
    value: Mapped[float] = mapped_column(Float)
    ci_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    ci_high: Mapped[float | None] = mapped_column(Float, nullable=True)

    evaluation: Mapped[EvaluationRun] = relationship(back_populates="metrics")


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    actor: Mapped[str] = mapped_column(String(100))
    action: Mapped[str] = mapped_column(String(100), index=True)
    target: Mapped[str] = mapped_column(String(200))
    detail: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
