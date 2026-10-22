"""Controlled modifications of a compiled model for robustness experiments."""

from __future__ import annotations

import numpy as np

from diagnoserl.config.schema import DiagnosticModel


def with_noise(model: DiagnosticModel, epsilon: float) -> DiagnosticModel:
    """Blend every outcome distribution with a uniform one: ``(1-eps) L + eps U``.

    ``U`` is uniform over the outcomes each test can produce. ``epsilon=0`` is the
    original model; ``epsilon=1`` makes every test uninformative.
    """
    if not 0.0 <= epsilon <= 1.0:
        raise ValueError("epsilon must be in [0, 1]")
    support = model.likelihood.sum(axis=1) > 0  # (T, O): outcomes the test can show
    uniform = support / support.sum(axis=1, keepdims=True)
    noisy = (1.0 - epsilon) * model.likelihood + epsilon * uniform[:, None, :]
    return model.replace_likelihood(noisy)


def with_prior(model: DiagnosticModel, prior: np.ndarray) -> DiagnosticModel:
    """Copy of ``model`` with a different fault prior (renormalised)."""
    p = np.asarray(prior, dtype=np.float64)
    if p.shape != model.prior.shape or (p < 0).any() or p.sum() <= 0:
        raise ValueError("prior must be a nonnegative vector with one entry per fault")
    return model.replace(prior=p / p.sum())


def shifted_prior(model: DiagnosticModel, seed: int, concentration: float = 1.0) -> np.ndarray:
    """A random but reproducible alternative prior (Dirichlet around uniform)."""
    rng = np.random.default_rng(seed)
    return np.asarray(rng.dirichlet(np.full(model.n_faults, concentration)))
