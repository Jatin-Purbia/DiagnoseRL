"""Training configuration (YAML/JSON loadable, validated)."""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

from diagnoserl.config import DiagnosticModel, load_model
from diagnoserl.env import RewardConfig


class RewardSettings(BaseModel):
    """Serializable mirror of :class:`diagnoserl.env.RewardConfig`."""

    model_config = ConfigDict(extra="forbid")

    reward_correct: float = 10.0
    penalty_wrong: float = 10.0
    penalty_timeout: float = 10.0
    lambda_cost: float = Field(default=0.5, ge=0.0)
    lambda_time: float = Field(default=0.5, ge=0.0)

    def to_reward_config(self) -> RewardConfig:
        return RewardConfig(**self.model_dump())


class TrainConfig(BaseModel):
    """Everything needed to reproduce a training run."""

    model_config = ConfigDict(extra="forbid")

    run_name: str | None = None
    scenario: str = "standard"  # bundled scenario name or path to a YAML/JSON file
    reward: RewardSettings = Field(default_factory=RewardSettings)
    include_posterior: bool = True

    # Seeds: training, validation and final-test incidents never share a seed.
    seed: int = 0
    val_seed: int = 10_001
    test_seed: int = 20_002
    n_val_episodes: int = Field(default=300, ge=1)

    total_timesteps: int = Field(default=500_000, ge=1)
    # Training-only divisor applied to rewards to keep PPO value targets O(1).
    # Does not change the environment, evaluation or the optimal policy.
    reward_scale: float = Field(default=10.0, gt=0.0)
    n_envs: int = Field(default=8, ge=1)
    n_steps: int = Field(default=128, ge=1)  # rollout length per environment
    batch_size: int = Field(default=256, ge=1)
    n_epochs: int = Field(default=10, ge=1)
    learning_rate: float = Field(default=3e-4, gt=0.0)
    gamma: float = Field(default=1.0, gt=0.0, le=1.0)
    gae_lambda: float = Field(default=0.95, gt=0.0, le=1.0)
    ent_coef: float = Field(default=0.01, ge=0.0)
    clip_range: float = Field(default=0.2, gt=0.0)
    net_arch: list[int] = Field(default_factory=lambda: [128, 128], min_length=1)

    eval_freq: int = Field(default=20_000, ge=1)  # in environment timesteps
    checkpoint_freq: int = Field(default=100_000, ge=1)
    output_dir: str = "artifacts/runs"
    device: str = "auto"  # "auto" picks CUDA when available, else CPU
    tensorboard: bool = True
    mlflow: bool = False
    mlflow_tracking_uri: str = "sqlite:///artifacts/mlflow.db"
    mlflow_experiment: str = "diagnoserl"

    @model_validator(mode="after")
    def _check(self) -> TrainConfig:
        if len({self.seed, self.val_seed, self.test_seed}) != 3:
            raise ValueError("seed, val_seed and test_seed must all differ")
        if (self.n_envs * self.n_steps) % self.batch_size != 0:
            raise ValueError("n_envs * n_steps must be a multiple of batch_size")
        return self

    def load_scenario(self) -> DiagnosticModel:
        return load_model(self.scenario)

    @property
    def resolved_run_name(self) -> str:
        return self.run_name or f"{Path(self.scenario).stem}_seed{self.seed}"


def load_train_config(path: str | Path) -> TrainConfig:
    """Load a training config from a YAML file."""
    data = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    return TrainConfig.model_validate(data)
