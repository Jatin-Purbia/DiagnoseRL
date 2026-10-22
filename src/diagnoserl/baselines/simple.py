"""Fixed-order and random baselines."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from diagnoserl.baselines.base import Policy, declare_action, must_declare
from diagnoserl.config.schema import DiagnosticModel
from diagnoserl.env import PublicState


class FixedOrderPolicy(Policy):
    """Runbook-style: run tests in a predetermined order, then declare.

    Stops after ``max_tests`` tests (default: as many as the step cap allows).
    Tests that are currently ineligible (unmet prerequisite) are skipped.
    Declares the maximum-posterior fault.
    """

    def __init__(
        self,
        model: DiagnosticModel,
        order: Sequence[int] | None = None,
        max_tests: int | None = None,
    ) -> None:
        self.model = model
        self.order = list(order) if order is not None else list(range(model.n_tests))
        self.max_tests = max_tests if max_tests is not None else model.max_steps - 1
        self.name = f"fixed_order(k={self.max_tests})"

    def act(self, state: PublicState, observation: np.ndarray) -> int:
        if must_declare(self.model, state) or int(state.executed.sum()) >= self.max_tests:
            return declare_action(self.model, state)
        for t in self.order:
            if state.mask[t]:
                return t
        return declare_action(self.model, state)


class RandomPolicy(Policy):
    """Random troubleshooting.

    At every step, stop and declare with probability ``stop_prob``; otherwise run
    a uniformly random legal test. The declaration is the maximum-posterior
    fault, which keeps the comparison about *test selection and stopping* rather
    than about diagnosis from evidence. Use many independent seeds.
    """

    def __init__(self, model: DiagnosticModel, stop_prob: float = 0.2, seed: int = 0) -> None:
        if not 0.0 <= stop_prob <= 1.0:
            raise ValueError("stop_prob must be in [0, 1]")
        self.model = model
        self.stop_prob = stop_prob
        self._seed = seed
        self._rng = np.random.default_rng(seed)
        self.name = f"random(stop={stop_prob:g})"

    def reset(self, seed: int | None = None) -> None:
        self._rng = np.random.default_rng(self._seed if seed is None else seed)

    def act(self, state: PublicState, observation: np.ndarray) -> int:
        if must_declare(self.model, state) or self._rng.random() < self.stop_prob:
            return declare_action(self.model, state)
        legal = np.flatnonzero(state.mask[: self.model.n_tests])
        return int(self._rng.choice(legal))
