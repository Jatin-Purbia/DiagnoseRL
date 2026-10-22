"""Run any policy on a fixed set of incidents."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np

from diagnoserl.baselines.base import Policy
from diagnoserl.env import DiagnoseRLEnv
from diagnoserl.incident import Incident

NO_DIAGNOSIS = -1


@dataclass(frozen=True)
class EpisodeRecord:
    """Outcome of one diagnostic episode."""

    incident_id: int
    true_fault: int
    declared_fault: int  # NO_DIAGNOSIS if the episode was truncated
    correct: bool
    truncated: bool
    n_tests: int
    cost: float
    elapsed: float
    reward: float
    actions: tuple[int, ...] = field(default_factory=tuple)


def run_episode(
    env: DiagnoseRLEnv, policy: Policy, incident: Incident, policy_seed: int | None = None
) -> EpisodeRecord:
    """Play ``policy`` on ``incident`` until termination or truncation."""
    obs, _ = env.reset(options={"incident": incident})
    policy.reset(seed=policy_seed)
    total_reward = 0.0
    actions: list[int] = []
    info: dict[str, object] = {}
    terminated = truncated = False
    while not (terminated or truncated):
        action = policy.act(env.public_state(), obs)
        actions.append(int(action))
        obs, reward, terminated, truncated, info = env.step(action)
        total_reward += reward
    declared = info["declared_fault"]
    return EpisodeRecord(
        incident_id=incident.incident_id,
        true_fault=incident.fault,
        declared_fault=NO_DIAGNOSIS if declared is None else int(declared),  # type: ignore[call-overload]
        correct=bool(info["correct"]),
        truncated=bool(truncated),
        n_tests=int(info["tests_run"]),  # type: ignore[call-overload]
        cost=float(info["cost"]),  # type: ignore[arg-type]
        elapsed=float(info["elapsed"]),  # type: ignore[arg-type]
        reward=total_reward,
        actions=tuple(actions),
    )


def evaluate_policy(
    env: DiagnoseRLEnv,
    policy: Policy,
    incidents: Sequence[Incident],
    policy_seed: int = 0,
) -> list[EpisodeRecord]:
    """Evaluate ``policy`` on every incident (same incidents => fair comparison)."""
    return [
        run_episode(env, policy, inc, policy_seed=policy_seed * 1_000_003 + inc.incident_id)
        for inc in incidents
    ]


def rewards(records: Sequence[EpisodeRecord]) -> np.ndarray:
    """Per-episode reward vector (aligned with the incident list)."""
    return np.array([r.reward for r in records])
