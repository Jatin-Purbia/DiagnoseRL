from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select

from conftest import ADMIN_KEY, build_app
from diagnoserl.api import orm
from diagnoserl.api.settings import Settings
from diagnoserl.api.worker import Worker

API = "/api/v1"
TINY = {
    "scenario": "small",
    "total_timesteps": 1024,
    "n_envs": 2,
    "n_steps": 64,
    "batch_size": 64,
    "eval_freq": 512,
    "n_val_episodes": 20,
    "tensorboard": False,
    "device": "cpu",
}


def _worker_for(client, tmp_path) -> Worker:
    settings = Settings(
        database_url="sqlite:///:memory:", artifact_dir=tmp_path, admin_api_key=ADMIN_KEY
    )
    return Worker(settings, factory=client.app.state.session_factory)


def test_worker_runs_training_registers_model_then_evaluates(tmp_path):
    admin = {"X-API-Key": ADMIN_KEY}
    with TestClient(build_app(tmp_path)) as c:
        exp = c.post(
            f"{API}/experiments/training", json={"name": "job", "config": TINY}, headers=admin
        ).json()
        assert exp["status"] == "queued"
        worker = _worker_for(c, tmp_path)

        assert worker.run_one() is True
        done = c.get(f"{API}/experiments/{exp['id']}").json()
        assert done["status"] == "succeeded", done
        assert done["progress_timesteps"] >= 1024
        assert done["validation_curve"]
        assert "summary.json" in done["artifacts"]
        assert c.get(f"{API}/experiments/{exp['id']}/artifacts/summary.json").status_code == 200

        # the worker registered the trained model (not active until an admin activates it)
        models = c.get(f"{API}/models").json()
        assert len(models) == 1
        assert models[0]["experiment_id"] == exp["id"]
        assert models[0]["is_active"] is False

        # evaluation job
        ev = c.post(
            f"{API}/evaluations",
            json={
                "run_names": [exp["run_name"]],
                "n_test": 50,
                "n_val": 50,
                "n_robust": 50,
                "skip_robustness": True,
            },
            headers=admin,
        ).json()
        assert c.get(f"{API}/evaluations/{ev['id']}/results").status_code == 409  # not ready
        assert worker.run_one() is True
        assert c.get(f"{API}/evaluations/{ev['id']}").json()["status"] == "succeeded"
        results = c.get(f"{API}/evaluations/{ev['id']}/results").json()
        assert "cost_aware_bayes" in results["baselines"]
        assert (
            c.get(f"{API}/evaluations/{ev['id']}/figures/reward_by_strategy.png").status_code == 200
        )
        assert c.get(f"{API}/evaluations/{ev['id']}/figures/nope.png").status_code == 404
        assert c.get(f"{API}/evaluations/{ev['id']}/figures/..%2Fresults.json").status_code in (
            404,
            422,
        )

        ov = c.get(f"{API}/overview").json()
        assert ov["latest_evaluation_id"] == ev["id"]
        names = {r["policy"] for r in ov["strategy_comparison"]}
        assert {"ppo", "info_gain"} <= names

        assert worker.run_one() is False  # queue empty


def test_worker_marks_failed_jobs_and_recovers_orphans(tmp_path):
    admin = {"X-API-Key": ADMIN_KEY}
    with TestClient(build_app(tmp_path)) as c:
        worker = _worker_for(c, tmp_path)
        exp = c.post(
            f"{API}/experiments/training", json={"name": "bad", "config": TINY}, headers=admin
        ).json()
        # sabotage the stored config so training fails inside the worker
        with c.app.state.session_factory() as db:
            row = db.execute(select(orm.TrainingExperiment)).scalar_one()
            row.config = {**row.config, "scenario": "does-not-exist"}
            db.commit()
        assert worker.run_one() is True
        failed = c.get(f"{API}/experiments/{exp['id']}").json()
        assert failed["status"] == "failed"
        assert failed["error"]

        # an orphaned running job (worker died) is failed on restart
        with c.app.state.session_factory() as db:
            row = db.execute(select(orm.TrainingExperiment)).scalar_one()
            row.status = "running"
            db.commit()
        assert worker.recover() == 1
        assert c.get(f"{API}/experiments/{exp['id']}").json()["status"] == "failed"


def test_cancelled_jobs_are_not_run(tmp_path):
    admin = {"X-API-Key": ADMIN_KEY}
    with TestClient(build_app(tmp_path)) as c:
        exp = c.post(
            f"{API}/experiments/training", json={"name": "c", "config": TINY}, headers=admin
        ).json()
        c.post(f"{API}/experiments/{exp['id']}/cancel", headers=admin)
        assert _worker_for(c, tmp_path).run_one() is False
