from __future__ import annotations

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from conftest import ADMIN_KEY, build_app
from diagnoserl import bayes
from diagnoserl.config import load_model

API = "/api/v1"


def _create(client, **body):
    body.setdefault("scenario", "small")
    body.setdefault("seed", 1)
    r = client.post(f"{API}/sessions", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _first_available(client, sid):
    tests = client.get(f"{API}/sessions/{sid}/tests").json()
    return next(t["id"] for t in tests if t["available"])


# ----------------------------------------------------------------------- health
def test_health_endpoints(client):
    assert client.get("/health/live").json() == {"status": "ok"}
    ready = client.get("/health/ready")
    assert ready.status_code == 200
    assert ready.json()["checks"]["database"] == "ok"


def test_openapi_documents_versioned_endpoints(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert f"{API}/sessions" in paths
    assert f"{API}/sessions/{{session_id}}/declare" in paths
    assert f"{API}/models" in paths


# -------------------------------------------------------------------- scenarios
def test_scenarios_list_and_detail(client):
    names = {s["name"] for s in client.get(f"{API}/scenarios").json()}
    assert {"standard", "small"} <= names
    detail = client.get(f"{API}/scenarios/small").json()
    assert detail["n_faults"] == 4
    assert len(detail["faults"]) == 4
    test = detail["tests"][0]
    assert np.array(test["likelihood"]).shape == (4, len(detail["outcomes"]))
    np.testing.assert_allclose(np.array(test["likelihood"]).sum(axis=1), 1.0)
    assert client.get(f"{API}/scenarios/nope").status_code == 404


def test_scenario_validation_endpoint(client):
    from conftest import make_scenario

    ok = client.post(
        f"{API}/scenarios/validate", json={"text": json.dumps(make_scenario()), "format": "json"}
    )
    assert ok.json()["valid"] is True
    assert ok.json()["summary"]["n_tests"] == 2

    bad = make_scenario()
    bad["faults"][0]["prior"] = 0.9
    resp = client.post(
        f"{API}/scenarios/validate", json={"text": json.dumps(bad), "format": "json"}
    )
    assert resp.status_code == 200
    assert resp.json()["valid"] is False
    assert resp.json()["errors"]

    junk = client.post(f"{API}/scenarios/validate", json={"text": "{nope", "format": "yaml"})
    assert junk.json()["valid"] is False


# --------------------------------------------------------------------- sessions
def test_full_diagnostic_flow(client):
    model = load_model("small")
    s = _create(client, policy="cost_aware_bayes")
    sid = s["id"]
    assert s["status"] == "active"
    assert s["steps"] == 0
    # hidden fault is never exposed while active
    assert "true_fault" not in s
    assert "true_fault" not in json.dumps(s)
    np.testing.assert_allclose([p["probability"] for p in s["posterior"]], model.prior)

    rec = client.get(f"{API}/sessions/{sid}/recommendation").json()
    assert rec["policy"] == "cost_aware_bayes"
    assert rec["action"]["type"] in ("test", "declare")
    assert 0 < rec["confidence"] <= 1
    assert "utility_declare_now" in rec["explanation"]

    test_id = _first_available(client, sid)
    r = client.post(f"{API}/sessions/{sid}/tests", json={"test_id": test_id, "expected_step": 0})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["replayed"] is False
    assert body["session"]["steps"] == 1
    assert body["session"]["cost"] > 0
    # server posterior == independent Bayes computation from the observed evidence
    t_idx = model.test_ids.index(test_id)
    o_idx = model.outcome_labels.index(body["result"]["outcome"])
    expected = bayes.posterior_from_evidence(model, {t_idx: o_idx})
    np.testing.assert_allclose(
        [p["probability"] for p in body["session"]["posterior"]], expected, atol=1e-9
    )
    np.testing.assert_allclose(body["result"]["posterior_after"], expected, atol=1e-9)
    assert "true_fault" not in json.dumps(body)
    assert client.get(f"{API}/sessions/{sid}/report").status_code == 409  # still active

    post = client.get(f"{API}/sessions/{sid}/posterior").json()
    assert post["steps"] == 1

    fault = max(body["session"]["posterior"], key=lambda p: p["probability"])["id"]
    d = client.post(f"{API}/sessions/{sid}/declare", json={"fault_id": fault})
    assert d.status_code == 200, d.text
    dj = d.json()
    assert dj["session"]["status"] == "declared"
    assert dj["declaration"]["correct"] == (fault == dj["true_fault"])
    assert dj["session"]["available_tests"] == []

    report = client.get(f"{API}/sessions/{sid}/report").json()
    assert report["true_fault"] == dj["true_fault"]
    assert report["declared_fault"] == fault
    assert report["timeout"] is False
    assert len(report["posterior_trace"]) == 2  # prior + one test
    history = client.get(f"{API}/sessions/{sid}/history").json()
    assert [t["test_id"] for t in history["tests"]] == [test_id]
    assert history["snapshots"][0]["step"] == 0
    assert history["tests"][0]["recommendation"] is not None


def test_session_listing_and_pagination(client):
    for seed in range(5):
        _create(client, seed=seed)
    page = client.get(f"{API}/sessions", params={"limit": 2, "offset": 0}).json()
    assert page["total"] == 5
    assert len(page["items"]) == 2
    page2 = client.get(f"{API}/sessions", params={"limit": 2, "offset": 4}).json()
    assert len(page2["items"]) == 1
    assert client.get(f"{API}/sessions", params={"limit": 1000}).status_code == 422
    assert client.get(f"{API}/sessions", params={"status": "bogus"}).status_code == 422


def test_error_responses_are_consistent(client):
    r = client.post(f"{API}/sessions", json={"scenario": "nope"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"
    r = client.post(f"{API}/sessions", json={"scenario": "small", "policy": "magic"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "unknown_policy"
    r = client.post(f"{API}/sessions", json={"seed": -5})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "validation_error"
    assert client.get(f"{API}/sessions/not-a-uuid").status_code == 422
    assert client.get(f"{API}/sessions/00000000-0000-0000-0000-000000000000").status_code == 404


def test_invalid_actions_are_rejected(client):
    sid = _create(client, scenario="standard")["id"]
    assert client.post(f"{API}/sessions/{sid}/tests", json={"test_id": "nope"}).status_code == 400
    # prerequisite not yet satisfied
    r = client.post(f"{API}/sessions/{sid}/tests", json={"test_id": "external_dependency_latency"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "test_not_available"
    assert (
        client.post(f"{API}/sessions/{sid}/declare", json={"fault_id": "nope"}).status_code == 400
    )
    # a test cannot be run twice
    assert (
        client.post(f"{API}/sessions/{sid}/tests", json={"test_id": "db_health_probe"}).status_code
        == 200
    )
    r = client.post(f"{API}/sessions/{sid}/tests", json={"test_id": "db_health_probe"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "test_already_executed"


def test_execute_test_is_idempotent_with_expected_step(client):
    sid = _create(client)["id"]
    test_id = _first_available(client, sid)
    first = client.post(
        f"{API}/sessions/{sid}/tests", json={"test_id": test_id, "expected_step": 0}
    )
    retry = client.post(
        f"{API}/sessions/{sid}/tests", json={"test_id": test_id, "expected_step": 0}
    )
    assert first.status_code == retry.status_code == 200
    assert first.json()["replayed"] is False
    assert retry.json()["replayed"] is True
    assert retry.json()["result"] == first.json()["result"]
    assert client.get(f"{API}/sessions/{sid}").json()["steps"] == 1  # not applied twice
    # a different test at an already-consumed step is a conflict, not a silent overwrite
    other = next(
        t["id"] for t in client.get(f"{API}/sessions/{sid}/tests").json() if t["available"]
    )
    stale = client.post(f"{API}/sessions/{sid}/tests", json={"test_id": other, "expected_step": 0})
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "stale_step"
    wrong = client.post(f"{API}/sessions/{sid}/tests", json={"test_id": other, "expected_step": 5})
    assert wrong.status_code == 409


def test_declare_is_idempotent_and_final(client):
    sid = _create(client)["id"]
    a = client.post(f"{API}/sessions/{sid}/declare", json={"fault_id": "db_down"})
    b = client.post(f"{API}/sessions/{sid}/declare", json={"fault_id": "db_down"})
    assert a.status_code == b.status_code == 200
    assert a.json()["declaration"] == b.json()["declaration"]
    c = client.post(f"{API}/sessions/{sid}/declare", json={"fault_id": "cpu_high"})
    assert c.status_code == 409
    assert c.json()["error"]["code"] == "already_declared"
    done = client.post(f"{API}/sessions/{sid}/tests", json={"test_id": "db_probe"})
    assert done.status_code == 409
    assert client.get(f"{API}/sessions/{sid}/recommendation").status_code == 409


def test_step_cap_truncates_session_like_the_environment(client):
    """Using every allowed step on tests (no declaration) truncates: no success is recorded."""
    sid = _create(client, scenario="standard")["id"]
    model = load_model("standard")
    order = [t for t in model.test_ids if t != "external_dependency_latency"]
    for i, tid in enumerate(order[: model.max_steps]):
        r = client.post(f"{API}/sessions/{sid}/tests", json={"test_id": tid, "expected_step": i})
        assert r.status_code == 200, r.text
    final = client.get(f"{API}/sessions/{sid}").json()
    assert final["status"] == "truncated"
    assert final["steps"] == model.max_steps
    report = client.get(f"{API}/sessions/{sid}/report").json()
    assert report["timeout"] is True
    assert report["correct"] is False
    assert report["declared_fault"] is None
    assert (
        client.post(
            f"{API}/sessions/{sid}/declare", json={"fault_id": "db_unavailable"}
        ).status_code
        == 409
    )
    # reward matches the environment's timeout semantics: test penalties plus penalty_timeout
    assert final["total_reward"] < -10.0


def test_server_session_matches_local_environment(client):
    """Executing the same tests through the API reproduces the environment's rewards."""
    from diagnoserl.env import DiagnoseRLEnv
    from diagnoserl.incident import sample_incident

    model = load_model("small")
    seed = 7
    sid = _create(client, seed=seed)["id"]
    env = DiagnoseRLEnv(model)
    env.reset(options={"incident": sample_incident(model, np.random.default_rng(seed), seed)})
    total = 0.0
    for i, tid in enumerate(model.test_ids[:3]):
        total += env.step(model.test_ids.index(tid))[1]
        r = client.post(f"{API}/sessions/{sid}/tests", json={"test_id": tid, "expected_step": i})
        assert r.status_code == 200
    state = client.get(f"{API}/sessions/{sid}").json()
    assert state["total_reward"] == pytest.approx(total)
    np.testing.assert_allclose(
        [p["probability"] for p in state["posterior"]], env.public_state().belief, atol=1e-9
    )


# --------------------------------------------------------------------- overview
def test_overview_aggregates_finished_sessions(client):
    empty = client.get(f"{API}/overview").json()
    assert empty["total_sessions"] == 0
    assert empty["success_rate"] is None
    for seed in range(3):
        sid = _create(client, seed=seed)["id"]
        client.post(f"{API}/sessions/{sid}/declare", json={"fault_id": "db_down"})
    _create(client, seed=99)  # left active
    ov = client.get(f"{API}/overview").json()
    assert ov["total_sessions"] == 4
    assert ov["finished_sessions"] == 3
    assert 0.0 <= ov["success_rate"] <= 1.0
    assert ov["by_policy"][0]["policy"] == "cost_aware_bayes"
    assert len(ov["recent_sessions"]) == 4


# ------------------------------------------------------------- policies / ppo
def test_policies_listing_and_ppo_requires_active_model(client):
    pol = client.get(f"{API}/policies").json()
    assert "ppo" in pol["policies"]
    assert pol["ppo_available_for_scenarios"] == []
    r = client.post(f"{API}/sessions", json={"scenario": "small", "policy": "ppo"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "no_active_model"


@pytest.mark.parametrize("policy", ["info_gain", "fixed_order", "random"])
def test_baseline_policies_give_recommendations(client, policy):
    sid = _create(client, policy=policy)["id"]
    rec = client.get(f"{API}/sessions/{sid}/recommendation").json()
    assert rec["policy"] == policy
    assert rec["action"]["type"] in ("test", "declare")


# --------------------------------------------------------------------- security
def test_admin_endpoints_require_valid_key(client):
    body = {"name": "x", "config": {"scenario": "small", "total_timesteps": 1024}}
    assert client.post(f"{API}/experiments/training", json=body).status_code == 401
    r = client.post(f"{API}/experiments/training", json=body, headers={"X-API-Key": "wrong"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"
    assert client.post(f"{API}/models/register", json={"run_name": "x"}).status_code == 401


def test_admin_disabled_without_configured_key(tmp_path):
    with TestClient(build_app(tmp_path, admin_api_key=None)) as c:
        r = c.post(
            f"{API}/models/register", json={"run_name": "x"}, headers={"X-API-Key": "anything"}
        )
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "admin_disabled"


def test_training_request_validation_and_limits(client, admin):
    def post(config):
        return client.post(
            f"{API}/experiments/training", json={"name": "t", "config": config}, headers=admin
        )

    assert post({"scenario": "../../etc/passwd"}).status_code == 400  # bundled scenarios only
    assert post({"scenario": "small", "learning_rate": -1}).status_code == 422
    assert post({"scenario": "small", "bogus": 1}).status_code == 422
    big = post({"scenario": "small", "total_timesteps": 10_000_000})
    assert big.status_code == 400
    assert big.json()["error"]["code"] == "limits_exceeded"
    ok = post(
        {
            "scenario": "small",
            "total_timesteps": 1024,
            "n_envs": 2,
            "n_steps": 64,
            "batch_size": 64,
            "output_dir": "/tmp/evil",
        }
    )
    assert ok.status_code == 202, ok.text
    body = ok.json()
    assert body["status"] == "queued"
    assert body["config"]["output_dir"] != "/tmp/evil"  # server-controlled
    assert client.get(f"{API}/experiments/{body['id']}").json()["status"] == "queued"
    assert client.get(f"{API}/experiments").json()["total"] == 1
    cancelled = client.post(f"{API}/experiments/{body['id']}/cancel", headers=admin)
    assert cancelled.json()["status"] == "cancelled"
    assert client.post(f"{API}/experiments/{body['id']}/cancel", headers=admin).status_code == 409


def test_expensive_operations_are_rate_limited(tmp_path, admin):
    with TestClient(build_app(tmp_path, expensive_rate_limit_per_minute=2)) as c:
        body = {
            "config": {
                "scenario": "small",
                "total_timesteps": 1024,
                "n_envs": 2,
                "n_steps": 64,
                "batch_size": 64,
            }
        }
        codes = [
            c.post(f"{API}/experiments/training", json=body, headers=admin).status_code
            for _ in range(4)
        ]
        assert codes == [202, 202, 429, 429]
        r = c.post(f"{API}/experiments/training", json=body, headers=admin)
        assert r.json()["error"]["code"] == "rate_limited"


def test_request_body_size_limit(tmp_path):
    with TestClient(build_app(tmp_path, max_body_bytes=500)) as c:
        r = c.post(f"{API}/scenarios/validate", json={"text": "x" * 2000})
        assert r.status_code == 413
        assert r.json()["error"]["code"] == "payload_too_large"


def test_request_timeout_returns_504(tmp_path):
    with TestClient(build_app(tmp_path, request_timeout_seconds=1e-9)) as c:
        assert c.get("/health/live").status_code == 504


def test_cors_only_allows_configured_origins(tmp_path):
    with TestClient(build_app(tmp_path, cors_origins=["http://allowed.example"])) as c:
        ok = c.get("/health/live", headers={"Origin": "http://allowed.example"})
        assert ok.headers["access-control-allow-origin"] == "http://allowed.example"
        bad = c.get("/health/live", headers={"Origin": "http://evil.example"})
        assert "access-control-allow-origin" not in bad.headers


def test_unknown_artifact_names_and_paths_are_rejected(client, admin):
    body = {
        "name": "t",
        "config": {
            "scenario": "small",
            "total_timesteps": 1024,
            "n_envs": 2,
            "n_steps": 64,
            "batch_size": 64,
        },
    }
    exp = client.post(f"{API}/experiments/training", json=body, headers=admin).json()
    assert client.get(f"{API}/experiments/{exp['id']}/artifacts/best_model.zip").status_code == 404
    assert client.get(f"{API}/experiments/{exp['id']}/artifacts/..%2Fsecret").status_code == 404
    assert (
        client.get(f"{API}/experiments/{exp['id']}/artifacts/config.json").status_code == 404
    )  # not yet written


def test_evaluation_enqueue_requires_existing_run(client, admin):
    r = client.post(f"{API}/evaluations", json={"run_names": ["ghost"]}, headers=admin)
    assert r.status_code == 404
    r = client.post(f"{API}/evaluations", json={"run_names": ["../x"]}, headers=admin)
    assert r.status_code == 400
    assert client.get(f"{API}/evaluations").json()["total"] == 0


def test_sanity_admin_key_constant_matches_fixture():
    assert ADMIN_KEY == "test-admin-key"
