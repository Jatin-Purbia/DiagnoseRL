"""Belief-based baselines: information gain and cost-aware Bayesian decision."""

from __future__ import annotations

from typing import Any

import numpy as np

from diagnoserl import bayes
from diagnoserl.baselines.base import (
    Policy,
    declaration_utility,
    declare_action,
    must_declare,
    weighted_test_cost,
)
from diagnoserl.config.schema import DiagnosticModel
from diagnoserl.env import PublicState, RewardConfig

_MIN_COST = 1e-6  # keeps IG / cost finite for free tests


class InformationGainPolicy(Policy):
    """Greedy expected-information-gain test selection.

    Picks the legal test maximising ``IG(t) / weighted_cost(t)`` (bits per unit of
    ``lambda_cost * cost + lambda_time * duration``). Declares the maximum-posterior
    fault once its probability reaches ``threshold`` or no test offers information.
    """

    def __init__(
        self,
        model: DiagnosticModel,
        reward: RewardConfig | None = None,
        threshold: float = 0.9,
    ) -> None:
        self.model = model
        self.reward = reward or RewardConfig()
        self.threshold = threshold
        self._cost = np.maximum(weighted_test_cost(model, self.reward), _MIN_COST)
        self.name = f"info_gain(thr={threshold:g})"

    def _scores(self, state: PublicState) -> tuple[np.ndarray, np.ndarray]:
        gains = np.zeros(self.model.n_tests)
        for t in np.flatnonzero(state.mask[: self.model.n_tests]):
            gains[t] = bayes.expected_information_gain(self.model, state.belief, int(t))
        ratio = np.where(state.mask[: self.model.n_tests], gains / self._cost, -np.inf)
        return gains, ratio

    def act(self, state: PublicState, observation: np.ndarray) -> int:
        if must_declare(self.model, state) or bayes.confidence(state.belief) >= self.threshold:
            return declare_action(self.model, state)
        gains, ratio = self._scores(state)
        best = int(np.argmax(ratio))
        if gains[best] <= 1e-9:
            return declare_action(self.model, state)
        return best

    def explain(self, state: PublicState) -> dict[str, Any]:
        gains, ratio = self._scores(state)
        best = int(np.argmax(ratio))
        return {
            "method": "expected_information_gain_per_cost",
            "test": self.model.test_ids[best],
            "expected_entropy_reduction_bits": float(gains[best]),
            "weighted_cost": float(self._cost[best]),
            "gain_per_cost": float(ratio[best]),
            "current_entropy_bits": bayes.entropy(state.belief),
            "confidence": bayes.confidence(state.belief),
        }


class CostAwareBayesPolicy(Policy):
    """Expected-utility decision policy with a ``depth``-step lookahead.

    Compares the utility of declaring now::

        U(p) = max_f p_f * R_correct - (1 - p_f) * P_wrong

    with the value of running a test and then acting optimally within the
    lookahead horizon::

        Q(t) = -penalty(t) + sum_o P(o | p, t) * V(p_o)

    and runs the best test only if ``Q`` beats ``U``. Unlike information gain it
    optimises the actual reward, so it stops when more evidence cannot pay for
    itself. With ``depth=1`` it is myopic (can stop too early when a single test
    cannot change the decision); ``depth=2`` fixes many such cases.
    """

    def __init__(
        self, model: DiagnosticModel, reward: RewardConfig | None = None, depth: int = 2
    ) -> None:
        if depth < 1:
            raise ValueError("depth must be >= 1")
        self.model = model
        self.reward = reward or RewardConfig()
        self.depth = depth
        self._pen = weighted_test_cost(model, self.reward)
        self.name = f"cost_aware_bayes(d={depth})"

    def _value(self, p: np.ndarray, executed: np.ndarray, steps: int, depth: int) -> float:
        value = declaration_utility(p, self.reward)
        if depth == 0:
            return value
        best_q = self._best_test(p, executed, steps, depth)[1]
        return float(max(value, best_q))

    def _q(self, p: np.ndarray, executed: np.ndarray, steps: int, depth: int, t: int) -> float:
        probs = bayes.outcome_probabilities(self.model, p, t)
        nxt = executed.copy()
        nxt[t] = True
        total = float(-self._pen[t])
        for o, po in enumerate(probs):
            if po <= 0.0:
                continue
            post = bayes.posterior_after(self.model, p, t, o)
            if post is not None:
                total += float(po) * self._value(post, nxt, steps + 1, depth - 1)
        return total

    def _best_test(
        self, p: np.ndarray, executed: np.ndarray, steps: int, depth: int
    ) -> tuple[int, float]:
        # A test taken as step (steps + 1) must not be the final step (would truncate).
        if steps + 1 >= self.model.max_steps:
            return -1, -np.inf
        best_t, best_q = -1, -np.inf
        for t in np.flatnonzero(self.model.available_tests(executed)):
            q = self._q(p, executed, steps, depth, int(t))
            if q > best_q:
                best_t, best_q = int(t), q
        return best_t, best_q

    def act(self, state: PublicState, observation: np.ndarray) -> int:
        if must_declare(self.model, state):
            return declare_action(self.model, state)
        test, q = self._best_test(state.belief, state.executed, state.steps, self.depth)
        if test >= 0 and q > declaration_utility(state.belief, self.reward):
            return test
        return declare_action(self.model, state)

    def explain(self, state: PublicState) -> dict[str, Any]:
        declare_u = declaration_utility(state.belief, self.reward)
        info: dict[str, Any] = {
            "method": f"expected_utility_lookahead_depth_{self.depth}",
            "utility_declare_now": declare_u,
            "confidence": bayes.confidence(state.belief),
        }
        if not must_declare(self.model, state):
            test, q = self._best_test(state.belief, state.executed, state.steps, self.depth)
            if test >= 0:
                info.update(
                    test=self.model.test_ids[test],
                    utility_best_test=q,
                    value_of_testing=q - declare_u,
                    weighted_cost=float(self._pen[test]),
                )
        return info
