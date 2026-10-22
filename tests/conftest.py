from __future__ import annotations

from typing import Any

import pytest

from diagnoserl.config import DiagnosticModel, ScenarioConfig, load_model


def make_scenario(**overrides: Any) -> dict[str, Any]:
    """A minimal valid scenario dict: 2 faults, 2 tests, 2 outcomes."""
    data: dict[str, Any] = {
        "name": "tiny",
        "max_steps": 3,
        "faults": [
            {"id": "a", "name": "A", "prior": 0.5},
            {"id": "b", "name": "B", "prior": 0.5},
        ],
        "tests": [
            {
                "id": "t1",
                "name": "T1",
                "cost": 1,
                "duration": 2,
                "outcomes": ["OK", "BAD"],
                "likelihood": {
                    "default": {"OK": 0.5, "BAD": 0.5},
                    "overrides": {"a": {"OK": 0.8, "BAD": 0.2}, "b": {"OK": 0.2, "BAD": 0.8}},
                },
            },
            {
                "id": "t2",
                "name": "T2",
                "cost": 3,
                "duration": 6,
                "outcomes": ["OK", "BAD"],
                "likelihood": {
                    "default": {"OK": 0.5, "BAD": 0.5},
                    "overrides": {"a": {"OK": 0.9, "BAD": 0.1}, "b": {"OK": 0.1, "BAD": 0.9}},
                },
            },
        ],
    }
    data.update(overrides)
    return data


@pytest.fixture
def tiny_model() -> DiagnosticModel:
    return ScenarioConfig.model_validate(make_scenario()).compile()


@pytest.fixture(scope="session")
def standard_model() -> DiagnosticModel:
    return load_model("standard")


@pytest.fixture(scope="session")
def small_model() -> DiagnosticModel:
    return load_model("small")


# ----------------------------------------------------------------------------- API
ADMIN_KEY = "test-admin-key"


def build_app(artifact_dir, database_url: str = "sqlite:///:memory:", **overrides):  # type: ignore[no-untyped-def]
    from diagnoserl.api.main import create_app
    from diagnoserl.api.settings import Settings

    settings = Settings(
        database_url=database_url,
        artifact_dir=artifact_dir,
        admin_api_key=overrides.pop("admin_api_key", ADMIN_KEY),
        **overrides,
    )
    return create_app(settings, create_tables=True)


@pytest.fixture
def client(tmp_path):  # type: ignore[no-untyped-def]
    from fastapi.testclient import TestClient

    with TestClient(build_app(tmp_path)) as c:
        yield c


@pytest.fixture
def admin():  # type: ignore[no-untyped-def]
    return {"X-API-Key": ADMIN_KEY}
