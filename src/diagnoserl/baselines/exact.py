"""Exact reference solver (dynamic programming over evidence states).

The diagnosis problem is fully described by the evidence collected so far, so the
optimal policy under the environment's reward can be computed exactly for small
scenarios by memoised recursion over evidence tuples ``(outcome or -1) per test``.

To avoid normalising beliefs we work with the *joint* weight vector
``w_f = P(f, evidence)`` (sums to ``P(evidence)``) and the mass-weighted value
``J(evidence) = P(evidence) * V(evidence)``::

    declare:  max_f  w_f * R_correct - (sum(w) - w_f) * P_wrong
    test t:   -penalty(t) * sum(w)  +  sum_o J(evidence + (t, o))
    J = max(declare, max_t test t)       (V(root) = J(root) since P(root) = 1)

A test is only allowed if it is not the final step (``steps + 1 < max_steps``),
matching the environment, where a final-step test truncates the episode.

Scalability: the number of states is bounded by ``(O + 1) ** T``; the solver
refuses scenarios above ``max_states``. It is a validation tool for small
synthetic scenarios, not a production policy.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from diagnoserl.baselines.base import Policy, declare_action, weighted_test_cost
from diagnoserl.config.schema import DiagnosticModel
from diagnoserl.env import PublicState, RewardConfig

DEFAULT_MAX_STATES = 5_000_000


class ScenarioTooLargeError(ValueError):
    """The exact solver would need more evidence states than allowed."""


class ExactSolver:
    """Optimal value and policy for a (small) scenario under a reward config."""

    def __init__(
        self,
        model: DiagnosticModel,
        reward: RewardConfig | None = None,
        max_states: int = DEFAULT_MAX_STATES,
    ) -> None:
        bound = (model.n_outcomes + 1) ** model.n_tests
        if bound > max_states:
            raise ScenarioTooLargeError(
                f"{bound:,} evidence states exceed max_states={max_states:,}; "
                "the exact solver only supports small scenarios"
            )
        self.model = model
        self.reward = reward or RewardConfig()
        self._pen = weighted_test_cost(model, self.reward)
        self._cache: dict[tuple[int, ...], float] = {}

    def _weights(self, evidence: tuple[int, ...]) -> np.ndarray:
        w = self.model.prior.copy()
        for t, o in enumerate(evidence):
            if o >= 0:
                w = w * self.model.likelihood[t, :, o]
        return np.asarray(w)

    def _declare_value(self, w: np.ndarray) -> float:
        total = float(w.sum())
        utility = w * self.reward.reward_correct - (total - w) * self.reward.penalty_wrong
        return float(np.max(utility))

    def _test_value(self, evidence: tuple[int, ...], w: np.ndarray, t: int) -> float:
        value = float(-self._pen[t] * float(w.sum()))
        for o in range(self.model.n_outcomes):
            if (w * self.model.likelihood[t, :, o]).sum() > 0.0:
                nxt = (*evidence[:t], o, *evidence[t + 1 :])
                value += self.mass_value(nxt)
        return value

    def _legal_tests(self, evidence: tuple[int, ...]) -> list[int]:
        steps = sum(1 for o in evidence if o >= 0)
        if steps + 1 >= self.model.max_steps:
            return []
        executed = np.array([o >= 0 for o in evidence])
        return [int(t) for t in np.flatnonzero(self.model.available_tests(executed))]

    def mass_value(self, evidence: tuple[int, ...]) -> float:
        """``J(evidence) = P(evidence) * V(evidence)``."""
        cached = self._cache.get(evidence)
        if cached is not None:
            return cached
        w = self._weights(evidence)
        best = self._declare_value(w)
        for t in self._legal_tests(evidence):
            best = max(best, self._test_value(evidence, w, t))
        self._cache[evidence] = best
        return best

    def optimal_value(self) -> float:
        """Expected total reward of the optimal policy from the empty evidence state."""
        return self.mass_value((-1,) * self.model.n_tests)

    def best_action(self, evidence: tuple[int, ...]) -> tuple[int, float, float]:
        """``(action, value_of_action, declare_value)`` in the current evidence state.

        Values are per-unit-probability (``J / P(evidence)``). Declaring is preferred
        on ties.
        """
        w = self._weights(evidence)
        mass = float(w.sum())
        declare = self._declare_value(w)
        best_action = self.model.n_tests + int(np.argmax(w))
        best_value = declare
        for t in self._legal_tests(evidence):
            v = self._test_value(evidence, w, t)
            if v > best_value + 1e-12:
                best_action, best_value = t, v
        return best_action, best_value / mass, declare / mass


class ExactPolicy(Policy):
    """Plays the exactly-optimal policy (small scenarios only)."""

    def __init__(self, model: DiagnosticModel, reward: RewardConfig | None = None) -> None:
        self.model = model
        self.solver = ExactSolver(model, reward)
        self.name = "exact_dp"

    def act(self, state: PublicState, observation: np.ndarray) -> int:
        evidence = tuple(int(o) for o in state.outcomes)
        action, _, _ = self.solver.best_action(evidence)
        if not state.mask[action]:  # defensive; cannot happen for a correct solver
            return declare_action(self.model, state)
        return action

    def explain(self, state: PublicState) -> dict[str, Any]:
        evidence = tuple(int(o) for o in state.outcomes)
        action, value, declare = self.solver.best_action(evidence)
        return {
            "method": "exact_dynamic_programming",
            "optimal_value": value,
            "utility_declare_now": declare,
            "action": action,
        }
