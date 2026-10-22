"""Gymnasium environment for sequential fault diagnosis.

POMDP summary
-------------
* Hidden state: the root cause (never exposed through observations or ``info``
  until the episode has ended).
* Actions: ``0..T-1`` run test *t*; ``T..T+F-1`` declare fault *f*.
* Observation: test outcomes seen so far (one-hot per test), executed-test mask,
  normalised cost / time / remaining steps and (optionally) the Bayesian posterior.
* Reward (see :class:`RewardConfig`):

  - running a test: ``-(lambda_cost * cost/max_cost + lambda_time * duration/max_duration)``
  - correct declaration: ``+reward_correct`` (terminated)
  - wrong declaration: ``-penalty_wrong`` (terminated)
  - step cap reached without declaring: ``-penalty_timeout`` is **added to** the
    final test's step reward (truncated). No correctness reward is given, and the
    episode is never counted as a successful diagnosis.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from diagnoserl import bayes
from diagnoserl.config.schema import DiagnosticModel
from diagnoserl.incident import Incident, sample_incident


class InvalidActionError(ValueError):
    """An action that is masked (already-run / ineligible test) or out of range."""


@dataclass(frozen=True)
class RewardConfig:
    """Reward weights. Costs and durations are normalised by the largest test value."""

    reward_correct: float = 10.0
    penalty_wrong: float = 10.0
    penalty_timeout: float = 10.0
    lambda_cost: float = 0.5
    lambda_time: float = 0.5

    def test_penalty(self, model: DiagnosticModel, test: int) -> float:
        """Positive penalty charged for running ``test``."""
        max_cost = float(model.cost.max())
        max_dur = float(model.duration.max())
        c = float(model.cost[test]) / max_cost if max_cost > 0 else 0.0
        d = float(model.duration[test]) / max_dur if max_dur > 0 else 0.0
        return self.lambda_cost * c + self.lambda_time * d


@dataclass(frozen=True)
class PublicState:
    """Everything a policy may legitimately know. Contains no hidden information."""

    executed: np.ndarray  # (T,) bool
    outcomes: np.ndarray  # (T,) int, -1 where not executed
    belief: np.ndarray  # (F,) posterior over faults
    cost: float
    elapsed: float
    steps: int
    mask: np.ndarray  # (T + F,) bool, legal actions


class DiagnoseRLEnv(gym.Env[np.ndarray, int]):
    """Cost-aware fault diagnosis as a Gymnasium environment."""

    metadata: dict[str, Any] = {"render_modes": []}  # noqa: RUF012

    def __init__(
        self,
        model: DiagnosticModel,
        reward: RewardConfig | None = None,
        *,
        include_posterior: bool = True,
        sampling_prior: np.ndarray | None = None,
    ) -> None:
        super().__init__()
        self.model = model
        self.reward_config = reward or RewardConfig()
        self.include_posterior = include_posterior
        self.sampling_prior = sampling_prior

        t, f, o = model.n_tests, model.n_faults, model.n_outcomes
        self._total_cost = float(model.cost.sum()) or 1.0
        self._total_time = float(model.duration.sum()) or 1.0
        obs_size = t * o + t + 3 + (f if include_posterior else 0)
        self.observation_space = spaces.Box(0.0, 1.0, shape=(obs_size,), dtype=np.float32)
        self.action_space: spaces.Discrete[Any] = spaces.Discrete(model.n_actions)

        self._incident: Incident | None = None
        self._episodes = 0
        self._reset_progress()

    # ------------------------------------------------------------------ state
    def _reset_progress(self) -> None:
        m = self.model
        self._executed = np.zeros(m.n_tests, dtype=bool)
        self._outcomes = np.full(m.n_tests, -1, dtype=np.int64)
        self._log_belief = bayes.initial_log_belief(m)
        self._cost = 0.0
        self._elapsed = 0.0
        self._steps = 0
        self._done = False

    @property
    def hidden_fault(self) -> int:
        """True root cause. For evaluation/tests only; never given to policies."""
        if self._incident is None:
            raise RuntimeError("call reset() first")
        return self._incident.fault

    def action_masks(self) -> np.ndarray:
        """Boolean mask of legal actions (compatible with sb3-contrib)."""
        m = self.model
        mask = np.ones(m.n_actions, dtype=bool)
        if self._done:
            mask[:] = False
            return mask
        mask[: m.n_tests] = m.available_tests(self._executed)
        return mask

    def public_state(self) -> PublicState:
        """Snapshot of the information available to a policy."""
        return PublicState(
            executed=self._executed.copy(),
            outcomes=self._outcomes.copy(),
            belief=bayes.belief(self._log_belief),
            cost=self._cost,
            elapsed=self._elapsed,
            steps=self._steps,
            mask=self.action_masks(),
        )

    def _observation(self) -> np.ndarray:
        m = self.model
        onehot = np.zeros((m.n_tests, m.n_outcomes), dtype=np.float32)
        ran = np.flatnonzero(self._executed)
        onehot[ran, self._outcomes[ran]] = 1.0
        parts = [
            onehot.ravel(),
            self._executed.astype(np.float32),
            np.array(
                [
                    self._cost / self._total_cost,
                    self._elapsed / self._total_time,
                    (m.max_steps - self._steps) / m.max_steps,
                ],
                dtype=np.float32,
            ),
        ]
        if self.include_posterior:
            parts.append(bayes.belief(self._log_belief).astype(np.float32))
        return np.clip(np.concatenate(parts), 0.0, 1.0)

    def _info(self) -> dict[str, Any]:
        return {
            "action_mask": self.action_masks(),
            "posterior": bayes.belief(self._log_belief),
            "tests_run": int(self._executed.sum()),
            "cost": self._cost,
            "elapsed": self._elapsed,
            "steps": self._steps,
        }

    # -------------------------------------------------------------- gym API
    def reset(
        self,
        *,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        """Start an episode. ``options={"incident": Incident}`` replays a fixed incident."""
        super().reset(seed=seed)
        incident = (options or {}).get("incident")
        if incident is None:
            incident = sample_incident(
                self.model, self.np_random, self._episodes, self.sampling_prior
            )
        self._incident = incident
        self._episodes += 1
        self._reset_progress()
        return self._observation(), self._info()

    def step(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        if self._incident is None or self._done:
            raise RuntimeError("call reset() before step()")
        m, cfg = self.model, self.reward_config
        action = int(action)
        if not 0 <= action < m.n_actions or not self.action_masks()[action]:
            raise InvalidActionError(f"action {action} is not legal in the current state")

        self._steps += 1
        terminated = truncated = False
        reward = 0.0
        extra: dict[str, Any] = {}

        if action >= m.n_tests:  # declare a root cause
            declared = action - m.n_tests
            correct = declared == self._incident.fault
            reward = cfg.reward_correct if correct else -cfg.penalty_wrong
            terminated = True
            extra = {"declared_fault": declared, "correct": correct, "timeout": False}
        else:  # run a test
            outcome = int(self._incident.outcomes[action])
            self._executed[action] = True
            self._outcomes[action] = outcome
            self._log_belief = bayes.update_log_belief(m, self._log_belief, action, outcome)
            self._cost += float(m.cost[action])
            self._elapsed += float(m.duration[action])
            reward = -cfg.test_penalty(m, action)
            if self._steps >= m.max_steps:
                truncated = True
                reward -= cfg.penalty_timeout
                extra = {"declared_fault": None, "correct": False, "timeout": True}

        self._done = terminated or truncated
        info = self._info()
        info.update(extra)
        if self._done:
            info["true_fault"] = self._incident.fault  # only revealed once the episode ends
        return self._observation(), float(reward), terminated, truncated, info
