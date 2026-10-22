"""Evaluate trained agents against all baselines on held-out incidents.

Usage::

    python -m diagnoserl.evaluation.run \\
        --runs artifacts/runs/full_seed0 artifacts/runs/full_seed1 artifacts/runs/full_seed2 \\
        --out artifacts/eval/standard

Uses the *test* seed recorded in each run's config (never used in training or in
model selection). Baseline parameters are tuned on the validation seed.
"""

from __future__ import annotations

import argparse
import json
import logging
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from diagnoserl.agents import RLPolicy
from diagnoserl.baselines import ExactPolicy, Policy, ScenarioTooLargeError
from diagnoserl.config import DiagnosticModel
from diagnoserl.env import DiagnoseRLEnv, RewardConfig
from diagnoserl.evaluation import plots, robustness
from diagnoserl.evaluation.experiment import (
    compare_policies,
    evaluate_trials,
    strip_raw,
    tune_on_validation,
)
from diagnoserl.incident import generate_incidents
from diagnoserl.logging_config import configure_logging
from diagnoserl.training.config import TrainConfig

log = logging.getLogger(__name__)

NOISE_LEVELS = (0.0, 0.1, 0.2, 0.3, 0.4, 0.5)
WRONG_PENALTIES = (2.0, 5.0, 10.0, 20.0, 40.0)
COST_MULTIPLIERS = (0.25, 0.5, 1.0, 2.0, 4.0)
PRIOR_SHIFT_SEEDS = (1, 2, 3, 4, 5)


def load_runs(run_dirs: list[Path], which: str) -> tuple[TrainConfig, dict[str, Policy]]:
    """Load the common config and one RL policy per run directory."""
    cfgs = [
        TrainConfig.model_validate_json((r / "config.json").read_text(encoding="utf-8"))
        for r in run_dirs
    ]
    base = cfgs[0]
    for c in cfgs[1:]:
        same = (c.scenario, c.reward, c.include_posterior, c.val_seed, c.test_seed) == (
            base.scenario,
            base.reward,
            base.include_posterior,
            base.val_seed,
            base.test_seed,
        )
        if not same:
            raise ValueError("runs must share scenario, reward, observation and eval seeds")
    policies: dict[str, Policy] = {
        r.name: RLPolicy.load(r / f"{which}_model.zip", name=f"ppo_{r.name}")
        for r, c in zip(run_dirs, cfgs, strict=True)
    }
    return base, policies


def format_report(results: Mapping[str, Any], title: str) -> str:
    """Markdown tables generated from the recorded results."""
    lines = [f"# {title}", ""]
    lines += [
        f"Test episodes: {results['n_test_episodes']} (seed disjoint from training/validation). "
        f"Baseline parameters tuned on {results['n_val_episodes']} validation episodes: "
        f"`{json.dumps(results['tuned_on_validation'])}`.",
        "",
        "| policy | accuracy | tests | cost | duration | no-diagnosis | mean reward (95% CI) |",
        "|---|---|---|---|---|---|---|",
    ]
    for name, e in results["baselines"].items():
        s, (lo, hi) = e["summary"], e["reward_ci"]
        lines.append(
            f"| {name} | {s['accuracy']:.3f} | {s['mean_tests']:.2f} | {s['mean_cost']:.2f} | "
            f"{s['mean_duration']:.1f} | {s['no_diagnosis_rate']:.3f} | "
            f"{s['mean_reward']:.2f} [{lo:.2f}, {hi:.2f}] |"
        )
    if results.get("rl"):
        a = results["rl"]["aggregate"]

        def f(m: str, d: int = 3) -> str:
            return f"{a[m]['mean']:.{d}f} ± {a[m]['std']:.{d}f}"

        lines.append(
            f"| ppo (mean ± std over {len(results['rl']['per_seed'])} seeds) | {f('accuracy')} | "
            f"{f('mean_tests', 2)} | {f('mean_cost', 2)} | {f('mean_duration', 1)} | "
            f"{f('no_diagnosis_rate')} | {f('mean_reward', 2)} |"
        )
        lines += [
            "",
            "Per-seed PPO:",
            "",
            "| seed | accuracy | tests | mean reward |",
            "|---|---|---|---|",
        ]
        for seed, row in results["rl"]["per_seed"].items():
            lines.append(
                f"| {seed} | {row['accuracy']:.3f} | {row['mean_tests']:.2f} | "
                f"{row['mean_reward']:.2f} |"
            )
        lines += [
            "",
            "Paired bootstrap, seed-averaged PPO minus baseline (mean reward per episode):",
            "",
            "| baseline | difference | 95% CI | excludes 0 |",
            "|---|---|---|---|",
        ]
        for name, d in results["paired_rl_minus_baseline"].items():
            lines.append(
                f"| {name} | {d['mean_diff']:+.3f} | [{d['ci_low']:+.3f}, {d['ci_high']:+.3f}] | "
                f"{'yes' if d['significant'] else 'no'} |"
            )
    ref = results.get("reference", {}).get("exact")
    if ref:
        lines += [
            "",
            f"Exact optimal value (dynamic programming): {ref['optimal_value']:.3f}; "
            f"exact policy simulated reward: {ref['summary']['mean_reward']:.3f}.",
        ]
    return "\n".join(lines) + "\n"


