from __future__ import annotations

import numpy as np
import pytest
from gymnasium.utils.env_checker import check_env

from conftest import make_scenario
from diagnoserl import bayes
from diagnoserl.config import ScenarioConfig
from diagnoserl.env import DiagnoseRLEnv, InvalidActionError, RewardConfig
from diagnoserl.incident import Incident, generate_incidents


def _incident(model, fault: int, outcomes: list[int], iid: int = 0) -> Incident:
    return Incident(iid, fault, np.array(outcomes, dtype=np.int64))


def test_gymnasium_api_conformance(standard_model):
    check_env(DiagnoseRLEnv(standard_model), skip_render_check=True)


def test_observation_and_mask_shapes(standard_model):
    env = DiagnoseRLEnv(standard_model)
    obs, info = env.reset(seed=0)
    m = standard_model
    expected_size = m.n_tests * m.n_outcomes + m.n_tests + 3 + m.n_faults
    assert obs.shape == env.observation_space.shape == (expected_size,)
    assert obs.dtype == np.float32
    assert env.observation_space.contains(obs)
    assert env.action_masks().shape == (m.n_actions,) == (25,)
    assert info["action_mask"].dtype == bool


def test_observation_without_posterior_is_smaller(standard_model):
    a = DiagnoseRLEnv(standard_model).observation_space.shape[0]
    b = DiagnoseRLEnv(standard_model, include_posterior=False).observation_space.shape[0]
    assert a - b == standard_model.n_faults


def test_initial_mask_allows_everything_without_prerequisites(standard_model):
    env = DiagnoseRLEnv(standard_model)
    env.reset(seed=0)
    mask = env.action_masks()
    ext = standard_model.test_ids.index("external_dependency_latency")
    assert not mask[ext]  # prerequisite network_connectivity not yet run
    assert mask.sum() == standard_model.n_actions - 1


def test_prerequisite_unlocks_after_dependency(standard_model):
    env = DiagnoseRLEnv(standard_model)
    env.reset(seed=0)
    net = standard_model.test_ids.index("network_connectivity")
    ext = standard_model.test_ids.index("external_dependency_latency")
    env.step(net)
    assert env.action_masks()[ext]


def test_executed_test_is_masked_and_rejected(tiny_model):
    env = DiagnoseRLEnv(tiny_model)
    env.reset(seed=0)
    env.step(0)
    assert not env.action_masks()[0]
    with pytest.raises(InvalidActionError):
        env.step(0)


def test_out_of_range_action_rejected(tiny_model):
    env = DiagnoseRLEnv(tiny_model)
    env.reset(seed=0)
    for bad in (-1, tiny_model.n_actions):
        with pytest.raises(InvalidActionError):
            env.step(bad)


def test_test_reward_formula(tiny_model):
    cfg = RewardConfig(lambda_cost=0.5, lambda_time=0.25)
    env = DiagnoseRLEnv(tiny_model, cfg)
    env.reset(options={"incident": _incident(tiny_model, 0, [0, 0])})
    # t1: cost 1/3 (max cost 3), duration 2/6 -> 0.5/3 + 0.25/3
    _, r, term, trunc, _ = env.step(0)
    assert r == pytest.approx(-(0.5 * (1 / 3) + 0.25 * (2 / 6)))
    assert not term
    assert not trunc


def test_correct_and_wrong_declaration_rewards(tiny_model):
    cfg = RewardConfig(reward_correct=7.0, penalty_wrong=4.0)
    env = DiagnoseRLEnv(tiny_model, cfg)
    n_tests = tiny_model.n_tests

    env.reset(options={"incident": _incident(tiny_model, 0, [0, 0])})
    _, r, term, trunc, info = env.step(n_tests + 0)
    assert (r, term, trunc, info["correct"]) == (7.0, True, False, True)

    env.reset(options={"incident": _incident(tiny_model, 0, [0, 0])})
    _, r, term, trunc, info = env.step(n_tests + 1)
    assert (r, term, trunc, info["correct"]) == (-4.0, True, False, False)
    assert info["declared_fault"] == 1


def test_step_after_termination_raises(tiny_model):
    env = DiagnoseRLEnv(tiny_model)
    env.reset(seed=0)
    env.step(tiny_model.n_tests)
    with pytest.raises(RuntimeError):
        env.step(0)


def test_step_before_reset_raises(tiny_model):
    with pytest.raises(RuntimeError):
        DiagnoseRLEnv(tiny_model).step(0)


