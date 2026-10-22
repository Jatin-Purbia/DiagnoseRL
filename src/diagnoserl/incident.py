"""Incidents: a hidden fault plus pre-sampled outcomes for every test.

Pre-sampling the outcome of *every* test makes evaluation fair: two policies that
choose different tests face the same incident and receive the same result for any
test both of them run. Because each outcome is drawn independently given the
fault, this is exactly equivalent to sampling on demand under the model's
conditional-independence assumption.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from diagnoserl.config.schema import DiagnosticModel


@dataclass(frozen=True)
class Incident:
    """One simulated incident. ``fault`` is hidden from policies."""

    incident_id: int
    fault: int
    outcomes: np.ndarray  # shape (T,), outcome index each test would return


def sample_incident(
    model: DiagnosticModel,
    rng: np.random.Generator,
    incident_id: int = 0,
    prior: np.ndarray | None = None,
) -> Incident:
    """Sample a fault from ``prior`` (default: the model prior) and all test outcomes."""
    fault_prior = model.prior if prior is None else prior
    fault = int(rng.choice(model.n_faults, p=fault_prior))
    outcomes = np.empty(model.n_tests, dtype=np.int64)
    for t in range(model.n_tests):
        outcomes[t] = rng.choice(model.n_outcomes, p=model.likelihood[t, fault])
    return Incident(incident_id=incident_id, fault=fault, outcomes=outcomes)


def generate_incidents(
    model: DiagnosticModel,
    n: int,
    seed: int,
    prior: np.ndarray | None = None,
) -> list[Incident]:
    """Deterministic incident set.

    Incident ``i`` depends only on ``(seed, i)``, so growing ``n`` never changes
    earlier incidents. Use disjoint seeds for train / validation / test sets.
    """
    return [
        sample_incident(model, np.random.default_rng(np.random.SeedSequence([seed, i])), i, prior)
        for i in range(n)
    ]
