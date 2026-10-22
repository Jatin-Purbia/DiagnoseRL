"""Sensitivity and generalisation experiments.

The RL agent is **not retrained** for these shifted conditions: it is the policy
trained under nominal settings, deployed on a changed simulator. Because the
environment computes the observation posterior from the (shifted) model it is
given, the agent sees a correct belief, but its learned decision rule was fit to
nominal noise / costs / priors. Baselines are rebuilt for the shifted model with
their nominal tuned parameters (cost-aware Bayes re-optimises for the shifted
reward by construction). Differences therefore measure *how well a nominal policy
transfers*, not what an agent retrained for each condition could achieve.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from diagnoserl.baselines import Policy
from diagnoserl.config import DiagnosticModel
from diagnoserl.config.transforms import shifted_prior, with_noise, with_prior
from diagnoserl.env import DiagnoseRLEnv, RewardConfig
from diagnoserl.evaluation.experiment import evaluate_trials, headline_baselines
from diagnoserl.evaluation.stats import bootstrap_mean_ci
from diagnoserl.incident import generate_incidents


@dataclass(frozen=True)
class EnvSpec:
    """One evaluation condition."""

    model: DiagnosticModel  # true simulator (also the agents' belief model)
    reward: RewardConfig
    sampling_prior: np.ndarray | None = None  # if set: incidents drawn from this prior,
    # while beliefs keep using ``model.prior`` (misspecified prior)


def evaluate_condition(
    spec: EnvSpec,
    tuned: Mapping[str, Any],
    rl_policies: Mapping[str, Policy],
    n_episodes: int,
    seed: int,
    include_posterior: bool = True,
    random_trials: int = 3,
) -> dict[str, dict[str, float]]:
    """Mean reward (with 95% bootstrap CI), accuracy and tests per policy in one condition."""
    incidents = generate_incidents(spec.model, n_episodes, seed, prior=spec.sampling_prior)
    env = DiagnoseRLEnv(
        spec.model,
        spec.reward,
        include_posterior=include_posterior,
        sampling_prior=spec.sampling_prior,
    )
    factories: dict[str, Callable[[], Policy]] = dict(
        headline_baselines(spec.model, spec.reward, tuned)
    )
    out: dict[str, dict[str, float]] = {}
    for name, make in factories.items():
        trials = random_trials if name == "random" else 1
        ev = evaluate_trials(env, make, incidents, spec.model, trials)
        out[name] = _row(ev.rewards, ev.summary)
    if rl_policies:
        rewards, accs, tests = [], [], []
        for policy in rl_policies.values():
            ev = evaluate_trials(env, lambda p=policy: p, incidents, spec.model)  # type: ignore[misc]
            rewards.append(ev.rewards)
            accs.append(ev.summary["accuracy"])
            tests.append(ev.summary["mean_tests"])
        mean_rewards = np.mean(rewards, axis=0)
        ci = bootstrap_mean_ci(mean_rewards)
        out["ppo"] = {
            "mean_reward": ci.mean,
            "ci_low": ci.low,
            "ci_high": ci.high,
            "accuracy": float(np.mean(accs)),
            "mean_tests": float(np.mean(tests)),
            "seed_std_reward": float(np.std([r.mean() for r in rewards], ddof=1))
            if len(rewards) > 1
            else 0.0,
        }
    return out


def _row(rewards: np.ndarray, summary: Mapping[str, Any]) -> dict[str, float]:
    ci = bootstrap_mean_ci(rewards)
    return {
        "mean_reward": ci.mean,
        "ci_low": ci.low,
        "ci_high": ci.high,
        "accuracy": float(summary["accuracy"]),
        "mean_tests": float(summary["mean_tests"]),
    }


def sweep(
    values: Sequence[float],
    build: Callable[[float], EnvSpec],
    tuned: Mapping[str, Any],
    rl_policies: Mapping[str, Policy],
    n_episodes: int,
    seed: int,
    include_posterior: bool = True,
) -> list[dict[str, Any]]:
    """Evaluate every policy at each parameter value; returns flat rows."""
    rows: list[dict[str, Any]] = []
    for v in values:
        res = evaluate_condition(
            build(v), tuned, rl_policies, n_episodes, seed, include_posterior=include_posterior
        )
        rows.extend({"param": v, "policy": name} | metrics for name, metrics in res.items())
    return rows


# Condition builders -----------------------------------------------------------------
def noise_condition(model: DiagnosticModel, reward: RewardConfig) -> Callable[[float], EnvSpec]:
    return lambda eps: EnvSpec(with_noise(model, eps), reward)


def wrong_penalty_condition(
    model: DiagnosticModel, reward: RewardConfig
) -> Callable[[float], EnvSpec]:
    return lambda pw: EnvSpec(model, RewardConfig(**{**reward.__dict__, "penalty_wrong": pw}))


def cost_multiplier_condition(
    model: DiagnosticModel, reward: RewardConfig
) -> Callable[[float], EnvSpec]:
    """Make testing more expensive by scaling ``lambda_cost`` and ``lambda_time``."""
    return lambda k: EnvSpec(
        model,
        RewardConfig(
            **{
                **reward.__dict__,
                "lambda_cost": reward.lambda_cost * k,
                "lambda_time": reward.lambda_time * k,
            }
        ),
    )


def prior_shift_conditions(
    model: DiagnosticModel, reward: RewardConfig, seeds: Sequence[int], concentration: float = 1.0
) -> list[tuple[str, EnvSpec]]:
    """Informed shifts (beliefs use the new prior) and misspecified shifts (they do not)."""
    conds: list[tuple[str, EnvSpec]] = []
    for s in seeds:
        p = shifted_prior(model, seed=s, concentration=concentration)
        conds.append((f"informed_{s}", EnvSpec(with_prior(model, p), reward)))
        conds.append((f"misspecified_{s}", EnvSpec(model, reward, sampling_prior=p)))
    return conds
