from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from diagnoserl.api import orm

API = "/api/v1"


def _finish(client, seed: int, policy: str = "cost_aware_bayes", scenario: str = "small"):
    """Run a real session to completion following its policy; returns the declare response."""
    sid = client.post(
        f"{API}/sessions", json={"scenario": scenario, "policy": policy, "seed": seed}
    ).json()["id"]
    steps = 0
    while True:
        rec = client.get(f"{API}/sessions/{sid}/recommendation").json()["action"]
        if rec["type"] == "declare":
            out = client.post(f"{API}/sessions/{sid}/declare", json={"fault_id": rec["id"]}).json()
            return sid, out
        client.post(
            f"{API}/sessions/{sid}/tests", json={"test_id": rec["id"], "expected_step": steps}
        )
        steps += 1


def test_scenario_detail_exposes_fault_category_and_description(client):
    detail = client.get(f"{API}/scenarios/standard").json()
    by_id = {f["id"]: f for f in detail["faults"]}
    assert by_id["db_unavailable"]["category"] == "database"
    assert by_id["dns_failure"]["category"] == "network"
    assert all(f["description"] for f in detail["faults"])
    assert sum(f["prior"] for f in detail["faults"]) == pytest.approx(1.0)


def test_executed_tests_carry_timestamps(client):
    sid = client.post(f"{API}/sessions", json={"scenario": "small", "seed": 3}).json()["id"]
    before = datetime.now(UTC) - timedelta(seconds=5)
    out = client.post(f"{API}/sessions/{sid}/tests", json={"test_id": "db_probe"}).json()
    stamp = datetime.fromisoformat(out["result"]["executed_at"].replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    assert before <= stamp <= datetime.now(UTC) + timedelta(seconds=5)


def test_session_list_filters_search_and_fault_privacy(client):
    done, _ = _finish(client, 1)
    active = client.post(f"{API}/sessions", json={"scenario": "small", "seed": 2}).json()["id"]
    client.post(f"{API}/sessions", json={"scenario": "standard", "policy": "info_gain", "seed": 3})

    def ids(**params):
        return {i["id"] for i in client.get(f"{API}/sessions", params=params).json()["items"]}

    assert len(ids()) == 3
    assert ids(status="active") >= {active}
    assert ids(scenario="standard") != ids(scenario="small")
    assert len(ids(scenario="small")) == 2
    assert len(ids(policy="info_gain")) == 1
    assert ids(q=done[:8]) == {done}
    assert ids(q=done.replace("-", "")[:10].upper()) == {done}  # case/dash insensitive
    assert ids(q="zzzzzzzz") == set()

    items = {i["id"]: i for i in client.get(f"{API}/sessions").json()["items"]}
    assert items[active]["true_fault"] is None  # hidden while active
    assert items[active]["declared_fault"] is None
    assert items[done]["true_fault"] is not None  # revealed once finished
    assert items[done]["correct"] in (True, False)


def test_analytics_matches_the_sessions_that_were_run(client):
    results = [_finish(client, s)[1] for s in range(1, 7)]
    client.post(f"{API}/sessions", json={"scenario": "small", "seed": 99})  # left active
    a = client.get(f"{API}/analytics").json()

    n_correct = sum(1 for r in results if r["declaration"]["correct"])
    assert a["total_investigations"] == 7
    assert a["active"] == 1
    assert a["finished"] == 6
    assert a["declared"] == 6
    assert a["truncated"] == 0
    assert a["accuracy"] == pytest.approx(n_correct / 6)
    assert a["mean_reward"] == pytest.approx(sum(r["session"]["total_reward"] for r in results) / 6)
    assert a["mean_cost"] == pytest.approx(sum(r["session"]["cost"] for r in results) / 6)
    assert a["mean_tests"] == pytest.approx(sum(len(r["session"]["executed"]) for r in results) / 6)
    assert sum(p["sessions"] for p in a["by_policy"]) == 6
    assert sum(f["count"] for f in a["fault_frequency"]) == 6
    assert sum(f["identified"] for f in a["fault_frequency"]) == n_correct
    day = a["timeseries"][0]
    assert day["sessions"] == 6
    assert day["accuracy"] == pytest.approx(n_correct / 6)
    assert a["options"]["scenarios"] == ["small"]
    assert {r["status"] for r in a["recent"]} <= {"active", "declared", "truncated"}
    # the active session's true fault is never in the analytics payload
    active_rows = [r for r in a["recent"] if r["status"] == "active"]
    assert active_rows
    assert all(r["true_fault"] is None for r in active_rows)


def test_analytics_filters(client):
    _finish(client, 1, scenario="small")
    _finish(client, 2, policy="info_gain", scenario="standard")
    assert client.get(f"{API}/analytics", params={"scenario": "small"}).json()["finished"] == 1
    assert client.get(f"{API}/analytics", params={"policy": "info_gain"}).json()["finished"] == 1
    assert client.get(f"{API}/analytics", params={"scenario": "nope"}).json()["finished"] == 0
    today = datetime.now(UTC).date()
    assert (
        client.get(
            f"{API}/analytics", params={"since": today.isoformat(), "until": today.isoformat()}
        ).json()["finished"]
        == 2
    )
    tomorrow = (today + timedelta(days=1)).isoformat()
    assert client.get(f"{API}/analytics", params={"since": tomorrow}).json()["finished"] == 0
    bad = client.get(f"{API}/analytics", params={"since": tomorrow, "until": today.isoformat()})
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "invalid_range"
    assert client.get(f"{API}/analytics", params={"since": "not-a-date"}).status_code == 422


def test_analytics_empty_state(client):
    a = client.get(f"{API}/analytics").json()
    assert a["total_investigations"] == 0
    assert a["accuracy"] is None
    assert a["timeseries"] == []
    assert a["fault_frequency"] == []


def test_truncated_sessions_count_as_failures_in_analytics(client):
    sid = client.post(f"{API}/sessions", json={"scenario": "standard", "seed": 5}).json()["id"]
    tests = [
        t["id"]
        for t in client.get(f"{API}/sessions/{sid}/tests").json()
        if t["id"] != "external_dependency_latency"
    ]
    for i, tid in enumerate(tests[:9]):
        client.post(f"{API}/sessions/{sid}/tests", json={"test_id": tid, "expected_step": i})
    a = client.get(f"{API}/analytics").json()
    assert (a["finished"], a["declared"], a["truncated"]) == (1, 0, 1)
    assert a["accuracy"] == 0.0
    # direct DB check: nothing was declared
    with client.app.state.session_factory() as db:
        assert db.execute(select(orm.FaultDeclaration)).first() is None


def test_evaluation_results_carry_distributions_and_metadata(small_model):
    """The comparison pipeline records episode-level samples and its own configuration."""
    from diagnoserl.env import RewardConfig
    from diagnoserl.evaluation.experiment import compare_policies, strip_raw
    from diagnoserl.incident import generate_incidents

    val = generate_incidents(small_model, 40, seed=1)
    test = generate_incidents(small_model, 50, seed=2)
    res = strip_raw(compare_policies(small_model, RewardConfig(), val, test, {}, random_trials=2))
    dist = res["distributions"]
    assert set(dist) == {"fixed_order", "random", "info_gain", "cost_aware_bayes"}
    assert len(dist["fixed_order"]["duration"]) == 50
    assert len(dist["random"]["duration"]) == 100  # 2 trials pooled
    assert all(isinstance(x, (int, float)) for x in dist["info_gain"]["tests"])
    json.dumps(res)
