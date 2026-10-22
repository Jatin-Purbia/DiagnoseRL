"""Diagnostic engine glue: scenarios, policy construction and session replay."""

from __future__ import annotations

import hashlib
import threading
import uuid
from pathlib import Path
from typing import Any

import numpy as np

from diagnoserl.agents import RLPolicy
from diagnoserl.api.errors import ApiError, not_found
from diagnoserl.api.orm import ModelVersion
from diagnoserl.baselines import (
    CostAwareBayesPolicy,
    FixedOrderPolicy,
    InformationGainPolicy,
    Policy,
    RandomPolicy,
)
from diagnoserl.config import (
    DiagnosticModel,
    ScenarioConfig,
    list_bundled_scenarios,
    load_bundled_scenario,
)
from diagnoserl.env import DiagnoseRLEnv, PublicState, RewardConfig
from diagnoserl.incident import Incident

POLICIES = ("cost_aware_bayes", "info_gain", "fixed_order", "random", "ppo")

PPO_NOTE = (
    "Action preferences of the policy network at this state. They are not calibrated "
    "probabilities that the corresponding diagnosis is correct, and they are not a causal "
    "explanation of the choice."
)


class ScenarioRegistry:
    """Bundled scenarios, compiled once."""

    def __init__(self) -> None:
        self._configs: dict[str, ScenarioConfig] = {}
        self._models: dict[str, DiagnosticModel] = {}

    def names(self) -> list[str]:
        return list_bundled_scenarios()

    def config(self, name: str) -> ScenarioConfig:
        if name not in self._configs:
            if name not in self.names():
                raise not_found("scenario", name)
            self._configs[name] = load_bundled_scenario(name)
        return self._configs[name]

    def model(self, name: str) -> DiagnosticModel:
        if name not in self._models:
            self._models[name] = self.config(name).compile()
        return self._models[name]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve_artifact(artifact_dir: Path, relative: str) -> Path:
    """Resolve ``relative`` inside ``artifact_dir``; refuse anything that escapes it."""
    root = artifact_dir.resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise ApiError(400, "invalid_path", "artifact path escapes the artifact directory")
    return path


class PolicyRuntime:
    """Builds policies for sessions; caches the loaded RL checkpoint."""

    def __init__(self, artifact_dir: Path) -> None:
        self.artifact_dir = artifact_dir
        self._lock = threading.Lock()
        self._rl_cache: dict[uuid.UUID, RLPolicy] = {}

    def load_rl(self, version: ModelVersion) -> RLPolicy:
        with self._lock:
            cached = self._rl_cache.get(version.id)
            if cached is not None:
                return cached
            path = resolve_artifact(self.artifact_dir, version.artifact_path)
            if not path.is_file():
                raise ApiError(409, "model_missing", "model checkpoint file is missing")
            if sha256_file(path) != version.sha256:
                raise ApiError(409, "model_corrupt", "model checkpoint hash mismatch")
            policy = RLPolicy.load(path, name=f"ppo:{version.name}")
            self._rl_cache.clear()  # keep at most one model in memory
            self._rl_cache[version.id] = policy
            return policy

    def build(
        self,
        name: str,
        model: DiagnosticModel,
        reward: RewardConfig,
        *,
        seed: int,
        step: int,
        version: ModelVersion | None,
    ) -> Policy:
        if name == "cost_aware_bayes":
            return CostAwareBayesPolicy(model, reward, depth=2)
        if name == "info_gain":
            return InformationGainPolicy(model, reward, threshold=0.9)
        if name == "fixed_order":
            return FixedOrderPolicy(model, max_tests=min(5, model.max_steps - 1))
        if name == "random":
            p = RandomPolicy(model, stop_prob=0.2, seed=seed * 1_000_003 + step)
            return p
        if name == "ppo":
            if version is None:
                raise ApiError(409, "no_active_model", "no active model for this scenario")
            return self.load_rl(version)
        raise ApiError(400, "unknown_policy", f"unknown policy {name!r}", {"policies": POLICIES})


def replay(
    model: DiagnosticModel,
    reward: RewardConfig,
    include_posterior: bool,
    fault_index: int,
    outcomes: list[int],
    executed_tests: list[int],
) -> tuple[DiagnoseRLEnv, np.ndarray, float]:
    """Rebuild environment state by replaying the executed tests; returns (env, obs, reward)."""
    env = DiagnoseRLEnv(model, reward, include_posterior=include_posterior)
    incident = Incident(0, fault_index, np.asarray(outcomes, dtype=np.int64))
    obs, _ = env.reset(options={"incident": incident})
    total = 0.0
    for t in executed_tests:
        obs, r, *_ = env.step(t)
        total += r
    return env, obs, total


def recommendation_payload(
    model: DiagnosticModel, policy: Policy, state: PublicState, obs: np.ndarray, policy_name: str
) -> dict[str, Any]:
    """Describe the policy's next action and (where honest) why."""
    action = policy.act(state, obs)
    if action < model.n_tests:
        action_info: dict[str, Any] = {
            "type": "test",
            "id": model.test_ids[action],
            "name": model.test_names[action],
            "estimated_cost": float(model.cost[action]),
            "estimated_duration": float(model.duration[action]),
        }
    else:
        f = action - model.n_tests
        action_info = {
            "type": "declare",
            "id": model.fault_ids[f],
            "name": model.fault_names[f],
            "estimated_cost": 0.0,
            "estimated_duration": 0.0,
        }
    if isinstance(policy, RLPolicy):
        probs = policy.action_probabilities(state, obs)
        top = np.argsort(-probs)[:5]
        labels = [*model.test_ids, *(f"declare:{f}" for f in model.fault_ids)]
        explanation: dict[str, Any] = {
            "method": "policy_network_action_distribution",
            "top_actions": [
                {"action": labels[i], "probability": float(probs[i])} for i in top if probs[i] > 0
            ],
            "note": PPO_NOTE,
        }
    else:
        explanation = {k: _plain(v) for k, v in policy.explain(state).items()}
    return {
        "policy": policy_name,
        "action": action_info,
        "confidence": float(state.belief.max()),
        "explanation": explanation,
    }


def _plain(v: Any) -> Any:
    if isinstance(v, np.generic):
        return v.item()
    return v
