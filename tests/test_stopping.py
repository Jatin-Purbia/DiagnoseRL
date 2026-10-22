from __future__ import annotations

import pytest

from diagnoserl.baselines import CostAwareBayesPolicy, FixedOrderPolicy
from diagnoserl.env import DiagnoseRLEnv, RewardConfig
from diagnoserl.evaluation.stopping import compare_stopping, stopping_profile
from diagnoserl.incident import generate_incidents


def test_fixed_policy_has_zero_variance_adaptive_policy_does_not(small_model):
    incidents = generate_incidents(small_model, 400, seed=3)
    env = DiagnoseRLEnv(small_model)
    fixed = stopping_profile(env, FixedOrderPolicy(small_model, max_tests=3), incidents)
    assert fixed["mean_tests"] == 3.0
    assert fixed["std_tests"] == 0.0

    adaptive = stopping_profile(
        env, CostAwareBayesPolicy(small_model, RewardConfig(), 1), incidents
    )
    assert adaptive["std_tests"] > 0.0
    assert adaptive["p10_tests"] <= adaptive["mean_tests"] <= adaptive["p90_tests"]
    assert 0.0 < adaptive["mean_confidence_at_declaration"] <= 1.0
    # confidence is informative about correctness
    assert adaptive["accuracy_high_confidence_half"] > adaptive["accuracy_low_confidence_half"]


def test_compare_stopping_covers_baselines_and_given_policies(small_model):
    incidents = generate_incidents(small_model, 60, seed=4)
    extra = {"mine": FixedOrderPolicy(small_model, max_tests=1)}
    tuned = {"fixed_order": 2, "info_gain": 0.8, "cost_aware_bayes": 1}
    out = compare_stopping(small_model, RewardConfig(), incidents, extra, tuned)
    assert set(out) == {"fixed_order", "info_gain", "cost_aware_bayes", "mine"}
    assert out["mine"]["mean_tests"] == pytest.approx(1.0)
    assert out["fixed_order"]["mean_tests"] == pytest.approx(2.0)
