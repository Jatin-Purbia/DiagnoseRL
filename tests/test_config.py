from __future__ import annotations

import copy
import json

import numpy as np
import pytest
from pydantic import ValidationError

from conftest import make_scenario
from diagnoserl.config import (
    ScenarioConfig,
    ScenarioError,
    list_bundled_scenarios,
    load_bundled_scenario,
    load_model,
    parse_scenario,
)


def test_bundled_scenarios_load_and_are_consistent():
    assert {"standard", "small"} <= set(list_bundled_scenarios())
    for name in list_bundled_scenarios():
        m = load_model(name)
        assert m.prior.sum() == pytest.approx(1.0)
        # every P(outcome | test, fault) is a distribution
        np.testing.assert_allclose(m.likelihood.sum(axis=2), 1.0, atol=1e-9)
        assert (m.likelihood >= 0).all()
        assert (m.cost >= 0).all()
        assert (m.duration >= 0).all()


def test_standard_scenario_has_twelve_faults_and_thirteen_tests():
    m = load_model("standard")
    assert (m.n_faults, m.n_tests) == (12, 13)
    assert m.n_actions == 25


def test_no_single_test_reveals_the_fault():
    """Guard against configs where one test makes diagnosis trivial."""
    m = load_model("standard")
    for t in range(m.n_tests):
        # best achievable accuracy from this one test alone (Bayes-optimal)
        joint = m.prior[:, None] * m.likelihood[t]  # (F, O)
        accuracy = joint.max(axis=0).sum()
        assert accuracy < 0.6, m.test_ids[t]


def _bad(mutator):
    data = copy.deepcopy(make_scenario())
    mutator(data)
    with pytest.raises(ValidationError):
        ScenarioConfig.model_validate(data)


def test_priors_must_sum_to_one():
    _bad(lambda d: d["faults"][0].update(prior=0.6))


def test_enabled_fault_needs_nonzero_prior():
    def mutate(d):
        d["faults"][0]["prior"] = 0.0
        d["faults"][1]["prior"] = 1.0

    _bad(mutate)


def test_negative_probability_rejected():
    _bad(lambda d: d["tests"][0]["likelihood"]["default"].update(OK=-0.5, BAD=1.5))


def test_distribution_must_sum_to_one():
    _bad(lambda d: d["tests"][0]["likelihood"]["overrides"]["a"].update(OK=0.7))


def test_unknown_fault_in_override():
    _bad(lambda d: d["tests"][0]["likelihood"]["overrides"].update(zzz={"OK": 1.0, "BAD": 0.0}))


def test_unknown_outcome_label():
    _bad(lambda d: d["tests"][0]["likelihood"]["default"].update(MAYBE=0.0))


def test_unknown_prerequisite():
    _bad(lambda d: d["tests"][0].update(requires=["nope"]))


def test_prerequisite_cycle_rejected():
    def mutate(d):
        d["tests"][0]["requires"] = ["t2"]
        d["tests"][1]["requires"] = ["t1"]

    _bad(mutate)


def test_duplicate_ids_rejected():
    _bad(lambda d: d["tests"][1].update(id="t1"))
    _bad(lambda d: d["faults"][1].update(id="a"))


def test_negative_cost_or_duration_rejected():
    _bad(lambda d: d["tests"][0].update(cost=-1))
    _bad(lambda d: d["tests"][0].update(duration=-1))


def test_unknown_field_rejected():
    _bad(lambda d: d.update(surprise=1))


def test_disabled_fault_is_dropped_from_model():
    data = make_scenario()
    data["faults"].append({"id": "c", "name": "C", "prior": 0.0, "enabled": False})
    m = ScenarioConfig.model_validate(data).compile()
    assert m.fault_ids == ["a", "b"]


def test_parse_errors_are_wrapped():
    with pytest.raises(ScenarioError):
        parse_scenario("{not: [valid")
    with pytest.raises(ScenarioError):
        parse_scenario("- just\n- a list")
    with pytest.raises(ScenarioError):
        parse_scenario("name: x")
    with pytest.raises(ScenarioError):
        load_bundled_scenario("does-not-exist")


def test_json_scenarios_supported():
    cfg = parse_scenario(json.dumps(make_scenario()), fmt="json")
    assert cfg.name == "tiny"


def test_prerequisites_compiled():
    m = load_model("standard")
    ext = m.test_ids.index("external_dependency_latency")
    net = m.test_ids.index("network_connectivity")
    assert m.requires[ext, net]
    assert m.requires.sum() == 1
