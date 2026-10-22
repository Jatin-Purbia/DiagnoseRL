"""Common policy interface and shared decision helpers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import numpy as np

from diagnoserl.config.schema import DiagnosticModel
from diagnoserl.env import PublicState, RewardConfig


class Policy(ABC):
    """A diagnostic policy.

    Every policy (baseline or learned) receives the same inputs: the public
    state (outcomes seen, posterior, spend, legal-action mask) and the
    environment observation vector, both derived from the same evidence. No
    policy ever sees the hidden fault.
    """

    name: str = "policy"

    def reset(self, seed: int | None = None) -> None:  # noqa: B027 - optional hook
        """Called at the start of each episode."""

    @abstractmethod
    def act(self, state: PublicState, observation: np.ndarray) -> int:
        """Return a legal action index."""

    def explain(self, state: PublicState) -> dict[str, Any]:
        """Policy-specific justification for the *next* action (may be empty)."""
        return {}


def declare_action(model: DiagnosticModel, state: PublicState) -> int:
    """Action that declares the maximum-posterior fault (ties: lowest index)."""
    return model.n_tests + int(np.argmax(state.belief))


def must_declare(model: DiagnosticModel, state: PublicState) -> bool:
    """True when the next step is the last allowed one or no test is legal.

    Running a test on the final step would truncate the episode, so heuristic
    baselines declare instead. (The RL agent has to learn this from the
    observation's remaining-steps feature.)
    """
    no_tests = not state.mask[: model.n_tests].any()
    return no_tests or state.steps + 1 >= model.max_steps


def weighted_test_cost(model: DiagnosticModel, reward: RewardConfig) -> np.ndarray:
    """Per-test penalty ``lambda_cost * cost + lambda_time * duration`` (normalised)."""
    return np.array([reward.test_penalty(model, t) for t in range(model.n_tests)])


def declaration_utility(p: np.ndarray, reward: RewardConfig) -> float:
    """Expected reward of declaring the most likely fault now."""
    p_max = float(p.max())
    return p_max * reward.reward_correct - (1.0 - p_max) * reward.penalty_wrong
