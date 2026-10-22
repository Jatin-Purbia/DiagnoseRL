"""Main policy comparison on a held-out incident set.

Protocol
--------
* Baseline hyper-parameters (fixed-order ``k``, random stop probability,
  information-gain threshold) are **tuned on the validation incidents**.
* Every policy is then scored on the same **test incidents** (disjoint seed).
* RL results are reported per training seed and as mean +/- std over seeds. For
  paired comparisons the per-incident reward is averaged over seeds.
* Randomised policies are run for several independent trials; per-incident reward is
  averaged over trials so it stays aligned with the incident list.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from functools import partial
from typing import Any

import numpy as np

from diagnoserl.baselines import (
    CostAwareBayesPolicy,
    FixedOrderPolicy,
    InformationGainPolicy,
    Policy,
    RandomPolicy,
)
from diagnoserl.config import DiagnosticModel
from diagnoserl.env import DiagnoseRLEnv, RewardConfig
from diagnoserl.evaluation.metrics import summarize
from diagnoserl.evaluation.runner import EpisodeRecord, evaluate_policy
from diagnoserl.evaluation.stats import bootstrap_mean_ci, mean_std, paired_bootstrap_diff
from diagnoserl.incident import Incident

SCALAR_METRICS = (
    "accuracy",
    "incorrect_rate",
    "no_diagnosis_rate",
    "mean_tests",
    "mean_cost",
    "mean_duration",
    "median_duration",
    "p90_duration",
    "mean_reward",
)

FIXED_KS = tuple(range(0, 9))
RANDOM_STOPS = (0.1, 0.2, 0.3, 0.5)
IG_THRESHOLDS = (0.5, 0.7, 0.8, 0.9, 0.95, 0.99)


@dataclass
class PolicyEval:
    """Evaluation of one (possibly multi-trial) policy on one incident set."""

    name: str
    summary: dict[str, Any]
    rewards: np.ndarray  # per incident, averaged over trials
    records: list[EpisodeRecord] = field(repr=False, default_factory=list)


def evaluate_trials(
    env: DiagnoseRLEnv,
    make_policy: Callable[[], Policy],
    incidents: Sequence[Incident],
    model: DiagnosticModel,
    trials: int = 1,
) -> PolicyEval:
    """Evaluate a policy for ``trials`` independent seeds (use >1 for randomised policies)."""
    all_records: list[EpisodeRecord] = []
    per_trial_rewards = []
    name = ""
    for trial in range(trials):
        policy = make_policy()
        name = policy.name
        recs = evaluate_policy(env, policy, incidents, policy_seed=trial)
        all_records.extend(recs)
        per_trial_rewards.append([r.reward for r in recs])
    return PolicyEval(
        name=name,
        summary=summarize(all_records, model),
        rewards=np.mean(per_trial_rewards, axis=0),
        records=all_records,
    )


def build_baseline_factories(
    model: DiagnosticModel, reward: RewardConfig
) -> dict[str, dict[Any, Callable[[], Policy]]]:
    """Parameter sweeps for the tunable baselines, keyed by family then parameter."""
    return {
        "fixed_order": {k: partial(FixedOrderPolicy, model, max_tests=k) for k in FIXED_KS},
        "random": {s: partial(RandomPolicy, model, stop_prob=s) for s in RANDOM_STOPS},
        "info_gain": {
            t: partial(InformationGainPolicy, model, reward, threshold=t) for t in IG_THRESHOLDS
        },
        "cost_aware_bayes": {
            1: partial(CostAwareBayesPolicy, model, reward, depth=1),
            2: partial(CostAwareBayesPolicy, model, reward, depth=2),
        },
    }


def tune_on_validation(
    model: DiagnosticModel,
    reward: RewardConfig,
    val_incidents: Sequence[Incident],
    include_posterior: bool = True,
) -> dict[str, Any]:
    """Pick, per tunable family, the parameter with the best mean *validation* reward."""
    env = DiagnoseRLEnv(model, reward, include_posterior=include_posterior)
    factories = build_baseline_factories(model, reward)
    chosen: dict[str, Any] = {}
    for family, sweep in factories.items():
        scores = {}
        for param, make in sweep.items():
            trials = 3 if family == "random" else 1
            scores[param] = float(
                evaluate_trials(env, make, val_incidents, model, trials).rewards.mean()
            )
        chosen[family] = max(scores, key=lambda p: scores[p])
    return chosen


def headline_baselines(
    model: DiagnosticModel, reward: RewardConfig, tuned: Mapping[str, Any]
) -> dict[str, Callable[[], Policy]]:
    """The baselines reported in the main table, with validation-tuned parameters."""
    f = build_baseline_factories(model, reward)
    return {
        "fixed_order": f["fixed_order"][tuned["fixed_order"]],
        "random": f["random"][tuned["random"]],
        "info_gain": f["info_gain"][tuned["info_gain"]],
        "cost_aware_bayes": f["cost_aware_bayes"][tuned["cost_aware_bayes"]],
    }


def aggregate_seeds(per_seed: Mapping[str, dict[str, Any]]) -> dict[str, dict[str, float]]:
    """Mean and std of scalar metrics across training seeds."""
    out: dict[str, dict[str, float]] = {}
    for metric in SCALAR_METRICS:
        mean, std = mean_std([float(s[metric]) for s in per_seed.values()])
        out[metric] = {"mean": mean, "std": std}
    return out


def compare_policies(
    model: DiagnosticModel,
    reward: RewardConfig,
    val_incidents: Sequence[Incident],
    test_incidents: Sequence[Incident],
    rl_policies: Mapping[str, Policy],
    *,
    include_posterior: bool = True,
    random_trials: int = 5,
) -> dict[str, Any]:
    """Full comparison; returns a JSON-serialisable result dict (plus raw arrays under ``_raw``)."""
    tuned = tune_on_validation(model, reward, val_incidents, include_posterior)
    env = DiagnoseRLEnv(model, reward, include_posterior=include_posterior)

    evals: dict[str, PolicyEval] = {}
    for family, make in headline_baselines(model, reward, tuned).items():
        trials = random_trials if family == "random" else 1
        evals[family] = evaluate_trials(env, make, test_incidents, model, trials)

    sweeps: list[dict[str, Any]] = []
    for family, sweep in build_baseline_factories(model, reward).items():
        for param, make in sweep.items():
            trials = random_trials if family == "random" else 1
            ev = evaluate_trials(env, make, test_incidents, model, trials)
            sweeps.append(
                {"family": family, "param": param}
                | {
                    m: ev.summary[m]
                    for m in ("accuracy", "mean_cost", "mean_tests", "mean_duration", "mean_reward")
                }
            )

    rl_per_seed: dict[str, dict[str, Any]] = {}
    rl_rewards = []
    rl_records: dict[str, list[EpisodeRecord]] = {}
    for seed_name, policy in rl_policies.items():
        ev = evaluate_trials(env, lambda p=policy: p, test_incidents, model)  # type: ignore[misc]
        rl_per_seed[seed_name] = ev.summary
        rl_rewards.append(ev.rewards)
        rl_records[seed_name] = ev.records
    rl_mean_rewards = np.mean(rl_rewards, axis=0) if rl_rewards else None

    results: dict[str, Any] = {
        "n_test_episodes": len(test_incidents),
        "n_val_episodes": len(val_incidents),
        "reward_config": reward.__dict__,
        "tuned_on_validation": {k: v for k, v in tuned.items()},
        "baselines": {},
        "rl": {},
        "paired_rl_minus_baseline": {},
        "sweeps": sweeps,
    }
    for name, ev in evals.items():
        ci = bootstrap_mean_ci(ev.rewards)
        results["baselines"][name] = {
            "summary": ev.summary,
            "reward_ci": [ci.low, ci.high],
        }
    if rl_mean_rewards is not None:
        ci = bootstrap_mean_ci(rl_mean_rewards)
        results["rl"] = {
            "per_seed": {k: {m: v[m] for m in SCALAR_METRICS} for k, v in rl_per_seed.items()},
            "per_seed_full": rl_per_seed,
            "aggregate": aggregate_seeds(rl_per_seed),
            "seed_averaged_reward_ci": [ci.low, ci.high],
        }
        for name, ev in evals.items():
            d = paired_bootstrap_diff(rl_mean_rewards, ev.rewards)
            results["paired_rl_minus_baseline"][name] = {
                "mean_diff": d.mean,
                "ci_low": d.low,
                "ci_high": d.high,
                "significant": d.excludes_zero(),
            }
    results["_raw"] = {"baseline_evals": evals, "rl_records": rl_records}
    return results


def strip_raw(results: Mapping[str, Any]) -> dict[str, Any]:
    """Drop non-serialisable raw objects before writing JSON."""
    return {k: v for k, v in results.items() if k != "_raw"}
