from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from pydantic import ValidationError

from diagnoserl.agents import RLPolicy
from diagnoserl.env import DiagnoseRLEnv
from diagnoserl.evaluation import evaluate_policy
from diagnoserl.incident import generate_incidents
from diagnoserl.training import TrainConfig, load_train_config
from diagnoserl.training.train import train

REPO = Path(__file__).resolve().parents[1]


def _tiny_cfg(tmp_path: Path, **overrides) -> TrainConfig:
    base = {
        "scenario": "small",
        "run_name": "t",
        "total_timesteps": 1024,
        "n_envs": 2,
        "n_steps": 64,
        "batch_size": 64,
        "eval_freq": 512,
        "checkpoint_freq": 512,
        "n_val_episodes": 20,
        "output_dir": str(tmp_path),
        "tensorboard": False,
        "device": "cpu",
    }
    return TrainConfig.model_validate({**base, **overrides})


# ---------------------------------------------------------------- config
def test_shipped_configs_are_valid():
    for name in ("smoke.yaml", "full.yaml"):
        cfg = load_train_config(REPO / "configs" / name)
        cfg.load_scenario()


def test_seeds_must_differ():
    with pytest.raises(ValidationError):
        TrainConfig(seed=1, val_seed=1)
    with pytest.raises(ValidationError):
        TrainConfig(val_seed=5, test_seed=5)


def test_batch_size_must_divide_rollout():
    with pytest.raises(ValidationError):
        TrainConfig(n_envs=3, n_steps=100, batch_size=64)


def test_unknown_config_field_rejected():
    with pytest.raises(ValidationError):
        TrainConfig.model_validate({"learning_rat": 1})


# ------------------------------------------------------------ training
@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    cfg = _tiny_cfg(tmp_path_factory.mktemp("run"))
    return cfg, train(cfg)


def test_training_writes_expected_artifacts(trained):
    cfg, result = trained
    expected = ("best_model.zip", "final_model.zip", "config.json", "metrics.jsonl", "summary.json")
    for name in expected:
        assert (result.run_dir / name).is_file(), name
    assert list((result.run_dir / "checkpoints").glob("ppo_*.zip"))
    summary = json.loads((result.run_dir / "summary.json").read_text())
    assert summary["seed"] == cfg.seed
    assert len(summary["best_model_sha256"]) == 64
    lines = (result.run_dir / "metrics.jsonl").read_text().strip().splitlines()
    steps = [json.loads(line)["timesteps"] for line in lines]
    assert steps[0] == 0
    assert steps == sorted(steps)
    assert len(steps) == len(set(steps))  # no duplicated evaluation points


def test_saved_config_round_trips(trained):
    cfg, result = trained
    assert TrainConfig.model_validate_json((result.run_dir / "config.json").read_text()) == cfg


def test_checkpoint_reload_gives_identical_predictions(trained, small_model):
    cfg, result = trained
    a = RLPolicy.load(result.final_model_path)
    b = RLPolicy.load(result.final_model_path)
    env = DiagnoseRLEnv(small_model, cfg.reward.to_reward_config())
    incidents = generate_incidents(small_model, 10, seed=1)
    ra = evaluate_policy(env, a, incidents)
    rb = evaluate_policy(env, b, incidents)
    assert [r.actions for r in ra] == [r.actions for r in rb]


def test_rl_policy_never_selects_masked_actions(trained, small_model):
    """Even a barely trained network must respect the mask in every state."""
    cfg, result = trained
    policy = RLPolicy.load(result.final_model_path)
    env = DiagnoseRLEnv(small_model, cfg.reward.to_reward_config())
    rng = np.random.default_rng(0)
    for inc in generate_incidents(small_model, 50, seed=2):
        obs, _ = env.reset(options={"incident": inc})
        done = False
        while not done:
            state = env.public_state()
            action = policy.act(state, obs)
            assert state.mask[action]
            probs = policy.action_probabilities(state, obs)
            assert probs.sum() == pytest.approx(1.0, abs=1e-5)
            assert np.all(probs[~state.mask] == 0.0)
            # follow a random legal action sometimes to visit varied states
            if rng.random() < 0.5:
                action = int(rng.choice(np.flatnonzero(state.mask)))
            obs, _, term, trunc, _ = env.step(action)
            done = term or trunc


def test_evaluation_of_trained_policy_runs_without_invalid_actions(trained, small_model):
    cfg, result = trained
    env = DiagnoseRLEnv(small_model, cfg.reward.to_reward_config())
    policy = RLPolicy.load(result.best_model_path)
    records = evaluate_policy(env, policy, generate_incidents(small_model, 100, seed=3))
    assert len(records) == 100  # an illegal action would have raised


def _weights(path: Path) -> list[np.ndarray]:
    from sb3_contrib import MaskablePPO

    model = MaskablePPO.load(str(path), device="cpu")
    return [p.detach().cpu().numpy() for p in model.policy.parameters()]


def test_training_is_reproducible_for_a_fixed_seed(tmp_path):
    """Same seed -> bit-identical weights; different seed -> different weights."""
    a = train(_tiny_cfg(tmp_path / "a", seed=5))
    b = train(_tiny_cfg(tmp_path / "b", seed=5))
    c = train(_tiny_cfg(tmp_path / "c", seed=6))
    wa, wb, wc = (_weights(r.final_model_path) for r in (a, b, c))
    assert all(np.array_equal(x, y) for x, y in zip(wa, wb, strict=True))
    assert any(not np.array_equal(x, y) for x, y in zip(wa, wc, strict=True))


def test_validation_uses_fixed_incidents_not_training_stream(trained, small_model):
    """The validation set depends only on val_seed (never on the training seed)."""
    cfg, _ = trained
    a = generate_incidents(small_model, cfg.n_val_episodes, cfg.val_seed)
    b = generate_incidents(small_model, cfg.n_val_episodes, cfg.val_seed)
    assert all(
        np.array_equal(x.outcomes, y.outcomes) and x.fault == y.fault
        for x, y in zip(a, b, strict=True)
    )
    test_set = generate_incidents(small_model, cfg.n_val_episodes, cfg.test_seed)
    assert any(
        x.fault != y.fault or not np.array_equal(x.outcomes, y.outcomes)
        for x, y in zip(a, test_set, strict=True)
    )


def test_training_records_real_ppo_telemetry_and_a_log(tmp_path):
    cfg = _tiny_cfg(tmp_path, total_timesteps=1536)  # 12 rollouts of 128 steps
    result = train(cfg)
    metrics = result.run_dir / "train_metrics.jsonl"
    rows = [json.loads(line) for line in metrics.read_text().splitlines()]
    assert rows, "telemetry file is empty"
    steps = [r["timesteps"] for r in rows]
    assert steps == sorted(steps)
    last = rows[-1]
    assert {"wall_seconds", "ep_rew_mean", "ep_len_mean"} <= set(last)
    # losses come from SB3's logger: present after the first update, never invented before it
    with_loss = [r for r in rows if "value_loss" in r]
    assert with_loss, "no update diagnostics were recorded"
    assert all({"policy_loss", "entropy_loss", "approx_kl"} <= set(r) for r in with_loss)
    assert all(r["value_loss"] >= 0.0 for r in with_loss)
    # reward/length are raw (unscaled) episode statistics
    assert -40.0 < last["ep_rew_mean"] < 40.0
    log_lines = (result.run_dir / "train.log").read_text().splitlines()
    parsed = [json.loads(line) for line in log_lines]
    assert parsed[0]["msg"] == "training started"
    assert any(p["msg"] == "validation" for p in parsed)
