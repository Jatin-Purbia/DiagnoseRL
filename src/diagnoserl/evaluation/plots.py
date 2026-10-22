"""Figures generated from recorded experiment data (never hard-coded numbers)."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.figure import Figure

from diagnoserl.baselines.base import Policy
from diagnoserl.config import DiagnosticModel
from diagnoserl.env import DiagnoseRLEnv
from diagnoserl.incident import Incident

FAMILY_STYLE = {
    "fixed_order": ("#7f7f7f", "s"),
    "random": ("#bcbd22", "x"),
    "info_gain": ("#1f77b4", "^"),
    "cost_aware_bayes": ("#2ca02c", "D"),
    "ppo": ("#d62728", "o"),
}


def _save(fig: Figure, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(path, dpi=140)
    plt.close(fig)
    return path


def tradeoff_plot(results: Mapping[str, Any], x_key: str, x_label: str, path: Path) -> Path:
    """Accuracy versus a cost axis (``mean_cost`` or ``mean_duration``)."""
    fig, ax = plt.subplots(figsize=(7, 5))
    families = sorted({s["family"] for s in results["sweeps"]})
    for fam in families:
        pts = sorted((s[x_key], s["accuracy"]) for s in results["sweeps"] if s["family"] == fam)
        color, marker = FAMILY_STYLE.get(fam, ("k", "o"))
        ax.plot(*zip(*pts, strict=True), marker=marker, color=color, alpha=0.7, label=fam)
    for seed, row in results.get("rl", {}).get("per_seed", {}).items():
        ax.scatter(
            row[x_key],
            row["accuracy"],
            color=FAMILY_STYLE["ppo"][0],
            s=70,
            marker="o",
            edgecolor="k",
            label="ppo (per seed)" if seed == next(iter(results["rl"]["per_seed"])) else None,
            zorder=5,
        )
    ax.set_xlabel(x_label)
    ax.set_ylabel("diagnostic accuracy")
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    return _save(fig, path)


def reward_bar_plot(results: Mapping[str, Any], path: Path, metric: str = "mean_reward") -> Path:
    """Mean reward (or another metric) per strategy; error bars: 95% CI / std over seeds."""
    names, vals, errs, colors = [], [], [], []
    for name, entry in results["baselines"].items():
        names.append(name)
        vals.append(entry["summary"][metric])
        if metric == "mean_reward":
            lo, hi = entry["reward_ci"]
            errs.append((entry["summary"][metric] - lo, hi - entry["summary"][metric]))
        else:
            errs.append((0.0, 0.0))
        colors.append(FAMILY_STYLE[name][0])
    if results.get("rl"):
        agg = results["rl"]["aggregate"][metric]
        names.append("ppo")
        vals.append(agg["mean"])
        errs.append((agg["std"], agg["std"]))
        colors.append(FAMILY_STYLE["ppo"][0])
    fig, ax = plt.subplots(figsize=(7, 4.5))
    ax.bar(names, vals, color=colors, yerr=np.array(errs).T, capsize=4)
    ax.set_ylabel(metric.replace("_", " "))
    ax.grid(axis="y", alpha=0.3)
    plt.setp(ax.get_xticklabels(), rotation=20, ha="right")
    return _save(fig, path)


def training_curves_plot(run_dirs: Sequence[Path], path: Path) -> Path:
    """Validation reward versus training timesteps for each seed."""
    fig, axes = plt.subplots(1, 2, figsize=(11, 4))
    for run in run_dirs:
        rows = [json.loads(line) for line in (run / "metrics.jsonl").read_text().splitlines()]
        steps = [r["timesteps"] for r in rows]
        axes[0].plot(steps, [r["mean_reward"] for r in rows], marker=".", label=run.name)
        axes[1].plot(steps, [r["mean_tests"] for r in rows], marker=".", label=run.name)
    axes[0].set_ylabel("validation mean reward")
    axes[1].set_ylabel("validation mean tests")
    for ax in axes:
        ax.set_xlabel("training timesteps")
        ax.grid(alpha=0.3)
    axes[0].legend(fontsize=8)
    return _save(fig, path)


def confusion_matrix_plot(
    cm: Sequence[Sequence[int]], model: DiagnosticModel, title: str, path: Path
) -> Path:
    """Row-normalised confusion matrix (last column = no diagnosis)."""
    arr = np.asarray(cm, dtype=float)
    norm = arr / np.maximum(arr.sum(axis=1, keepdims=True), 1)
    fig, ax = plt.subplots(figsize=(8, 6.5))
    im = ax.imshow(norm, cmap="Blues", vmin=0, vmax=1)
    ax.set_xticks(
        range(arr.shape[1]), [*model.fault_ids, "none"], rotation=60, ha="right", fontsize=8
    )
    ax.set_yticks(range(arr.shape[0]), model.fault_ids, fontsize=8)
    ax.set_xlabel("declared")
    ax.set_ylabel("true fault")
    ax.set_title(title)
    fig.colorbar(im, ax=ax, fraction=0.046)
    return _save(fig, path)


def posterior_evolution_plot(
    model: DiagnosticModel,
    env: DiagnoseRLEnv,
    policy: Policy,
    incident: Incident,
    path: Path,
    title: str = "",
) -> Path:
    """Posterior over faults after each step of one episode."""
    obs, _ = env.reset(options={"incident": incident})
    policy.reset(seed=0)
    beliefs = [env.public_state().belief]
    labels = ["prior"]
    done = False
    while not done:
        action = policy.act(env.public_state(), obs)
        obs, _, term, trunc, _ = env.step(action)
        done = term or trunc
        if action < model.n_tests:
            beliefs.append(env.public_state().belief)
            labels.append(model.test_ids[action])
        else:
            labels.append("declare " + model.fault_ids[action - model.n_tests])
    arr = np.array(beliefs)
    fig, ax = plt.subplots(figsize=(9, 4.8))
    top = np.argsort(-arr.max(axis=0))[:6]
    for f in top:
        ax.plot(
            range(len(arr)),
            arr[:, f],
            marker="o",
            label=model.fault_ids[f],
            linewidth=3 if f == incident.fault else 1.5,
        )
    ax.set_xticks(range(len(arr)), labels[: len(arr)], rotation=35, ha="right", fontsize=8)
    ax.set_ylabel("posterior probability")
    ax.set_title(f"{title} (true fault: {model.fault_ids[incident.fault]}, bold)")
    ax.legend(fontsize=8)
    ax.grid(alpha=0.3)
    return _save(fig, path)


def sensitivity_plot(
    rows: Sequence[Mapping[str, Any]], x_label: str, path: Path, y_key: str = "mean_reward"
) -> Path:
    """Policy performance as a function of one swept parameter (with 95% CI bands)."""
    fig, ax = plt.subplots(figsize=(7, 4.5))
    for policy in sorted({r["policy"] for r in rows}):
        pr = sorted((r for r in rows if r["policy"] == policy), key=lambda r: r["param"])
        x = [r["param"] for r in pr]
        y = np.array([r[y_key] for r in pr])
        color, marker = FAMILY_STYLE.get(policy, ("k", "o"))
        ax.plot(x, y, marker=marker, color=color, label=policy)
        if y_key == "mean_reward":
            ax.fill_between(
                x, [r["ci_low"] for r in pr], [r["ci_high"] for r in pr], color=color, alpha=0.15
            )
    ax.set_xlabel(x_label)
    ax.set_ylabel(y_key.replace("_", " "))
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    return _save(fig, path)
