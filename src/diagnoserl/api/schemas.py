"""Request / response models for the HTTP API."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ diagnostics
class SessionCreate(BaseModel):
    scenario: str = "standard"
    policy: str = "cost_aware_bayes"
    seed: int | None = Field(default=None, ge=0, description="Incident seed (random if omitted)")


class FaultProbability(BaseModel):
    id: str
    name: str
    probability: float


class ExecutedTestOut(BaseModel):
    step: int
    test_id: str
    test_name: str
    outcome: str
    cost: float
    duration: float
    posterior_before: list[float]
    posterior_after: list[float]
    recommendation: dict[str, Any] | None
    followed_recommendation: bool | None
    executed_at: datetime | None = None


class SessionOut(BaseModel):
    id: uuid.UUID
    scenario: str
    policy: str
    model_version_id: uuid.UUID | None
    status: str
    steps: int
    max_steps: int
    cost: float
    elapsed: float
    total_reward: float
    fault_ids: list[str]
    posterior: list[FaultProbability]
    entropy_bits: float
    confidence: float
    executed: list[ExecutedTestOut]
    available_tests: list[str]
    created_at: datetime
    completed_at: datetime | None


class TestOut(BaseModel):
    __test__ = False
    id: str
    name: str
    category: str
    cost: float
    duration: float
    outcomes: list[str]
    requires: list[str]
    executed: bool
    available: bool


class ExecuteTestRequest(BaseModel):
    test_id: str
    expected_step: int | None = Field(
        default=None,
        ge=0,
        description="Number of steps the client believes were already taken. Makes retries safe.",
    )


class ExecuteTestResponse(BaseModel):
    result: ExecutedTestOut
    replayed: bool = False
    session: SessionOut


class DeclareRequest(BaseModel):
    fault_id: str


class DeclarationOut(BaseModel):
    fault_id: str
    correct: bool
    reward: float


class DeclareResponse(BaseModel):
    declaration: DeclarationOut
    true_fault: str
    session: SessionOut


class RecommendationOut(BaseModel):
    policy: str
    action: dict[str, Any]
    confidence: float
    explanation: dict[str, Any]


class ReportOut(BaseModel):
    session: SessionOut
    initial_prior: list[FaultProbability]
    true_fault: str
    true_fault_name: str
    declared_fault: str | None
    correct: bool
    timeout: bool
    posterior_trace: list[dict[str, Any]]


class Page(BaseModel):
    items: list[Any]
    total: int
    limit: int
    offset: int


# ----------------------------------------------------------------------- models
class ModelVersionOut(ApiModel):
    id: uuid.UUID
    name: str
    scenario: str
    experiment_id: uuid.UUID | None
    sha256: str
    include_posterior: bool
    seed: int
    metrics: dict[str, Any]
    is_active: bool
    created_at: datetime


class RegisterModelRequest(BaseModel):
    run_name: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9_.\-]+$")
    checkpoint: str = Field(default="best", pattern=r"^(best|final)$")


# ------------------------------------------------------------------ experiments
class TrainingRequest(BaseModel):
    """Training config overrides (validated against ``TrainConfig``)."""

    name: str = Field(default="experiment", min_length=1, max_length=100)
    config: dict[str, Any] = Field(default_factory=dict)


class ExperimentOut(ApiModel):
    id: uuid.UUID
    name: str
    status: str
    run_name: str
    seed: int
    total_timesteps: int
    progress_timesteps: int = 0
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    config: dict[str, Any]


class EvaluationRequest(BaseModel):
    run_names: list[str] = Field(min_length=1, max_length=10)
    model: str = Field(default="best", pattern=r"^(best|final)$")
    n_test: int = Field(default=1000, ge=50, le=20000)
    n_val: int = Field(default=500, ge=50, le=20000)
    n_robust: int = Field(default=500, ge=50, le=5000)
    skip_robustness: bool = False


class EvaluationOut(ApiModel):
    id: uuid.UUID
    status: str
    params: dict[str, Any]
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


# -------------------------------------------------------------------- scenarios
class ScenarioSummary(BaseModel):
    name: str
    description: str
    n_faults: int
    n_tests: int
    max_steps: int
