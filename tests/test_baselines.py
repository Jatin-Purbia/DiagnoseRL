from __future__ import annotations

import numpy as np
import pytest

from conftest import make_scenario
from diagnoserl import bayes
from diagnoserl.baselines import (
    CostAwareBayesPolicy,
    ExactPolicy,
    ExactSolver,
    FixedOrderPolicy,
    InformationGainPolicy,
    RandomPolicy,
    ScenarioTooLargeError,
)
from diagnoserl.baselines.base import declaration_utility
from diagnoserl.config import ScenarioConfig
from diagnoserl.env import DiagnoseRLEnv, RewardConfig
from diagnoserl.evaluation import evaluate_policy
from diagnoserl.incident import generate_incidents


def _env(model, reward=None):
    return DiagnoseRLEnv(model, reward)


def _rewards(env, policy, incidents):
    return np.array([r.reward for r in evaluate_policy(env, policy, incidents)])


# ---------------------------------------------------------------- generic
@pytest.mark.parametrize(
    "make",
    [
        lambda m, r: FixedOrderPolicy(m),
        lambda m, r: FixedOrderPolicy(m, max_tests=3),
        lambda m, r: RandomPolicy(m, stop_prob=0.2),
        lambda m, r: InformationGainPolicy(m, r),
        lambda m, r: CostAwareBayesPolicy(m, r, depth=1),
        lambda m, r: CostAwareBayesPolicy(m, r, depth=2),
    ],
)
def test_baselines_never_play_illegal_actions_or_truncate(standard_model, make):
    reward = RewardConfig()
    policy = make(standard_model, reward)
    incidents = generate_incidents(standard_model, 150, seed=100)
    records = evaluate_policy(_env(standard_model, reward), policy, incidents)
    assert len(records) == 150  # an illegal action would have raised
    assert not any(r.truncated for r in records)
    assert all(r.n_tests <= standard_model.max_steps - 1 for r in records)


# ------------------------------------------------------------- fixed order
def test_fixed_order_runs_prefix_of_order_then_declares(standard_model):
    order = [4, 2, 0, 1, 3]
    policy = FixedOrderPolicy(standard_model, order=order, max_tests=3)
    rec = evaluate_policy(_env(standard_model), policy, generate_incidents(standard_model, 1, 0))[0]
    n = standard_model.n_tests
    assert list(rec.actions[:3]) == order[:3]
    assert rec.actions[3] >= n  # declaration
    assert len(rec.actions) == 4


def test_fixed_order_skips_ineligible_tests(standard_model):
    ext = standard_model.test_ids.index("external_dependency_latency")
    policy = FixedOrderPolicy(standard_model, order=[ext, 0], max_tests=2)
    rec = evaluate_policy(_env(standard_model), policy, generate_incidents(standard_model, 1, 0))[0]
    assert rec.actions[0] == 0  # external test skipped (prerequisite unmet)


def test_fixed_order_default_uses_step_budget(standard_model):
    assert FixedOrderPolicy(standard_model).max_tests == standard_model.max_steps - 1


# ------------------------------------------------------------------ random
def test_random_policy_is_reproducible_and_seed_sensitive(standard_model):
    incidents = generate_incidents(standard_model, 30, seed=3)
    env = _env(standard_model)
    a = evaluate_policy(env, RandomPolicy(standard_model), incidents, policy_seed=1)
    b = evaluate_policy(env, RandomPolicy(standard_model), incidents, policy_seed=1)
    c = evaluate_policy(env, RandomPolicy(standard_model), incidents, policy_seed=2)
    assert [r.actions for r in a] == [r.actions for r in b]
    assert [r.actions for r in a] != [r.actions for r in c]


def test_random_policy_stop_probability_extremes(standard_model):
    incidents = generate_incidents(standard_model, 20, seed=3)
    env = _env(standard_model)
    immediately = evaluate_policy(env, RandomPolicy(standard_model, stop_prob=1.0), incidents)
    assert all(r.n_tests == 0 for r in immediately)
    never = evaluate_policy(env, RandomPolicy(standard_model, stop_prob=0.0), incidents)
    assert all(r.n_tests == standard_model.max_steps - 1 for r in never)
    with pytest.raises(ValueError):
        RandomPolicy(standard_model, stop_prob=1.5)


# ------------------------------------------------------------- info gain
def test_info_gain_picks_best_gain_per_cost(standard_model):
    reward = RewardConfig()
    env = _env(standard_model, reward)
    env.reset(seed=0)
    policy = InformationGainPolicy(standard_model, reward, threshold=0.99)
    state = env.public_state()
    action = policy.act(state, np.zeros(1))
    pen = np.maximum([reward.test_penalty(standard_model, t) for t in range(13)], 1e-6)
    ratios = []
    for t in range(standard_model.n_tests):
        if state.mask[t]:
            gain = bayes.expected_information_gain(standard_model, state.belief, t)
            ratios.append((gain / pen[t], t))
    assert action == max(ratios)[1]
    explanation = policy.explain(state)
    assert explanation["test"] == standard_model.test_ids[action]
    assert explanation["expected_entropy_reduction_bits"] > 0


def test_info_gain_declares_when_confident(standard_model):
    env = _env(standard_model)
    env.reset(seed=0)
    policy = InformationGainPolicy(standard_model, threshold=0.0)
    assert policy.act(env.public_state(), np.zeros(1)) >= standard_model.n_tests