def run(args: argparse.Namespace) -> None:
    run_dirs = [Path(p) for p in args.runs]
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    cfg, rl_policies = load_runs(run_dirs, args.model)
    model: DiagnosticModel = cfg.load_scenario()
    reward: RewardConfig = cfg.reward.to_reward_config()
    inc_post = cfg.include_posterior

    val = generate_incidents(model, args.n_val, cfg.val_seed)
    test = generate_incidents(model, args.n_test, cfg.test_seed)
    log.info("comparing policies", extra={"n_test": len(test), "runs": len(rl_policies)})
    results = compare_policies(model, reward, val, test, rl_policies, include_posterior=inc_post)

    # Exact reference (small scenarios only).
    try:
        exact = ExactPolicy(model, reward)
        env = DiagnoseRLEnv(model, reward, include_posterior=inc_post)
        ev = evaluate_trials(env, lambda: exact, test, model)
        results["reference"] = {
            "exact": {"optimal_value": exact.solver.optimal_value(), "summary": ev.summary}
        }
    except ScenarioTooLargeError:
        log.info("exact solver skipped: scenario too large")

    # Figures.
    fig_dir = out / "figures"
    plots.tradeoff_plot(
        results, "mean_cost", "mean testing cost (units)", fig_dir / "accuracy_vs_cost.png"
    )
    plots.tradeoff_plot(
        results,
        "mean_duration",
        "mean diagnostic duration (s)",
        fig_dir / "accuracy_vs_duration.png",
    )
    plots.reward_bar_plot(results, fig_dir / "reward_by_strategy.png")
    plots.reward_bar_plot(results, fig_dir / "tests_by_strategy.png", metric="mean_tests")
    plots.training_curves_plot(run_dirs, fig_dir / "training_curves.png")
    plots.confusion_matrix_plot(
        results["baselines"]["cost_aware_bayes"]["summary"]["confusion_matrix"],
        model,
        "cost-aware Bayes",
        fig_dir / "confusion_cost_aware_bayes.png",
    )
    first = next(iter(results["rl"]["per_seed_full"].items()), None) if results.get("rl") else None
    if first:
        plots.confusion_matrix_plot(
            first[1]["confusion_matrix"], model, f"PPO ({first[0]})", fig_dir / "confusion_ppo.png"
        )
        env = DiagnoseRLEnv(model, reward, include_posterior=inc_post)
        plots.posterior_evolution_plot(
            model,
            env,
            next(iter(rl_policies.values())),
            test[0],
            fig_dir / "posterior_evolution_ppo.png",
            "PPO",
        )

    # Robustness / generalisation.
    if not args.skip_robustness:
        tuned = tune_on_validation(model, reward, val, inc_post)
        n_rob = args.n_robust
        robust: dict[str, Any] = {}
        robust["noise"] = robustness.sweep(
            NOISE_LEVELS,
            robustness.noise_condition(model, reward),
            tuned,
            rl_policies,
            n_rob,
            cfg.test_seed,
            inc_post,
        )
        robust["wrong_penalty"] = robustness.sweep(
            WRONG_PENALTIES,
            robustness.wrong_penalty_condition(model, reward),
            tuned,
            rl_policies,
            n_rob,
            cfg.test_seed,
            inc_post,
        )
        robust["cost_multiplier"] = robustness.sweep(
            COST_MULTIPLIERS,
            robustness.cost_multiplier_condition(model, reward),
            tuned,
            rl_policies,
            n_rob,
            cfg.test_seed,
            inc_post,
        )
        prior_rows: list[dict[str, Any]] = []
        for label, spec in robustness.prior_shift_conditions(model, reward, PRIOR_SHIFT_SEEDS):
            res = robustness.evaluate_condition(
                spec, tuned, rl_policies, n_rob, cfg.test_seed, inc_post
            )
            prior_rows.extend({"condition": label, "policy": k} | v for k, v in res.items())
        robust["prior_shift"] = prior_rows
        results["robustness"] = robust
        plots.sensitivity_plot(
            robust["noise"], "test noise epsilon", fig_dir / "sensitivity_noise.png"
        )
        plots.sensitivity_plot(
            robust["wrong_penalty"],
            "wrong-diagnosis penalty",
            fig_dir / "sensitivity_wrong_penalty.png",
        )
        plots.sensitivity_plot(
            robust["cost_multiplier"], "test cost multiplier", fig_dir / "sensitivity_cost.png"
        )

    (out / "results.json").write_text(json.dumps(strip_raw(results), indent=2), encoding="utf-8")
    (out / "report.md").write_text(
        format_report(results, f"DiagnoseRL results: {model.name}"), encoding="utf-8"
    )
    log.info("wrote results", extra={"out": str(out)})


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate trained agents against all baselines.")
    parser.add_argument("--runs", nargs="+", required=True, help="training run directories")
    parser.add_argument("--out", required=True, help="output directory")
    parser.add_argument(
        "--model",
        choices=["best", "final"],
        default="best",
        help="checkpoint to evaluate (best = selected on validation)",
    )
    parser.add_argument("--n-test", type=int, default=2000)
    parser.add_argument("--n-val", type=int, default=1000)
    parser.add_argument("--n-robust", type=int, default=1000)
    parser.add_argument("--skip-robustness", action="store_true")
    configure_logging()
    run(parser.parse_args())


if __name__ == "__main__":
    main()
