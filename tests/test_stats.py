from __future__ import annotations

import numpy as np
import pytest

from conftest import make_scenario
from diagnoserl.config import ScenarioConfig
from diagnoserl.config.transforms import shifted_prior, with_noise, with_prior
from diagnoserl.evaluation.stats import bootstrap_mean_ci, mean_std, paired_bootstrap_diff


def test_bootstrap_ci_covers_true_mean_and_is_deterministic():
    rng = np.random.default_rng(0)
    x = rng.normal(5.0, 2.0, size=500)
    ci = bootstrap_mean_ci(x, seed=1)
    assert ci.low < 5.0 < ci.high
    assert ci.mean == pytest.approx(x.mean())
    assert ci == bootstrap_mean_ci(x, seed=1)
    assert ci.high - ci.low < 1.0


def test_paired_diff_detects_real_difference_and_not_noise():
    rng = np.random.default_rng(1)
    base = rng.normal(0, 5, size=800)  # large shared per-incident variance
    better = base + 0.5 + rng.normal(0, 0.3, size=800)
    assert paired_bootstrap_diff(better, base).excludes_zero()
    same = base + rng.normal(0, 0.3, size=800)
    assert not paired_bootstrap_diff(same, base).excludes_zero()


def test_paired_requires_aligned_samples():
    with pytest.raises(ValueError):
        paired_bootstrap_diff(np.zeros(3), np.zeros(4))
    with pytest.raises(ValueError):
        bootstrap_mean_ci(np.array([]))


def test_mean_std():
    assert mean_std([1.0, 3.0]) == (2.0, pytest.approx(2**0.5))
    assert mean_std([4.0]) == (4.0, 0.0)


def test_with_noise_endpoints_and_validity(standard_model):
    np.testing.assert_allclose(
        with_noise(standard_model, 0.0).likelihood, standard_model.likelihood
    )
    full = with_noise(standard_model, 1.0)
    np.testing.assert_allclose(full.likelihood, 1 / 3)
    mid = with_noise(standard_model, 0.4)
    np.testing.assert_allclose(mid.likelihood.sum(axis=2), 1.0)
    with pytest.raises(ValueError):
        with_noise(standard_model, 1.5)


def test_with_noise_keeps_zero_support_zero():
    data = make_scenario()
    data["tests"][0]["outcomes"] = ["OK", "BAD", "NEVER"]
    model = ScenarioConfig.model_validate(data).compile()
    noisy = with_noise(model, 0.5)
    assert (noisy.likelihood[0, :, 2] == 0).all()
    np.testing.assert_allclose(noisy.likelihood.sum(axis=2), 1.0)


def test_with_prior_and_shifted_prior(standard_model):
    p = shifted_prior(standard_model, seed=3)
    assert p.sum() == pytest.approx(1.0)
    assert np.array_equal(p, shifted_prior(standard_model, seed=3))
    shifted = with_prior(standard_model, p)
    np.testing.assert_allclose(shifted.prior, p)
    assert shifted.cost is standard_model.cost
    with pytest.raises(ValueError):
        with_prior(standard_model, np.ones(3))
