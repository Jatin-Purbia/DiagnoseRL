from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from conftest import build_app
from diagnoserl.api import orm
from diagnoserl.training import TrainConfig
from diagnoserl.training.train import train

API = "/api/v1"


@pytest.fixture(scope="module")
def artifact_dir(tmp_path_factory):
    """Artifact dir holding one tiny trained run on the `small` scenario."""
    root = tmp_path_factory.mktemp("artifacts")
    train(
        TrainConfig(
            scenario="small",
            run_name="tiny",
            total_timesteps=1024,
            n_envs=2,
            n_steps=64,
            batch_size=64,
            eval_freq=512,
            n_val_episodes=20,
            output_dir=str(root / "runs"),
            tensorboard=False,
            device="cpu",
        )
    )
    return root


@pytest.fixture
def app_client(artifact_dir, tmp_path):
    # Copy-free: each test gets a fresh DB but shares the read-only trained run.
    with TestClient(build_app(artifact_dir)) as c:
        yield c


def _register(client, admin, checkpoint="best"):
    r = client.post(
        f"{API}/models/register", json={"run_name": "tiny", "checkpoint": checkpoint}, headers=admin
    )
    assert r.status_code == 201, r.text
    return r.json()


def test_register_model_records_validation_metrics_and_hash(app_client, admin):
    m = _register(app_client, admin)
    assert m["name"] == "tiny:best"
    assert m["scenario"] == "small"
    assert len(m["sha256"]) == 64
    assert m["is_active"] is False
    assert "mean_reward" in m["metrics"]["validation"]
    assert app_client.get(f"{API}/models").json()[0]["id"] == m["id"]
    assert m["metrics"]["checkpoint"] == "best"
    # registering again is idempotent
    again = _register(app_client, admin)
    assert again["id"] == m["id"]


def test_register_rejects_unknown_or_malicious_run_names(app_client, admin):
    for name in ("ghost", "../tiny", "a/b", ""):
        r = app_client.post(f"{API}/models/register", json={"run_name": name}, headers=admin)
        assert r.status_code in (404, 422), name


def test_activation_audit_and_single_active_model(app_client, admin):
    best = _register(app_client, admin, "best")
    final = _register(app_client, admin, "final")
    a = app_client.post(f"{API}/models/{best['id']}/activate", headers=admin)
    assert a.status_code == 200
    assert a.json()["is_active"] is True
    b = app_client.post(f"{API}/models/{final['id']}/activate", headers=admin)
    assert b.json()["is_active"] is True
    models = {m["id"]: m for m in app_client.get(f"{API}/models").json()}
    assert models[best["id"]]["is_active"] is False  # only one active per scenario
    assert models[final["id"]]["is_active"] is True
    assert app_client.get(f"{API}/policies").json()["ppo_available_for_scenarios"] == ["small"]
    with app_client.app.state.session_factory() as db:
        events = (
            db.execute(select(orm.AuditEvent).where(orm.AuditEvent.action == "model.activate"))
            .scalars()
            .all()
        )
    assert len(events) == 2
    assert all(e.actor == "admin" for e in events)
    # activation requires admin
    assert app_client.post(f"{API}/models/{best['id']}/activate").status_code == 401
    d = app_client.post(f"{API}/models/{final['id']}/deactivate", headers=admin)
    assert d.json()["is_active"] is False
    assert (
        app_client.post(f"{API}/models/{final['id']}/deactivate", headers=admin).status_code == 409
    )


def test_ppo_session_recommendation_has_honest_explanation(app_client, admin):
    m = _register(app_client, admin)
    app_client.post(f"{API}/models/{m['id']}/activate", headers=admin)
    s = app_client.post(
        f"{API}/sessions", json={"scenario": "small", "policy": "ppo", "seed": 3}
    ).json()
    assert s["model_version_id"] == m["id"]
    rec = app_client.get(f"{API}/sessions/{s['id']}/recommendation").json()
    assert rec["policy"] == "ppo"
    ex = rec["explanation"]
    assert ex["method"] == "policy_network_action_distribution"
    assert "not calibrated" in ex["note"]
    probs = [a["probability"] for a in ex["top_actions"]]
    assert probs == sorted(probs, reverse=True)
    assert 0 < sum(probs) <= 1.0 + 1e-6
    # following the full loop works and records whether the recommendation was followed
    action = rec["action"]
    if action["type"] == "test":
        r = app_client.post(f"{API}/sessions/{s['id']}/tests", json={"test_id": action["id"]})
        assert r.json()["result"]["followed_recommendation"] is True


def test_tampered_checkpoint_cannot_be_activated_or_used(artifact_dir, admin, tmp_path):
    import shutil

    art = tmp_path / "art"
    shutil.copytree(artifact_dir, art)
    with TestClient(build_app(art)) as c:
        m = _register(c, admin)
        c.post(f"{API}/models/{m['id']}/activate", headers=admin)
        ckpt = art / "runs" / "tiny" / "best_model.zip"
        ckpt.write_bytes(ckpt.read_bytes() + b"tampered")
        sid = c.post(
            f"{API}/sessions", json={"scenario": "small", "policy": "ppo", "seed": 1}
        ).json()["id"]
        rec = c.get(f"{API}/sessions/{sid}/recommendation")
        assert rec.status_code == 409
        assert rec.json()["error"]["code"] == "model_corrupt"
        other = _register(c, admin, "final")
        ckpt.unlink()
        bad = c.post(f"{API}/models/{m['id']}/activate", headers=admin)
        assert bad.status_code == 400
        assert bad.json()["error"]["code"] == "model_invalid"
        assert other["id"] != m["id"]


def test_model_for_wrong_scenario_shape_is_rejected(artifact_dir, admin, tmp_path):
    import shutil

    art = tmp_path / "art2"
    shutil.copytree(artifact_dir, art)
    with TestClient(build_app(art)) as c:
        m = _register(c, admin)
        with c.app.state.session_factory() as db:
            row = db.get(orm.ModelVersion, __import__("uuid").UUID(m["id"]))
            row.scenario = "standard"  # checkpoint was trained for `small`
            db.commit()
        r = c.post(f"{API}/models/{m['id']}/activate", headers=admin)
        assert r.status_code == 400
        assert any("space" in p for p in r.json()["error"]["details"]["problems"])
