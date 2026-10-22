"""Advisor mode: suggest the next diagnostic step; a human approves every real action."""

from __future__ import annotations

import numpy as np

from diagnoserl import bayes
from diagnoserl.baselines.base import Policy
from diagnoserl.config.schema import DiagnosticModel
from diagnoserl.env import PublicState
from diagnoserl.historical.adapters import AdapterRegistry


class AdvisorSession:
    """Tracks evidence from real (adapter-run) tests and recommends what to do next.

    The advisor never acts on its own: ``run_test`` needs a named approver, and there is no
    remediation capability. The hidden-fault machinery of the simulator is not used; the
    belief comes only from outcomes returned by adapters.
    """

    def __init__(
        self,
        model: DiagnosticModel,
        policy: Policy,
        registry: AdapterRegistry,
    ) -> None:
        self.model = model
        self.policy = policy
        self.registry = registry
        self._executed = np.zeros(model.n_tests, dtype=bool)
        self._outcomes = np.full(model.n_tests, -1, dtype=np.int64)
        self._log_belief = bayes.initial_log_belief(model)
        self._steps = 0
        self._cost = 0.0
        self._elapsed = 0.0

    def state(self) -> PublicState:
        mask = np.ones(self.model.n_actions, dtype=bool)
        mask[: self.model.n_tests] = self.model.available_tests(self._executed)
        return PublicState(
            executed=self._executed.copy(),
            outcomes=self._outcomes.copy(),
            belief=bayes.belief(self._log_belief),
            cost=self._cost,
            elapsed=self._elapsed,
            steps=self._steps,
            mask=mask,
        )

    def suggest(self) -> dict[str, object]:
        """Policy suggestion with the current belief. Does not run anything."""
        state = self.state()
        obs = self._observation(state)
        action = self.policy.act(state, obs)
        if action < self.model.n_tests:
            return {
                "type": "test",
                "id": self.model.test_ids[action],
                "registered": self.model.test_ids[action] in self.registry.available(),
                "requires_approval": True,
                "explanation": self.policy.explain(state),
            }
        fault = action - self.model.n_tests
        return {
            "type": "declare",
            "id": self.model.fault_ids[fault],
            "confidence": float(state.belief[fault]),
            "explanation": self.policy.explain(state),
        }

    def run_test(self, test_id: str, approved_by: str | None) -> str:
        """Execute a registered read-only adapter after human approval and update the belief."""
        if test_id not in self.model.test_ids:
            raise KeyError(test_id)
        t = self.model.test_ids.index(test_id)
        if not self.state().mask[t]:
            raise ValueError(f"test {test_id!r} is not currently eligible")
        outcome = self.registry.execute(test_id, approved_by)
        if outcome not in self.model.outcome_labels:
            raise ValueError(f"adapter returned unknown outcome {outcome!r}")
        o = self.model.outcome_labels.index(outcome)
        self._log_belief = bayes.update_log_belief(self.model, self._log_belief, t, o)
        self._executed[t] = True
        self._outcomes[t] = o
        self._steps += 1
        self._cost += float(self.model.cost[t])
        self._elapsed += float(self.model.duration[t])
        return outcome

    def _observation(self, state: PublicState) -> np.ndarray:
        """Observation vector with the same layout as the training environment."""
        m = self.model
        onehot = np.zeros((m.n_tests, m.n_outcomes), dtype=np.float32)
        ran = np.flatnonzero(state.executed)
        onehot[ran, state.outcomes[ran]] = 1.0
        spend = np.array(
            [
                state.cost / (float(m.cost.sum()) or 1.0),
                state.elapsed / (float(m.duration.sum()) or 1.0),
                (m.max_steps - state.steps) / m.max_steps,
            ],
            dtype=np.float32,
        )
        vector = np.concatenate(
            [
                onehot.ravel(),
                state.executed.astype(np.float32),
                spend,
                state.belief.astype(np.float32),
            ]
        )
        return np.asarray(np.clip(vector, 0.0, 1.0))
