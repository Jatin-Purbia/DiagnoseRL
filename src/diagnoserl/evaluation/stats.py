"""Bootstrap statistics for policy comparisons."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Interval:
    mean: float
    low: float
    high: float

    def excludes_zero(self) -> bool:
        return self.low > 0.0 or self.high < 0.0


def bootstrap_mean_ci(
    x: np.ndarray, n_boot: int = 10_000, alpha: float = 0.05, seed: int = 0
) -> Interval:
    """Percentile bootstrap CI for the mean of ``x`` (resampling episodes)."""
    x = np.asarray(x, dtype=float)
    if x.size == 0:
        raise ValueError("empty sample")
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, x.size, size=(n_boot, x.size))
    means = x[idx].mean(axis=1)
    low, high = np.quantile(means, [alpha / 2, 1 - alpha / 2])
    return Interval(float(x.mean()), float(low), float(high))


def paired_bootstrap_diff(
    a: np.ndarray, b: np.ndarray, n_boot: int = 10_000, alpha: float = 0.05, seed: int = 0
) -> Interval:
    """CI for ``mean(a - b)`` with *paired* resampling of incidents.

    ``a`` and ``b`` must be aligned per incident (same incident set), which removes
    the incident-difficulty variance shared by both policies.
    """
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    if a.shape != b.shape:
        raise ValueError("paired samples must have the same shape")
    return bootstrap_mean_ci(a - b, n_boot=n_boot, alpha=alpha, seed=seed)


def mean_std(values: list[float]) -> tuple[float, float]:
    """Mean and sample standard deviation (0 for a single value)."""
    arr = np.asarray(values, dtype=float)
    return float(arr.mean()), float(arr.std(ddof=1)) if arr.size > 1 else 0.0
