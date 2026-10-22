"""How adaptively does each policy stop?

For each policy, over the held-out test incidents, record how many tests it ran and how confident
the posterior was when it declared. A policy that stops adaptively runs few tests when evidence
is conclusive and more when it is not, so its test count varies across incidents and its
declaration confidence is high. A fixed-count policy has zero variance by construction.

Usage::

    python -m diagnoserl.evaluation.stopping --runs artifacts/runs/full_seed0 ... \
        --out artifacts/eval/standard/stopping.json
"""

from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np

from diagnoserl.baselines import (
    CostAwareBayesPolicy,
    FixedOrderPolicy,
    InformationGainPolicy,
    Policy,
)
from diagnoserl.config import DiagnosticModel
from diagnoserl.env import DiagnoseRLEnv, RewardConfig
from diagnoserl.incident import Incident, generate_incidents


def stopping_profile(
    env: DiagnoseRLEnv, policy: Policy, incidents: Sequence[Incident]
) -> dict[str, float]:
    """Per-episode number of tests and posterior confidence at the moment of declaring."""
    n_tests: list[int] = []
    confidence: list[float] = []
    correct: list[bool] = []
    for k, inc in enumerate(incidents):
        obs, _ = env.reset(options={"incident": inc})
        policy.reset(seed=k)
        done = False
        info: dict[str, Any] = {}
        conf = 0.0
        while not done:
            state = env.public_state()
            conf = float(state.belief.max())
            action = policy.act(state, obs)
            obs, _, term, trunc, info = env.step(action)
            done = term or trunc
        n_tests.append(int(info["tests_run"]))
        confidence.append(conf)
        correct.append(bool(info["correct"]))
    arr = np.asarray(n_tests, dtype=float)
    conf_arr = np.asarray(confidence)
    corr = np.asarray(correct)
    low = conf_arr < np.median(conf_arr)
    return {
        "mean_tests": float(arr.mean()),
        "std_tests": float(arr.std(ddof=1)),
        "p10_tests": float(np.percentile(arr, 10)),
        "p90_tests": float(np.percentile(arr, 90)),
        "mean_confidence_at_declaration": float(conf_arr.mean()),
        "accuracy_low_confidence_half": float(corr[low].mean()),
        "accuracy_high_confidence_half": float(corr[~low].mean()),
        "tests_vs_confidence_correlation": float(np.corrcoef(arr, conf_arr)[0, 1])
        if arr.std() > 0 and conf_arr.std() > 0
        else 0.0,
    }


def compare_stopping(
    model: DiagnosticModel,
    reward: RewardConfig,
    incidents: Sequence[Incident],
    rl_policies: Mapping[str, Policy],
    tuned: Mapping[str, Any],
) -> dict[str, dict[str, float]]:
    env = DiagnoseRLEnv(model, reward)
    policies: dict[str, Policy] = {
        "fixed_order": FixedOrderPolicy(model, max_tests=int(tuned["fixed_order"])),
        "info_gain": InformationGainPolicy(model, reward, threshold=float(tuned["info_gain"])),
        "cost_aware_bayes": CostAwareBayesPolicy(
            model, reward, depth=int(tuned["cost_aware_bayes"])
        ),
        **dict(rl_policies),
    }
    return {name: stopping_profile(env, p, incidents) for name, p in policies.items()}


def main() -> None:
    from diagnoserl.evaluation.run import load_runs

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", nargs="+", required=True)
    parser.add_argument("--results", required=True, help="results.json (for the tuned baselines)")
    parser.add_argument("--out", required=True)
    parser.add_argument("--n-test", type=int, default=2000)
    args = parser.parse_args()
    cfg, rl = load_runs([Path(r) for r in args.runs], "best")
    model = cfg.load_scenario()
    tuned = json.loads(Path(args.results).read_text())["tuned_on_validation"]
    incidents = generate_incidents(model, args.n_test, cfg.test_seed)
    out = compare_stopping(model, cfg.reward.to_reward_config(), incidents, rl, tuned)
    Path(args.out).write_text(json.dumps(out, indent=2), encoding="utf-8")
    for name, p in out.items():
        print(
            f"{name:18s} tests {p['mean_tests']:.2f} ± {p['std_tests']:.2f} "
            f"[p10 {p['p10_tests']:.0f}, p90 {p['p90_tests']:.0f}]  "
            f"conf@declare {p['mean_confidence_at_declaration']:.3f}  "
            f"acc low/high conf {p['accuracy_low_confidence_half']:.2f}/"
            f"{p['accuracy_high_confidence_half']:.2f}"
        )


if __name__ == "__main__":
    main()
