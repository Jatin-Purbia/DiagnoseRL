from __future__ import annotations

import json
import time
from datetime import UTC, datetime

import numpy as np
import pytest
from pydantic import ValidationError

from diagnoserl import bayes
from diagnoserl.baselines import CostAwareBayesPolicy, FixedOrderPolicy
from diagnoserl.config import load_model
from diagnoserl.env import RewardConfig
from diagnoserl.historical import (
    AdapterNotAllowed,
    AdapterRegistry,
    AdapterTimeout,
    AdvisorSession,
    ApprovalRequired,
    EstimationConfig,
    HistoricalIncident,
    IncidentDataError,
    InsufficientDataError,
    SimulatedAdapter,
    TestRecord,
    estimate_scenario,
    load_incidents,
    replay_policy,
    write_incidents,
)
from diagnoserl.historical.make_example import synthesize
from diagnoserl.incident import generate_incidents

NOW = datetime(2026, 1, 1, tzinfo=UTC)


def _full_information_incidents(model, n, seed):
    """Every test run on every incident: no selection bias (the ideal estimation setting)."""
    out = []
    for inc in generate_incidents(model, n, seed):
        tests = [
            TestRecord(
                test_id=model.test_ids[t],
                status="observed",
                outcome=model.outcome_labels[int(inc.outcomes[t])],
            )
            for t in range(model.n_tests)
        ]
        out.append(
            HistoricalIncident(
                incident_id=f"i{inc.incident_id}",
                timestamp=NOW,
                confirmed_root_cause=model.fault_ids[inc.fault],
                tests=tests,
            )
        )
    return out


# ------------------------------------------------------------------ schema / io
def test_schema_distinguishes_observed_missing_and_not_run():
    ok = TestRecord(test_id="t", status="observed", outcome="PASS")
    miss = TestRecord(test_id="t", status="missing")
    assert ok.outcome == "PASS"
    assert miss.outcome is None
    with pytest.raises(ValidationError):
        TestRecord(test_id="t", status="observed")  # observed needs an outcome
    with pytest.raises(ValidationError):
        TestRecord(test_id="t", status="missing", outcome="PASS")  # missing must not look negative
    inc = HistoricalIncident(
        incident_id="1",
        timestamp=NOW,
        confirmed_root_cause="x",
        tests=[ok, TestRecord(test_id="u", status="missing")],
    )
    assert set(inc.observed()) == {"t"}
    assert inc.executed_ids() == {"t", "u"}
    with pytest.raises(ValidationError):
        HistoricalIncident(incident_id="1", timestamp=NOW, confirmed_root_cause="x", tests=[ok, ok])


def test_jsonl_round_trip_and_error_reporting(tmp_path):
    model = load_model("small")
    incidents = _full_information_incidents(model, 5, 1)
    path = tmp_path / "x.jsonl"
    assert write_incidents(path, incidents) == 5
    loaded = load_incidents(path)
    assert [i.incident_id for i in loaded] == [i.incident_id for i in incidents]
    assert loaded[0].tests[0].outcome == incidents[0].tests[0].outcome

    lines = path.read_text().splitlines()
    bad = json.loads(lines[2])
    bad["tests"][0]["status"] = "observed"
    bad["tests"][0].pop("outcome", None)
    lines[2] = json.dumps(bad)
    path.write_text("\n".join(lines))
    with pytest.raises(IncidentDataError, match="line 3"):
        load_incidents(path)

    dup = tmp_path / "dup.jsonl"
    dup.write_text("\n".join([lines[0], lines[0]]))
    with pytest.raises(IncidentDataError, match="duplicate"):
        load_incidents(dup)
    arr = tmp_path / "a.json"
    arr.write_text(json.dumps([json.loads(lines[0])]))
    assert len(load_incidents(arr)) == 1
    arr.write_text('{"not": "an array"}')
    with pytest.raises(IncidentDataError):
        load_incidents(arr)


# -------------------------------------------------------------------- estimation
def test_estimation_recovers_true_parameters_when_data_is_unbiased():
    model = load_model("small")
    incidents = _full_information_incidents(model, 12000, seed=3)
    scenario, report = estimate_scenario(incidents)
    est = scenario.compile()
    assert sorted(est.fault_ids) == sorted(model.fault_ids)
    order = [est.fault_ids.index(f) for f in model.fault_ids]
    np.testing.assert_allclose(est.prior[order], model.prior, atol=0.015)
    for ti, tid in enumerate(model.test_ids):
        et = est.test_ids.index(tid)
        # align outcome labels
        for fi in range(model.n_faults):
            for oi, label in enumerate(model.outcome_labels):
                if label in est.outcome_labels:
                    p_est = est.likelihood[et, order[fi], est.outcome_labels.index(label)]
                    assert p_est == pytest.approx(model.likelihood[ti, fi, oi], abs=0.035)
    assert report.biased_tests == []  # everything ran on everything
    assert not report.sparse_faults


