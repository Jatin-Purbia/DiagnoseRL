r"""Bayesian belief over root causes.

Model: a hidden fault :math:`f` with prior :math:`P(f)`. Running test :math:`t`
yields outcome :math:`o` with probability :math:`P(o \mid f, t)`. Outcomes are
**conditionally independent given** :math:`f` (naive-Bayes assumption).

Posterior after evidence :math:`E = \{(t_1, o_1), \ldots, (t_k, o_k)\}`:

.. math::

    P(f \mid E) \propto P(f) \prod_i P(o_i \mid f, t_i)

computed in log space and normalised with log-sum-exp. Zero-probability
outcomes map to :math:`-\infty`; if every fault is ruled out the evidence is
impossible under the model and :class:`ImpossibleEvidenceError` is raised.

Predictive distribution of the next outcome of test :math:`t`:

.. math::

    P(o \mid E, t) = \sum_f P(f \mid E)\, P(o \mid f, t)

Expected information gain of test :math:`t` (entropy in bits):

.. math::

    IG(t) = H(P(f \mid E)) - \sum_o P(o \mid E, t)\, H(P(f \mid E, (t, o)))
"""

from __future__ import annotations

from collections.abc import Mapping

import numpy as np
from scipy.special import logsumexp

from diagnoserl.config.schema import DiagnosticModel

Array = np.ndarray


class ImpossibleEvidenceError(ValueError):
    """The observed evidence has zero probability under every fault."""


def initial_log_belief(model: DiagnosticModel) -> Array:
    """Log of the prior (``-inf`` for zero-prior faults)."""
    with np.errstate(divide="ignore"):
        return np.log(model.prior)


def normalize_log(log_belief: Array) -> Array:
    """Normalise log-weights so they exponentiate to a distribution."""
    norm = logsumexp(log_belief)
    if not np.isfinite(norm):
        raise ImpossibleEvidenceError("evidence has zero probability under every fault")
    return np.asarray(log_belief - norm)


def update_log_belief(model: DiagnosticModel, log_belief: Array, test: int, outcome: int) -> Array:
    """Return the normalised log-belief after observing ``outcome`` of ``test``."""
    return normalize_log(log_belief + model.log_likelihood[test, :, outcome])


def belief(log_belief: Array) -> Array:
    """Probability vector from a (normalised) log-belief."""
    p = np.exp(log_belief)
    return np.asarray(p / p.sum())


def posterior_from_evidence(model: DiagnosticModel, evidence: Mapping[int, int]) -> Array:
    """Posterior ``P(f | evidence)`` for ``{test index: outcome index}``."""
    log_b = initial_log_belief(model)
    for test, outcome in evidence.items():
        log_b = log_b + model.log_likelihood[test, :, outcome]
    return belief(normalize_log(log_b))


def entropy(p: Array) -> float:
    """Shannon entropy in bits."""
    q = p[p > 0.0]
    return float(-(q * np.log2(q)).sum())


def confidence(p: Array) -> float:
    """Posterior probability of the most likely fault."""
    return float(p.max())


def outcome_probabilities(model: DiagnosticModel, p: Array, test: int) -> Array:
    """Predictive ``P(o | evidence, test)``, shape ``(O,)``."""
    return np.asarray(p @ model.likelihood[test])


def posterior_after(model: DiagnosticModel, p: Array, test: int, outcome: int) -> Array | None:
    """Posterior after hypothetically seeing ``outcome``; ``None`` if impossible."""
    unnorm = p * model.likelihood[test, :, outcome]
    total = unnorm.sum()
    if total <= 0.0:
        return None
    return np.asarray(unnorm / total)


def expected_posterior_entropy(model: DiagnosticModel, p: Array, test: int) -> float:
    """``E_o[ H(P(f | evidence, (test, o))) ]`` in bits."""
    probs = outcome_probabilities(model, p, test)
    total = 0.0
    for o, po in enumerate(probs):
        if po <= 0.0:
            continue
        post = posterior_after(model, p, test, o)
        if post is not None:
            total += float(po) * entropy(post)
    return total


def expected_information_gain(model: DiagnosticModel, p: Array, test: int) -> float:
    """Expected entropy reduction (bits) from running ``test``; always >= 0."""
    return max(0.0, entropy(p) - expected_posterior_entropy(model, p, test))
