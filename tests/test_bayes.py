from __future__ import annotations

import numpy as np
import pytest

from conftest import make_scenario
from diagnoserl import bayes
from diagnoserl.config import ScenarioConfig


def test_single_observation_matches_bayes_rule(tiny_model):
    # prior 0.5/0.5, P(OK|a)=0.8, P(OK|b)=0.2  =>  P(a|OK)=0.8
    post = bayes.posterior_from_evidence(tiny_model, {0: 0})
    np.testing.assert_allclose(post, [0.8, 0.2])


def test_two_independent_observations_multiply(tiny_model):
    # t1=OK: (0.8, 0.2); t2=BAD: (0.1, 0.9)  => unnormalised (0.08, 0.18)
    post = bayes.posterior_from_evidence(tiny_model, {0: 0, 1: 1})
    np.testing.assert_allclose(post, [0.08 / 0.26, 0.18 / 0.26])


def test_posterior_is_order_independent(tiny_model):
    log_b = bayes.initial_log_belief(tiny_model)
    ab = bayes.update_log_belief(tiny_model, bayes.update_log_belief(tiny_model, log_b, 0, 0), 1, 1)
    ba = bayes.update_log_belief(tiny_model, bayes.update_log_belief(tiny_model, log_b, 1, 1), 0, 0)
    np.testing.assert_allclose(bayes.belief(ab), bayes.belief(ba))


def test_incremental_update_equals_batch(standard_model):
    rng = np.random.default_rng(0)
    evidence = {int(t): int(rng.integers(3)) for t in rng.choice(13, size=6, replace=False)}
    log_b = bayes.initial_log_belief(standard_model)
    for t, o in evidence.items():
        log_b = bayes.update_log_belief(standard_model, log_b, t, o)
    np.testing.assert_allclose(
        bayes.belief(log_b), bayes.posterior_from_evidence(standard_model, evidence)
    )


def test_posterior_normalised(standard_model):
    post = bayes.posterior_from_evidence(standard_model, {0: 1, 5: 2})
    assert post.sum() == pytest.approx(1.0)
    assert (post >= 0).all()


def test_entropy_values():
    assert bayes.entropy(np.array([0.5, 0.5])) == pytest.approx(1.0)
    assert bayes.entropy(np.array([1.0, 0.0])) == pytest.approx(0.0)
    assert bayes.entropy(np.full(8, 1 / 8)) == pytest.approx(3.0)


def test_confidence():
    assert bayes.confidence(np.array([0.2, 0.7, 0.1])) == pytest.approx(0.7)


def test_log_space_is_stable_for_long_evidence_chains():
    # 400 repeated observations would underflow in probability space.
    data = make_scenario()
    data["tests"] = [data["tests"][0]]
    model = ScenarioConfig.model_validate(data).compile()
    log_b = bayes.initial_log_belief(model)
    for _ in range(400):
        log_b = bayes.update_log_belief(model, log_b, 0, 0)
    post = bayes.belief(log_b)
    assert np.isfinite(post).all()
    assert post.sum() == pytest.approx(1.0)
    assert post[0] == pytest.approx(1.0)


def test_zero_probability_outcome_rules_fault_out():
    data = make_scenario()
    data["tests"][0]["likelihood"]["overrides"]["a"] = {"OK": 1.0, "BAD": 0.0}
    model = ScenarioConfig.model_validate(data).compile()
    post = bayes.posterior_from_evidence(model, {0: 1})  # BAD is impossible under a
    np.testing.assert_allclose(post, [0.0, 1.0])


def test_impossible_evidence_detected():
    data = make_scenario()
    for fid in ("a", "b"):
        data["tests"][0]["likelihood"]["overrides"][fid] = {"OK": 1.0, "BAD": 0.0}
    model = ScenarioConfig.model_validate(data).compile()
    with pytest.raises(bayes.ImpossibleEvidenceError):
        bayes.posterior_from_evidence(model, {0: 1})


def test_outcome_probabilities_are_a_distribution(standard_model):
    p = bayes.posterior_from_evidence(standard_model, {0: 1})
    for t in range(standard_model.n_tests):
        probs = bayes.outcome_probabilities(standard_model, p, t)
        assert probs.sum() == pytest.approx(1.0)


def test_information_gain_matches_mutual_information(standard_model):
    """IG must equal I(F; O) computed independently from the joint distribution."""
    p = bayes.posterior_from_evidence(standard_model, {0: 1})
    for t in (2, 5, 8):
        joint = p[:, None] * standard_model.likelihood[t]  # P(f, o)
        po = joint.sum(axis=0)
        mi = 0.0
        for f in range(joint.shape[0]):
            for o in range(joint.shape[1]):
                if joint[f, o] > 0:
                    mi += joint[f, o] * np.log2(joint[f, o] / (p[f] * po[o]))
        assert bayes.expected_information_gain(standard_model, p, t) == pytest.approx(mi, abs=1e-9)


def test_information_gain_extremes():
    # fully informative test -> 1 bit; useless test -> 0 bits
    data = make_scenario()
    data["tests"][0]["likelihood"]["overrides"] = {
        "a": {"OK": 1.0, "BAD": 0.0},
        "b": {"OK": 0.0, "BAD": 1.0},
    }
    data["tests"][1]["likelihood"]["overrides"] = {}
    model = ScenarioConfig.model_validate(data).compile()
    p = model.prior
    assert bayes.expected_information_gain(model, p, 0) == pytest.approx(1.0)
    assert bayes.expected_information_gain(model, p, 1) == pytest.approx(0.0, abs=1e-12)


def test_information_gain_nonnegative(standard_model):
    p = bayes.posterior_from_evidence(standard_model, {3: 0, 7: 1})
    assert all(
        bayes.expected_information_gain(standard_model, p, t) >= 0
        for t in range(standard_model.n_tests)
    )
