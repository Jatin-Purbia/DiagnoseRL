"""Application settings, read from ``DIAGNOSERL_*`` environment variables (or a ``.env``)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. No secrets have defaults."""

    model_config = SettingsConfigDict(env_prefix="DIAGNOSERL_", env_file=".env", extra="ignore")

    environment: Literal["dev", "prod"] = "dev"
    database_url: str = "sqlite:///artifacts/diagnoserl.db"
    artifact_dir: Path = Path("artifacts")
    # Administrative operations (start training, activate a model, ...) require this key
    # in the ``X-API-Key`` header. If unset, admin endpoints are disabled (HTTP 503).
    admin_api_key: SecretStr | None = None
    cors_origins: list[str] = ["http://localhost:3000"]
    max_body_bytes: int = 1_000_000
    request_timeout_seconds: float = 30.0
    # Expensive operations (training / evaluation) per client per minute.
    expensive_rate_limit_per_minute: int = 6
    worker_poll_seconds: float = 2.0

    @property
    def runs_dir(self) -> Path:
        return self.artifact_dir / "runs"

    @property
    def eval_dir(self) -> Path:
        return self.artifact_dir / "eval"


@lru_cache
def get_settings() -> Settings:
    return Settings()