def test_timeout_truncates_and_is_not_a_success(tiny_model):
    # max_steps = 2: running two tests without declaring exhausts the step cap.
    model = ScenarioConfig.model_validate(make_scenario(max_steps=2)).compile()
    cfg = RewardConfig(penalty_timeout=5.0)
    env = DiagnoseRLEnv(model, cfg)
    env.reset(options={"incident": _incident(model, 0, [0, 0])})
    env.step(0)
    _, r, term, trunc, info = env.step(1)
    assert trunc
    assert not term
    assert info["timeout"] is True
    assert info["correct"] is False
    assert info["declared_fault"] is None
    # last step reward = test penalty (t2 is the most expensive test: 0.5 + 0.5) + timeout
    assert r == pytest.approx(-(cfg.test_penalty(model, 1)) - 5.0)
    assert "true_fault" in info
    assert not env.action_masks().any()  # nothing legal after truncation


def test_declaring_on_the_last_step_is_not_a_timeout():
    model = ScenarioConfig.model_validate(make_scenario(max_steps=2)).compile()
    env = DiagnoseRLEnv(model)
    env.reset(options={"incident": _incident(model, 1, [1, 1])})
    env.step(0)
    _, _, term, trunc, info = env.step(model.n_tests + 1)
    assert term
    assert not trunc
    assert info["correct"] is True
    assert info["timeout"] is False


def test_cost_time_and_step_accounting(tiny_model):
    env = DiagnoseRLEnv(tiny_model)
    env.reset(options={"incident": _incident(tiny_model, 0, [0, 1])})
    env.step(0)
    _, _, _, _, info = env.step(1)
    assert info["cost"] == pytest.approx(4.0)
    assert info["elapsed"] == pytest.approx(8.0)
    assert info["tests_run"] == 2
    assert info["steps"] == 2


def test_posterior_in_observation_matches_bayes(standard_model):
    env = DiagnoseRLEnv(standard_model)
    obs, _ = env.reset(seed=3)
    for t in (0, 2, 7):
        obs, *_ = env.step(t)
    state = env.public_state()
    evidence = {int(t): int(state.outcomes[t]) for t in np.flatnonzero(state.executed)}
    expected = bayes.posterior_from_evidence(standard_model, evidence)
    np.testing.assert_allclose(obs[-standard_model.n_faults :], expected, atol=1e-6)
    np.testing.assert_allclose(state.belief, expected)


def test_reproducibility_with_seed(standard_model):
    def run(seed: int) -> list[float]:
        env = DiagnoseRLEnv(standard_model)
        env.reset(seed=seed)
        trace = [env.hidden_fault]
        rng = np.random.default_rng(0)
        done = False
        while not done:
            legal = np.flatnonzero(env.action_masks())
            _, r, term, trunc, _ = env.step(int(rng.choice(legal)))
            trace.append(r)
            done = term or trunc
        return trace

    assert run(11) == run(11)
    assert run(11) != run(12)


def test_incident_replay_is_policy_independent(standard_model):
    """Two policies running the same test on the same incident see the same outcome."""
    inc = generate_incidents(standard_model, 1, seed=5)[0]
    seen = []
    for order in ([0, 1, 2], [2, 1, 0]):
        env = DiagnoseRLEnv(standard_model)
        env.reset(options={"incident": inc})
        for t in order:
            env.step(t)
        state = env.public_state()
        seen.append({t: int(state.outcomes[t]) for t in order})
    assert seen[0] == seen[1]


def test_no_hidden_fault_leakage_in_observation(standard_model):
    """Observations depend on the incident only through revealed test outcomes."""
    outcomes = [0] * standard_model.n_tests
    obs_by_fault = []
    for fault in (0, 5):
        env = DiagnoseRLEnv(standard_model)
        env.reset(options={"incident": _incident(standard_model, fault, outcomes)})
        for t in (0, 3):
            obs, *_ = env.step(t)
        obs_by_fault.append(obs)
    np.testing.assert_array_equal(obs_by_fault[0], obs_by_fault[1])


def test_true_fault_not_in_info_until_episode_ends(standard_model):
    env = DiagnoseRLEnv(standard_model)
    _, info = env.reset(seed=0)
    assert "true_fault" not in info
    _, _, _, _, info = env.step(0)
    assert "true_fault" not in info
    _, _, _, _, info = env.step(standard_model.n_tests)
    assert info["true_fault"] == env.hidden_fault


def test_public_state_exposes_no_fault(standard_model):
    env = DiagnoseRLEnv(standard_model)
    env.reset(seed=0)
    state = env.public_state()
    assert not hasattr(state, "fault")
    assert not hasattr(state, "hidden_fault")


def test_sampling_prior_shift_changes_fault_frequencies(tiny_model):
    env = DiagnoseRLEnv(tiny_model, sampling_prior=np.array([0.95, 0.05]))
    faults = []
    for seed in range(300):
        env.reset(seed=seed)
        faults.append(env.hidden_fault)
    assert np.mean(np.array(faults) == 0) > 0.85
    # the agent's belief still starts from the model prior
    np.testing.assert_allclose(env.public_state().belief, tiny_model.prior)
