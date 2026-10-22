from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import pytest

from diagnoserl.agents import RLPolicy
from diagnoserl.baselines import CostAwareBayesPolicy
from diagnoserl.config.transforms import with_noise
from diagnoserl.env import RewardConfig
from diagnoserl.evaluation import robustness
from diagnoserl.evaluation.experiment import (
    compare_policies,
    evaluate_trials,
    strip_raw,
    tune_on_validation,
)
from diagnoserl.evaluation.run import format_report, load_runs, run
from diagnoserl.incident import generate_incidents
from diagnoserl.training import TrainConfig
from diagnoserl.training.train import train


@pytest.fixture(scope="module")
def tiny_run(tmp_path_factory):
    out = tmp_path_factory.mktemp("runs")
    cfgs = [
        TrainConfig(
            scenario="small",
            run_name=f"r{seed}",
            seed=seed,
            total_timesteps=1024,
            n_envs=2,
            n_steps=64,
            batch_size=64,
            eval_freq=512,
            n_val_episodes=20,
            output_dir=str(out),
            tensorboard=False,
            device="cpu",
        )
        for seed in (0, 1)
    ]
    return [train(c).run_dir for c in cfgs]


def test_tuning_uses_only_validation_incidents(small_model):
    reward = RewardConfig()
    val = generate_incidents(small_model, 150, seed=1)
    a = tune_on_validation(small_model, reward, val)
    b = tune_on_validation(small_model, reward, val)
    assert a == b
    assert set(a) == {"fixed_order", "random", "info_gain", "cost_aware_bayes"}


def test_compare_policies_structure_and_pairing(small_model, tiny_run):
    reward = RewardConfig()
    _, rl = load_runs(tiny_run, "final")
    val = generate_incidents(small_model, 80, seed=11)
    test = generate_incidents(small_model, 120, seed=22)
    res = compare_policies(small_model, reward, val, test, rl, random_trials=2)

    assert set(res["baselines"]) == {"fixed_order", "random", "info_gain", "cost_aware_bayes"}
    assert set(res["rl"]["per_seed"]) == set(rl)
    assert res["n_test_episodes"] == 120
    lo, hi = res["baselines"]["info_gain"]["reward_ci"]
    assert lo <= res["baselines"]["info_gain"]["summary"]["mean_reward"] <= hi
    for d in res["paired_rl_minus_baseline"].values():
        assert d["ci_low"] <= d["mean_diff"] <= d["ci_high"]
    # sweeps cover every family and are plain JSON
    assert {s["family"] for s in res["sweeps"]} == set(res["baselines"])
    json.dumps(strip_raw(res))
    assert "_raw" not in strip_raw(res)


def test_every_policy_is_scored_on_identical_incidents(small_model):
    reward = RewardConfig()
    test = generate_incidents(small_model, 60, seed=5)
    from diagnoserl.env import DiagnoseRLEnv

    env = DiagnoseRLEnv(small_model, reward)
    ev = evaluate_trials(env, lambda: CostAwareBayesPolicy(small_model, reward), test, small_model)
    assert [r.true_fault for r in ev.records] == [i.fault for i in test]
    assert ev.rewards.shape == (60,)


def test_noise_condition_makes_true_model_noisier(small_model):
    spec = robustness.noise_condition(small_model, RewardConfig())(0.5)
    np.testing.assert_allclose(spec.model.likelihood, with_noise(small_model, 0.5).likelihood)


def test_cost_multiplier_and_penalty_conditions(small_model):
    reward = RewardConfig()
    spec = robustness.cost_multiplier_condition(small_model, reward)(2.0)
    assert spec.reward.lambda_cost == pytest.approx(2 * reward.lambda_cost)
    assert spec.reward.lambda_time == pytest.approx(2 * reward.lambda_time)
    spec = robustness.wrong_penalty_condition(small_model, reward)(40.0)
    assert spec.reward.penalty_wrong == 40.0
    assert spec.reward.reward_correct == reward.reward_correct


def test_prior_shift_conditions_informed_vs_misspecified(small_model):
    conds = dict(robustness.prior_shift_conditions(small_model, RewardConfig(), [1]))
    informed, mis = conds["informed_1"], conds["misspecified_1"]
    assert informed.sampling_prior is None
    assert not np.allclose(informed.model.prior, small_model.prior)
    np.testing.assert_allclose(mis.model.prior, small_model.prior)  # beliefs unaware
    assert mis.sampling_prior is not None


def test_noisier_tests_lower_the_cost_aware_baseline(small_model):
    reward = RewardConfig()
    tuned = tune_on_validation(small_model, reward, generate_incidents(small_model, 60, seed=1))
    rows = robustness.sweep(
        [0.0, 0.8], robustness.noise_condition(small_model, reward), tuned, {}, 400, seed=3
    )
    by = {r["param"]: r["mean_reward"] for r in rows if r["policy"] == "cost_aware_bayes"}
    assert by[0.0] > by[0.8]


def test_load_runs_rejects_mismatched_configs(tiny_run, tmp_path):
    bad = tmp_path / "bad"
    bad.mkdir()
    cfg = json.loads((tiny_run[0] / "config.json").read_text())
    cfg["scenario"] = "standard"
    (bad / "config.json").write_text(json.dumps(cfg))
    with pytest.raises(ValueError):
        load_runs([tiny_run[0], bad], "final")


def test_run_end_to_end_writes_report_and_figures(tiny_run, tmp_path):
    out = tmp_path / "eval"
    args = argparse.Namespace(
        runs=[str(p) for p in tiny_run],
        out=str(out),
        model="final",
        n_test=60,
        n_val=40,
        n_robust=30,
        skip_robustness=False,
    )
    run(args)
    results = json.loads((out / "results.json").read_text())
    exact = results["reference"]["exact"]
    assert exact["optimal_value"] > 0  # small scenario: optimal policy earns positive reward
    assert exact["summary"]["accuracy"] > results["baselines"]["random"]["summary"]["accuracy"]
    assert {"noise", "wrong_penalty", "cost_multiplier", "prior_shift"} <= set(
        results["robustness"]
    )
    report = (out / "report.md").read_text()
    assert "cost_aware_bayes" in report
    assert "Exact optimal value" in report
    for fig in ("accuracy_vs_cost", "reward_by_strategy", "training_curves", "sensitivity_noise"):
        assert (out / "figures" / f"{fig}.png").stat().st_size > 1000


def test_format_report_handles_missing_rl(small_model):
    reward = RewardConfig()
    val = generate_incidents(small_model, 40, seed=1)
    test = generate_incidents(small_model, 40, seed=2)
    res = strip_raw(compare_policies(small_model, reward, val, test, {}, random_trials=1))
    text = format_report(res, "t")
    assert "| fixed_order |" in text
    assert "ppo" not in text


def test_rl_policy_wrapper_type(tiny_run):
    policy = RLPolicy.load(Path(tiny_run[0]) / "final_model.zip")
    assert policy.name == "maskable_ppo"
