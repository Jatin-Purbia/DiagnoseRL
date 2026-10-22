"""Load scenario configurations from YAML/JSON files or the bundled set."""

from __future__ import annotations

import json
from importlib import resources
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from diagnoserl.config.schema import DiagnosticModel, ScenarioConfig

_SCENARIO_PACKAGE = "diagnoserl.config"
_SCENARIO_DIR = "scenarios"


class ScenarioError(ValueError):
    """Raised when a scenario file cannot be parsed or fails validation."""


def parse_scenario(text: str, *, fmt: str = "yaml") -> ScenarioConfig:
    """Parse and validate scenario text (``yaml`` or ``json``)."""
    try:
        data: Any = json.loads(text) if fmt == "json" else yaml.safe_load(text)
    except (json.JSONDecodeError, yaml.YAMLError) as exc:
        raise ScenarioError(f"cannot parse scenario: {exc}") from exc
    if not isinstance(data, dict):
        raise ScenarioError("scenario must be a mapping at the top level")
    try:
        return ScenarioConfig.model_validate(data)
    except ValidationError as exc:
        raise ScenarioError(str(exc)) from exc


def load_scenario_file(path: str | Path) -> ScenarioConfig:
    """Load a scenario from a ``.yaml``/``.yml``/``.json`` file."""
    p = Path(path)
    fmt = "json" if p.suffix.lower() == ".json" else "yaml"
    return parse_scenario(p.read_text(encoding="utf-8"), fmt=fmt)


def list_bundled_scenarios() -> list[str]:
    """Names of scenarios shipped with the package."""
    root = resources.files(_SCENARIO_PACKAGE).joinpath(_SCENARIO_DIR)
    return sorted(p.name.removesuffix(".yaml") for p in root.iterdir() if p.name.endswith(".yaml"))


def load_bundled_scenario(name: str) -> ScenarioConfig:
    """Load a bundled scenario by name (e.g. ``"standard"``)."""
    resource = resources.files(_SCENARIO_PACKAGE).joinpath(_SCENARIO_DIR, f"{name}.yaml")
    if not resource.is_file():
        raise ScenarioError(
            f"unknown bundled scenario {name!r}; available: {list_bundled_scenarios()}"
        )
    return parse_scenario(resource.read_text(encoding="utf-8"))


def load_model(source: str | Path) -> DiagnosticModel:
    """Resolve ``source`` (bundled name or file path) to a compiled model."""
    path = Path(source)
    if path.suffix.lower() in {".yaml", ".yml", ".json"}:
        return load_scenario_file(path).compile()
    return load_bundled_scenario(str(source)).compile()
