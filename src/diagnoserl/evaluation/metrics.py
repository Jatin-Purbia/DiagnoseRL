"""Aggregate metrics over episode records."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np

from diagnoserl.config.schema import DiagnosticModel
from diagnoserl.evaluation.runner import NO_DIAGNOSIS, EpisodeRecord


def confusion_matrix(records: Sequence[EpisodeRecord], n_faults: int) -> np.ndarray:
    """Counts ``[true fault, declared fault]``; the last column is "no diagnosis"."""
    cm = np.zeros((n_faults, n_faults + 1), dtype=np.int64)
    for r in records:
        col = n_faults if r.declared_fault == NO_DIAGNOSIS else r.declared_fault
        cm[r.true_fault, col] += 1
    return cm


def per_fault_precision_recall(cm: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Precision and recall per fault (``nan`` where undefined)."""
    n = cm.shape[0]
    tp = np.diag(cm[:, :n]).astype(float)
    declared = cm[:, :n].sum(axis=0).astype(float)  # times each fault was declared
    actual = cm.sum(axis=1).astype(float)  # incidents of each fault (incl. no-diagnosis)
    with np.errstate(divide="ignore", invalid="ignore"):
        precision = np.where(declared > 0, tp / declared, np.nan)
        recall = np.where(actual > 0, tp / actual, np.nan)
    return precision, recall


def summarize(records: Sequence[EpisodeRecord], model: DiagnosticModel) -> dict[str, Any]:
    """Headline metrics for one policy on one incident set.

    ``accuracy`` counts truncated episodes as failures (they never declared a root
    cause), so it is ``correct / all episodes``. ``incorrect_rate`` counts wrong
    declarations only; ``no_diagnosis_rate`` counts truncations.
    """
    if not records:
        raise ValueError("no episode records")
    n = len(records)
    correct = np.array([r.correct for r in records])
    truncated = np.array([r.truncated for r in records])
    n_tests = np.array([r.n_tests for r in records], dtype=float)
    elapsed = np.array([r.elapsed for r in records])
    cost = np.array([r.cost for r in records])
    reward = np.array([r.reward for r in records])

    cm = confusion_matrix(records, model.n_faults)
    precision, recall = per_fault_precision_recall(cm)

    def _nan_to_none(a: np.ndarray) -> list[float | None]:
        return [None if np.isnan(x) else float(x) for x in a]

    return {
        "n_episodes": n,
        "accuracy": float(correct.mean()),
        "incorrect_rate": float((~correct & ~truncated).mean()),
        "no_diagnosis_rate": float(truncated.mean()),
        "mean_tests": float(n_tests.mean()),
        "mean_cost": float(cost.mean()),
        "mean_duration": float(elapsed.mean()),
        "median_duration": float(np.median(elapsed)),
        "p90_duration": float(np.percentile(elapsed, 90)),
        "p95_duration": float(np.percentile(elapsed, 95)),
        "mean_reward": float(reward.mean()),
        "std_reward": float(reward.std(ddof=1)) if n > 1 else 0.0,
        "per_fault": {
            fid: {"precision": p, "recall": r}
            for fid, p, r in zip(
                model.fault_ids, _nan_to_none(precision), _nan_to_none(recall), strict=True
            )
        },
        "confusion_matrix": cm.tolist(),
    }
