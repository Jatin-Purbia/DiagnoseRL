from __future__ import annotations

import numpy as np

from diagnoserl.incident import Incident, generate_incidents


def _same(a: list[Incident], b: list[Incident]) -> bool:
    return all(
        x.incident_id == y.incident_id
        and x.fault == y.fault
        and np.array_equal(x.outcomes, y.outcomes)
        for x, y in zip(a, b, strict=True)
    )


def test_generation_is_deterministic(standard_model):
    first = generate_incidents(standard_model, 20, seed=1)
    second = generate_incidents(standard_model, 20, seed=1)
    assert _same(first, second)


def test_different_seeds_differ(standard_model):
    first = generate_incidents(standard_model, 20, seed=1)
    second = generate_incidents(standard_model, 20, seed=2)
    assert not _same(first, second)


def test_prefix_stability(standard_model):
    short = generate_incidents(standard_model, 10, seed=4)
    long = generate_incidents(standard_model, 50, seed=4)
    assert _same(short, long[:10])


def test_fault_and_outcome_ranges(standard_model):
    for inc in generate_incidents(standard_model, 50, seed=0):
        assert 0 <= inc.fault < standard_model.n_faults
        assert inc.outcomes.shape == (standard_model.n_tests,)
        assert ((inc.outcomes >= 0) & (inc.outcomes < standard_model.n_outcomes)).all()


def test_empirical_fault_frequencies_match_prior(standard_model):
    incidents = generate_incidents(standard_model, 4000, seed=9)
    freq = np.bincount([i.fault for i in incidents], minlength=standard_model.n_faults) / 4000
    np.testing.assert_allclose(freq, standard_model.prior, atol=0.025)


def test_empirical_outcomes_match_likelihood(standard_model):
    fault = standard_model.fault_ids.index("bad_deployment")
    test = standard_model.test_ids.index("deployment_version")
    incidents = [i for i in generate_incidents(standard_model, 6000, seed=2) if i.fault == fault]
    freq = np.bincount([i.outcomes[test] for i in incidents], minlength=3) / len(incidents)
    np.testing.assert_allclose(freq, standard_model.likelihood[test, fault], atol=0.06)