def test_smoothing_never_produces_zero_probabilities_and_flags_sparse_cells():
    model = load_model("small")
    incidents = _full_information_incidents(model, 40, seed=4)
    scenario, report = estimate_scenario(
        incidents,
        EstimationConfig(
            min_total_incidents=20, min_incidents_per_fault=2, min_observations_per_cell=15
        ),
    )
    est = scenario.compile()
    assert (est.likelihood > 0).all()
    np.testing.assert_allclose(est.likelihood.sum(axis=2), 1.0)
    assert report.sparse_cells  # 40 incidents / 4 faults < 15 per cell
    assert any("shrunk" in w for w in report.warnings)
    # with so little data the model must still support Bayesian updates without impossible evidence
    bayes.posterior_from_evidence(est, {0: 0, 1: est.n_outcomes - 1})


def test_insufficient_data_is_rejected():
    model = load_model("small")
    with pytest.raises(InsufficientDataError):
        estimate_scenario(_full_information_incidents(model, 10, 1))
    one_fault = [
        HistoricalIncident(
            incident_id=str(i),
            timestamp=NOW,
            confirmed_root_cause="only",
            tests=[TestRecord(test_id="t", status="observed", outcome="PASS")],
        )
        for i in range(30)
    ]
    with pytest.raises(InsufficientDataError, match="two distinct"):
        estimate_scenario(one_fault)


def test_missing_results_are_not_counted_as_negative_outcomes():
    def inc(i, fault, outcome):
        tests = (
            [TestRecord(test_id="t", status="observed", outcome=outcome)]
            if outcome
            else [TestRecord(test_id="t", status="missing")]
        )
        return HistoricalIncident(
            incident_id=str(i), timestamp=NOW, confirmed_root_cause=fault, tests=tests
        )

    incidents = (
        [inc(i, "a", "FAIL") for i in range(20)]
        + [inc(100 + i, "b", "PASS") for i in range(20)]
        + [inc(200 + i, "a", None) for i in range(60)]  # lots of lost results for fault a
        + [inc(300 + i, "b", "FAIL") for i in range(2)]
    )
    scenario, report = estimate_scenario(incidents, EstimationConfig(min_incidents_per_fault=2))
    assert report.missing_counts["t"] == 60
    assert report.test_observation_counts["t"] == 42
    est = scenario.compile()
    fa = est.fault_ids.index("a")
    fail = est.outcome_labels.index("FAIL")
    # if missing had been treated as PASS, P(FAIL | a) would be 20/80 = 0.25; it stays near 1
    assert est.likelihood[0, fa, fail] > 0.8


def test_costs_and_durations_are_averaged_or_defaulted_with_flags():
    def inc(i, fault, outcome, dur, cost):
        return HistoricalIncident(
            incident_id=str(i),
            timestamp=NOW,
            confirmed_root_cause=fault,
            tests=[
                TestRecord(
                    test_id="timed",
                    status="observed",
                    outcome=outcome,
                    duration_seconds=dur,
                    cost=cost,
                ),
                TestRecord(test_id="untimed", status="observed", outcome=outcome),
            ],
        )

    incidents = [
        inc(i, "a" if i % 2 else "b", "PASS" if i % 3 else "FAIL", 10 + (i % 2) * 10, 2.0)
        for i in range(40)
    ]
    scenario, report = estimate_scenario(
        incidents, EstimationConfig(default_cost=7.0, default_duration=99.0)
    )
    by_id = {t.id: t for t in scenario.tests}
    assert by_id["timed"].duration == pytest.approx(15.0)
    assert by_id["timed"].cost == pytest.approx(2.0)
    assert by_id["untimed"].cost == 7.0
    assert by_id["untimed"].duration == 99.0
    assert report.defaulted_costs == ["untimed"]
    assert report.defaulted_durations == ["untimed"]


def test_selection_bias_is_detected_in_engineer_chosen_data():
    model = load_model("standard")
    incidents = synthesize(model, 1500, seed=11)
    assert all(i.resolution["source"] == "synthetic-simulator" for i in incidents)
    scenario, report = estimate_scenario(incidents, EstimationConfig(max_steps=9))
    assert report.biased_tests, "tests run by suspicion must show uneven run-rates across faults"
    assert any("chose them" in w for w in report.warnings)
    est = scenario.compile()  # estimated model is a valid, usable scenario
    assert est.n_faults >= 10
    assert (est.likelihood > 0).all()


def test_estimated_scenario_can_drive_policies_and_replay():
    model = load_model("standard")
    incidents = synthesize(model, 800, seed=5)
    scenario, _ = estimate_scenario(incidents, EstimationConfig(max_steps=9))
    est = scenario.compile()
    reward = RewardConfig()
    policy = CostAwareBayesPolicy(est, reward, depth=1)
    result = replay_policy(est, policy, incidents[:200], reward)
    assert result.n_incidents == 200
    assert 0.0 <= result.coverage <= 1.0
    assert "biased subset" in result.note
    if result.n_fully_observed:
        assert 0.0 <= result.accuracy_on_observed <= 1.0
    assert result.human_mean_tests > 0


