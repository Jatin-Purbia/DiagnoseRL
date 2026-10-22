"""Replay-style evaluation on historical incidents.

Historical records only contain the outcomes of the tests engineers happened to run. A new
policy may ask for a test that was never run in an incident; its outcome is *unknown*.

This module therefore reports two clearly separated things:

* **observed replay** - episodes in which every test the policy asked for has a recorded
  outcome. Only these can be scored directly. They are a *biased subset* (incidents where the
  policy agrees with what engineers did), so the accuracy here must not be read as the
  policy's accuracy on all incidents or as an unbiased counterfactual.
* **coverage** - the share of incidents for which the policy stayed within observed tests.

For incidents where the policy goes beyond the data, evaluation needs the estimated model
(simulated outcomes). That is model-based and inherits the model's assumptions; it is not
direct evidence of what would have happened.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from diagnoserl.baselines.base import Policy
from diagnoserl.config.schema import DiagnosticModel
from diagnoserl.env import DiagnoseRLEnv, RewardConfig
from diagnoserl.historical.schema import HistoricalIncident
from diagnoserl.incident import Incident


@dataclass(frozen=True)
class ReplayResult:
    n_incidents: int
    n_unknown_cause: int  # confirmed cause not in the model: cannot be scored
    n_fully_observed: int  # policy stayed within recorded outcomes
    coverage: float  # n_fully_observed / scorable incidents
    accuracy_on_observed: float | None  # biased subset; see module docstring
    mean_reward_on_observed: float | None
    mean_tests_on_observed: float | None
    human_mean_tests: float  # tests engineers ran, for context
    note: str = (
        "Scores only the biased subset where the policy used tests that engineers also ran; "
        "not an unbiased estimate of performance on all incidents."
    )


def replay_policy(
    model: DiagnosticModel,
    policy: Policy,
    incidents: Sequence[HistoricalIncident],
    reward: RewardConfig | None = None,
) -> ReplayResult:
    """Replay ``policy`` on recorded outcomes; see the module docstring for the limits."""
    reward = reward or RewardConfig()
    env = DiagnoseRLEnv(model, reward)
    test_index = {t: i for i, t in enumerate(model.test_ids)}
    outcome_index = {o: i for i, o in enumerate(model.outcome_labels)}
    fault_index = {f: i for i, f in enumerate(model.fault_ids)}

    unknown = observed_eps = correct = 0
    rewards: list[float] = []
    tests: list[int] = []
    human = [len(i.executed_ids()) for i in incidents]

    for k, inc in enumerate(incidents):
        if inc.confirmed_root_cause not in fault_index:
            unknown += 1
            continue
        table = np.zeros(model.n_tests, dtype=np.int64)
        known = np.zeros(model.n_tests, dtype=bool)
        for tid, rec in inc.observed().items():
            if tid in test_index and rec.outcome in outcome_index:
                table[test_index[tid]] = outcome_index[rec.outcome]
                known[test_index[tid]] = True
        obs, _ = env.reset(
            options={"incident": Incident(k, fault_index[inc.confirmed_root_cause], table)}
        )
        policy.reset(seed=k)
        total, done, within = 0.0, False, True
        info: dict[str, object] = {}
        while not done:
            action = policy.act(env.public_state(), obs)
            if action < model.n_tests and not known[action]:
                within = False  # asked for a test with no recorded outcome
                break
            obs, r, term, trunc, info = env.step(action)
            total += r
            done = term or trunc
        if within:
            observed_eps += 1
            correct += int(bool(info.get("correct")))
            rewards.append(total)
            tests.append(int(info["tests_run"]))  # type: ignore[call-overload]

    scorable = len(incidents) - unknown
    return ReplayResult(
        n_incidents=len(incidents),
        n_unknown_cause=unknown,
        n_fully_observed=observed_eps,
        coverage=observed_eps / scorable if scorable else 0.0,
        accuracy_on_observed=correct / observed_eps if observed_eps else None,
        mean_reward_on_observed=float(np.mean(rewards)) if rewards else None,
        mean_tests_on_observed=float(np.mean(tests)) if tests else None,
        human_mean_tests=float(np.mean(human)) if human else 0.0,
    )