def test_info_gain_handles_zero_cost_tests():
    data = make_scenario()
    for t in data["tests"]:
        t["cost"], t["duration"] = 0, 0
    model = ScenarioConfig.model_validate(data).compile()
    env = DiagnoseRLEnv(model)
    env.reset(seed=0)
    action = InformationGainPolicy(model, threshold=0.99).act(env.public_state(), np.zeros(1))
    assert 0 <= action < model.n_actions


# --------------------------------------------------------- cost-aware bayes
def test_cost_aware_declares_when_testing_is_too_expensive(standard_model):
    env = _env(standard_model, RewardConfig(lambda_cost=1000.0, lambda_time=1000.0))
    env.reset(seed=0)
    policy = CostAwareBayesPolicy(standard_model, env.reward_config)
    assert policy.act(env.public_state(), np.zeros(1)) >= standard_model.n_tests


def test_cost_aware_tests_when_testing_is_free(standard_model):
    reward = RewardConfig(lambda_cost=0.0, lambda_time=0.0)
    env = _env(standard_model, reward)
    env.reset(seed=0)
    policy = CostAwareBayesPolicy(standard_model, reward, depth=1)
    assert policy.act(env.public_state(), np.zeros(1)) < standard_model.n_tests


def test_cost_aware_explanation_uses_reward_units(standard_model):
    reward = RewardConfig()
    env = _env(standard_model, reward)
    env.reset(seed=0)
    info = CostAwareBayesPolicy(standard_model, reward).explain(env.public_state())
    assert info["utility_declare_now"] == pytest.approx(
        declaration_utility(env.public_state().belief, reward)
    )
    assert "utility_best_test" in info
    with pytest.raises(ValueError):
        CostAwareBayesPolicy(standard_model, reward, depth=0)


# ------------------------------------------------------------ exact solver
def _brute_force_value(model, reward):
    """Independent reference: recursion on explicit normalised beliefs."""
    pen = [reward.test_penalty(model, t) for t in range(model.n_tests)]

    def value(p, executed, steps):
        best = float((p * reward.reward_correct - (1 - p) * reward.penalty_wrong).max())
        if steps + 1 >= model.max_steps:
            return best
        for t in np.flatnonzero(model.available_tests(executed)):
            q = -pen[t]
            for o in range(model.n_outcomes):
                po = float((p * model.likelihood[t, :, o]).sum())
                if po > 0:
                    post = p * model.likelihood[t, :, o] / po
                    nxt = executed.copy()
                    nxt[t] = True
                    q += po * value(post, nxt, steps + 1)
            best = max(best, q)
        return best

    return value(model.prior, np.zeros(model.n_tests, dtype=bool), 0)


def test_exact_solver_matches_independent_brute_force_tiny(tiny_model):
    reward = RewardConfig()
    assert ExactSolver(tiny_model, reward).optimal_value() == pytest.approx(
        _brute_force_value(tiny_model, reward)
    )


def test_exact_solver_matches_independent_brute_force_small(small_model):
    reward = RewardConfig()
    assert ExactSolver(small_model, reward).optimal_value() == pytest.approx(
        _brute_force_value(small_model, reward)
    )


def test_exact_value_equals_simulated_return_of_exact_policy(small_model):
    """Validates environment reward accounting against the analytic optimum."""
    reward = RewardConfig()
    policy = ExactPolicy(small_model, reward)
    records = evaluate_policy(
        _env(small_model, reward), policy, generate_incidents(small_model, 4000, seed=7)
    )
    rew = np.array([r.reward for r in records])
    stderr = rew.std(ddof=1) / np.sqrt(len(rew))
    assert abs(rew.mean() - policy.solver.optimal_value()) < 4 * stderr
    assert not any(r.truncated for r in records)


def test_exact_policy_dominates_other_baselines(small_model):
    reward = RewardConfig()
    incidents = generate_incidents(small_model, 3000, seed=8)
    env = _env(small_model, reward)
    exact = _rewards(env, ExactPolicy(small_model, reward), incidents)
    others = {
        "fixed": FixedOrderPolicy(small_model, max_tests=2),
        "random": RandomPolicy(small_model),
        "ig": InformationGainPolicy(small_model, reward),
        "cab1": CostAwareBayesPolicy(small_model, reward, depth=1),
        "cab2": CostAwareBayesPolicy(small_model, reward, depth=2),
    }
    for name, pol in others.items():
        diff = exact - np.array([r.reward for r in evaluate_policy(env, pol, incidents)])
        stderr = diff.std(ddof=1) / np.sqrt(len(diff))
        assert diff.mean() > -3 * stderr, f"{name} beat the optimal policy"


def test_deeper_lookahead_not_worse_than_myopic(small_model):
    reward = RewardConfig()
    incidents = generate_incidents(small_model, 2000, seed=9)
    env = _env(small_model, reward)
    d1 = _rewards(env, CostAwareBayesPolicy(small_model, reward, 1), incidents).mean()
    d2 = _rewards(env, CostAwareBayesPolicy(small_model, reward, 2), incidents).mean()
    assert d2 >= d1 - 0.05


def test_exact_solver_refuses_large_scenarios(standard_model):
    with pytest.raises(ScenarioTooLargeError):
        ExactSolver(standard_model)


def test_exact_solver_respects_prerequisites():
    data = make_scenario(max_steps=3)
    data["tests"][1]["requires"] = ["t1"]
    model = ScenarioConfig.model_validate(data).compile()
    reward = RewardConfig()
    assert ExactSolver(model, reward).optimal_value() == pytest.approx(
        _brute_force_value(model, reward)
    )