def test_replay_scores_only_episodes_within_recorded_outcomes():
    model = load_model("small")
    # engineers ran only `db_probe`; a fixed-order policy asking for 3 tests goes beyond the data
    incidents = [
        HistoricalIncident(
            incident_id=str(i),
            timestamp=NOW,
            confirmed_root_cause="db_down",
            tests=[TestRecord(test_id="db_probe", status="observed", outcome="FAIL")],
        )
        for i in range(10)
    ]
    wide = replay_policy(model, FixedOrderPolicy(model, max_tests=3), incidents)
    assert wide.n_fully_observed == 0
    assert wide.coverage == 0.0
    assert wide.accuracy_on_observed is None
    narrow = replay_policy(model, FixedOrderPolicy(model, order=[0], max_tests=1), incidents)
    assert narrow.coverage == 1.0
    assert narrow.accuracy_on_observed == 1.0  # FAIL on db_probe makes db_down the likeliest cause
    # unknown causes cannot be scored
    other = incidents[0].model_copy(update={"confirmed_root_cause": "alien"})
    res = replay_policy(model, FixedOrderPolicy(model, max_tests=1), [other])
    assert res.n_unknown_cause == 1
    assert res.coverage == 0.0


# --------------------------------------------------------------------- adapters
def test_adapter_registry_enforces_read_only_allowlist_approval_and_timeout():
    reg = AdapterRegistry(allowed_destinations=frozenset({"db.internal"}), timeout_seconds=0.2)
    with pytest.raises(AdapterNotAllowed, match="read-only"):
        reg.register(SimulatedAdapter("w", lambda: "PASS", read_only=False))
    with pytest.raises(AdapterNotAllowed, match="allowlist"):
        reg.register(SimulatedAdapter("n", lambda: "PASS", destinations=("evil.example",)))
    reg.register(SimulatedAdapter("db_probe", lambda: "PASS", destinations=("db.internal",)))
    with pytest.raises(AdapterNotAllowed, match="already registered"):
        reg.register(SimulatedAdapter("db_probe", lambda: "PASS"))
    reg.register(SimulatedAdapter("slow", lambda: (time.sleep(1.0), "PASS")[1]))
    reg.register(SimulatedAdapter("boom", lambda: 1 / 0))

    with pytest.raises(ApprovalRequired):
        reg.execute("db_probe", approved_by=None)
    with pytest.raises(ApprovalRequired):
        reg.execute("db_probe", approved_by="  ")
    assert reg.audit_log == []  # nothing ran without approval
    with pytest.raises(AdapterNotAllowed):
        reg.execute("unregistered", approved_by="alice")
    assert reg.execute("db_probe", approved_by="alice") == "PASS"
    with pytest.raises(AdapterTimeout):
        reg.execute("slow", approved_by="alice")
    with pytest.raises(Exception, match="ZeroDivisionError"):
        reg.execute("boom", approved_by="alice")
    log = reg.audit_log
    assert [(r.test_id, r.approved_by, r.error) for r in log] == [
        ("db_probe", "alice", None),
        ("slow", "alice", "timeout"),
        ("boom", "alice", "ZeroDivisionError"),
    ]
    reg.close()


def test_advisor_updates_belief_only_through_approved_adapter_runs():
    model = load_model("small")
    reg = AdapterRegistry(timeout_seconds=1.0)
    reg.register(SimulatedAdapter("db_probe", lambda: "FAIL"))
    reg.register(SimulatedAdapter("cpu_check", lambda: "PASS"))
    advisor = AdvisorSession(model, CostAwareBayesPolicy(model, RewardConfig(), depth=1), reg)
    np.testing.assert_allclose(advisor.state().belief, model.prior)

    first = advisor.suggest()
    assert first["type"] in ("test", "declare")
    if first["type"] == "test":
        assert first["requires_approval"] is True

    with pytest.raises(ApprovalRequired):
        advisor.run_test("db_probe", approved_by=None)
    np.testing.assert_allclose(advisor.state().belief, model.prior)  # unchanged: no approval

    assert advisor.run_test("db_probe", approved_by="alice") == "FAIL"
    expected = bayes.posterior_from_evidence(model, {0: model.outcome_labels.index("FAIL")})
    np.testing.assert_allclose(advisor.state().belief, expected)
    with pytest.raises(ValueError):
        advisor.run_test("db_probe", approved_by="alice")  # cannot repeat a test
    with pytest.raises(KeyError):
        advisor.run_test("nope", approved_by="alice")
    assert advisor.state().cost == pytest.approx(float(model.cost[0]))
    advisor.suggest()  # still works with evidence
    reg.close()
