// Typed builders for backend payloads. They produce values that satisfy the same zod schemas the
// app validates real responses against, so a fixture that drifts from the backend fails loudly.
import type {
  Analytics,
  EvaluationResults,
  ExecutedTest,
  Experiment,
  ExperimentDetail,
  ModelVersion,
  PolicySummary,
  Recommendation,
  ScenarioDetail,
  Session,
  TestInfo,
} from "@/lib/api";

export const SID = "11111111-1111-1111-1111-111111111111";
export const FAULTS = [
  { id: "db_down", name: "Database unavailable" },
  { id: "cpu_high", name: "CPU saturation" },
  { id: "disk_full", name: "Disk full" },
];
const PRIOR = [0.5, 0.3, 0.2];

export function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: SID,
    scenario: "small",
    policy: "cost_aware_bayes",
    model_version_id: null,
    status: "active",
    steps: 0,
    max_steps: 6,
    cost: 0,
    elapsed: 0,
    total_reward: 0,
    fault_ids: FAULTS.map((f) => f.id),
    posterior: FAULTS.map((f, i) => ({ id: f.id, name: f.name, probability: PRIOR[i] ?? 0 })),
    entropy_bits: 1.485,
    confidence: 0.5,
    executed: [],
    available_tests: ["db_probe", "cpu_check"],
    created_at: "2026-10-22T08:00:00Z",
    completed_at: null,
    ...over,
  };
}

export function makeExecuted(over: Partial<ExecutedTest> = {}): ExecutedTest {
  return {
    step: 1,
    test_id: "db_probe",
    test_name: "Database probe",
    outcome: "FAIL",
    cost: 1,
    duration: 5,
    posterior_before: PRIOR,
    posterior_after: [0.9, 0.06, 0.04],
    recommendation: null,
    followed_recommendation: true,
    executed_at: "2026-10-22T08:00:05Z",
    ...over,
  };
}

/** A session after one test that made the first fault dominant. */
export function afterOneTest(over: Partial<Session> = {}): Session {
  return makeSession({
    steps: 1,
    cost: 1,
    elapsed: 5,
    executed: [makeExecuted()],
    available_tests: ["cpu_check"],
    posterior: FAULTS.map((f, i) => ({ id: f.id, name: f.name, probability: [0.9, 0.06, 0.04][i] ?? 0 })),
    confidence: 0.9,
    entropy_bits: 0.55,
    ...over,
  });
}

export const TESTS: TestInfo[] = [
  { id: "db_probe", name: "Database probe", category: "database", cost: 1, duration: 5, outcomes: ["PASS", "FAIL"], requires: [], executed: false, available: true },
  { id: "cpu_check", name: "CPU check", category: "host", cost: 1, duration: 3, outcomes: ["PASS", "FAIL"], requires: [], executed: false, available: true },
];

export const REC_TEST: Recommendation = {
  policy: "cost_aware_bayes",
  action: { type: "test", id: "db_probe", name: "Database probe", estimated_cost: 1, estimated_duration: 5 },
  confidence: 0.5,
  explanation: { method: "expected_utility_lookahead_depth_2", utility_declare_now: -0.5, utility_best_test: 0.7, value_of_testing: 1.2 },
};

export const REC_DECLARE: Recommendation = {
  policy: "cost_aware_bayes",
  action: { type: "declare", id: "db_down", name: "Database unavailable", estimated_cost: 0, estimated_duration: 0 },
  confidence: 0.9,
  explanation: { method: "expected_utility_lookahead_depth_2", utility_declare_now: 7.9, value_of_testing: -0.4 },
};

export const REC_PPO: Recommendation = {
  policy: "ppo",
  action: { type: "test", id: "db_probe", name: "Database probe", estimated_cost: 1, estimated_duration: 5 },
  confidence: 0.5,
  explanation: {
    method: "policy_network_action_distribution",
    top_actions: [
      { action: "db_probe", probability: 0.62 },
      { action: "declare:db_down", probability: 0.2 },
    ],
    note: "Action preferences of the policy network at this state. They are not calibrated probabilities that the corresponding diagnosis is correct, and they are not a causal explanation of the choice.",
  },
};

export function makeScenarioDetail(): ScenarioDetail {
  return {
    name: "small",
    description: "Three faults",
    n_faults: 3,
    n_tests: 2,
    max_steps: 6,
    outcomes: ["PASS", "FAIL"],
    faults: [
      { id: "db_down", name: "Database unavailable", description: "The DB stops accepting connections.", category: "database", prior: 0.5 },
      { id: "cpu_high", name: "CPU saturation", description: "CPU is maxed out.", category: "host", prior: 0.3 },
      { id: "disk_full", name: "Disk full", description: "Writes fail.", category: "host", prior: 0.2 },
    ],
    tests: [
      { id: "db_probe", name: "Database probe", description: "", category: "database", cost: 1, duration: 5, outcomes: ["PASS", "FAIL"], requires: [], likelihood: [[0.05, 0.95], [0.8, 0.2], [0.85, 0.15]] },
      { id: "cpu_check", name: "CPU check", description: "", category: "host", cost: 1, duration: 3, outcomes: ["PASS", "FAIL"], requires: [], likelihood: [[0.85, 0.15], [0.1, 0.9], [0.85, 0.15]] },
    ],
  };
}

export function makeAnalytics(over: Partial<Analytics> = {}): Analytics {
  const day = (date: string, acc: number, sessions: number, cost: number) => ({
    date, sessions, correct: Math.round(acc * sessions), accuracy: acc, mean_tests: 5, mean_duration: 20, mean_cost: cost, mean_reward: 2,
  });
  return {
    filters: { scenario: null, policy: null, since: null, until: null },
    total_investigations: 13,
    active: 1,
    finished: 12,
    declared: 12,
    truncated: 0,
    correct: 9,
    accuracy: 0.75,
    mean_tests: 5.2,
    mean_duration: 21,
    mean_cost: 6.4,
    mean_reward: 3.1,
    timeseries: [day("2026-10-20", 0.6, 4, 7), day("2026-10-21", 0.75, 4, 6.5), day("2026-10-22", 0.9, 4, 6)],
    by_policy: [
      { policy: "cost_aware_bayes", sessions: 6, correct: 5, accuracy: 0.83, mean_tests: 5, mean_duration: 20, mean_cost: 6.2, mean_reward: 4 },
      { policy: "random", sessions: 6, correct: 4, accuracy: 0.66, mean_tests: 4, mean_duration: 25, mean_cost: 7.5, mean_reward: 0.5 },
    ],
    fault_frequency: [
      { fault: "db_unavailable", count: 5, identified: 4, identification_rate: 0.8 },
      { fault: "memory_leak", count: 3, identified: 2, identification_rate: 0.67 },
    ],
    recent: [
      { id: SID, scenario: "standard", policy: "cost_aware_bayes", status: "declared", steps: 4, tests: 3, cost: 5, created_at: "2026-10-22T08:00:00Z", declared_fault: "db_unavailable", true_fault: "db_unavailable", correct: true },
      { id: "22222222-2222-2222-2222-222222222222", scenario: "standard", policy: "random", status: "declared", steps: 5, tests: 4, cost: 8, created_at: "2026-10-22T07:00:00Z", declared_fault: "disk_full", true_fault: "memory_leak", correct: false },
    ],
    truncated_to_most_recent: false,
    options: { scenarios: ["small", "standard"], policies: ["cost_aware_bayes", "random"] },
    ...over,
  };
}

export function makeModel(over: Partial<ModelVersion> = {}): ModelVersion {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    name: "full_seed0:best",
    scenario: "standard",
    experiment_id: null,
    sha256: "a".repeat(64),
    include_posterior: true,
    seed: 0,
    metrics: { checkpoint: "best", validation: { mean_reward: 2.64, accuracy: 0.67 } },
    is_active: false,
    created_at: "2026-10-22T08:00:00Z",
    ...over,
  };
}

export function makeExperiment(over: Partial<Experiment> = {}): Experiment {
  return {
    id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
    name: "demo",
    status: "succeeded",
    run_name: "demo-1a2b3c4d",
    seed: 3,
    total_timesteps: 40960,
    progress_timesteps: 40960,
    error: null,
    created_at: "2026-10-22T08:00:00Z",
    started_at: "2026-10-22T08:00:05Z",
    finished_at: "2026-10-22T08:03:05Z",
    config: { scenario: "small", total_timesteps: 40960, learning_rate: 0.0005 },
    ...over,
  };
}

export function makeExperimentDetail(over: Partial<ExperimentDetail> = {}): ExperimentDetail {
  return {
    ...makeExperiment(),
    validation_curve: [
      { timesteps: 0, mean_reward: -6, accuracy: 0.2, mean_tests: 1, mean_cost: 1 },
      { timesteps: 20000, mean_reward: 3, accuracy: 0.7, mean_tests: 3, mean_cost: 3 },
      { timesteps: 40000, mean_reward: 6, accuracy: 0.85, mean_tests: 2.8, mean_cost: 2.8 },
    ],
    training_curve: [
      { timesteps: 10000, wall_seconds: 20, ep_rew_mean: -1, ep_len_mean: 2, policy_loss: -0.02, value_loss: 0.8, entropy_loss: -1.9 },
      { timesteps: 30000, wall_seconds: 60, ep_rew_mean: 4, ep_len_mean: 3, policy_loss: -0.01, value_loss: 0.4, entropy_loss: -1.1 },
    ],
    elapsed_seconds: 180,
    artifacts: ["config.json", "metrics.jsonl", "train_metrics.jsonl", "train.log"],
    ...over,
  };
}

function summary(acc: number, reward: number, cm: number[][]): PolicySummary {
  return {
    n_episodes: 100,
    accuracy: acc,
    incorrect_rate: 1 - acc,
    no_diagnosis_rate: 0,
    mean_tests: 5,
    mean_cost: 6,
    mean_duration: 20,
    median_duration: 19,
    p90_duration: 30,
    p95_duration: 35,
    mean_reward: reward,
    std_reward: 5,
    per_fault: { db_down: { precision: 0.9, recall: 0.8 }, cpu_high: { precision: null, recall: 0.5 }, disk_full: { precision: 0.6, recall: 0.7 } },
    confusion_matrix: cm,
  };
}

const CM = [
  [8, 1, 1, 0],
  [2, 7, 1, 0],
  [0, 1, 8, 1],
];

export function makeResults(over: Partial<EvaluationResults> = {}): EvaluationResults {
  return {
    n_test_episodes: 400,
    n_val_episodes: 300,
    tuned_on_validation: { fixed_order: 8 },
    baselines: {
      fixed_order: { summary: summary(0.58, -0.4, CM), reward_ci: [-0.9, 0.1] },
      random: { summary: summary(0.44, -2.7, CM), reward_ci: [-3, -2.4] },
      info_gain: { summary: summary(0.73, 3.4, CM), reward_ci: [3, 3.8] },
      cost_aware_bayes: { summary: summary(0.74, 3.5, CM), reward_ci: [3.1, 3.9] },
    },
    rl: {
      per_seed: { full_seed0: { accuracy: 0.69, mean_cost: 6.8, mean_tests: 5.7, mean_duration: 21, mean_reward: 2.5 } },
      per_seed_full: { full_seed0: summary(0.69, 2.5, CM) },
      aggregate: {
        accuracy: { mean: 0.687, std: 0.011 },
        mean_tests: { mean: 5.6, std: 0.3 },
        mean_cost: { mean: 6.8, std: 0.3 },
        mean_duration: { mean: 21, std: 1.7 },
        no_diagnosis_rate: { mean: 0.007, std: 0.01 },
        mean_reward: { mean: 2.54, std: 0.16 },
      },
      seed_averaged_reward_ci: [2.3, 2.8],
    },
    paired_rl_minus_baseline: {
      fixed_order: { mean_diff: 2.97, ci_low: 2.5, ci_high: 3.4, significant: true },
      random: { mean_diff: 5.27, ci_low: 4.9, ci_high: 5.6, significant: true },
      info_gain: { mean_diff: -0.85, ci_low: -1.1, ci_high: -0.6, significant: true },
      cost_aware_bayes: { mean_diff: -0.98, ci_low: -1.2, ci_high: -0.7, significant: true },
    },
    sweeps: [
      { family: "fixed_order", param: 2, accuracy: 0.27, mean_cost: 3, mean_tests: 2, mean_duration: 15, mean_reward: -5 },
      { family: "fixed_order", param: 4, accuracy: 0.4, mean_cost: 5, mean_tests: 4, mean_duration: 21, mean_reward: -3 },
      { family: "info_gain", param: 0.8, accuracy: 0.73, mean_cost: 7, mean_tests: 6, mean_duration: 22, mean_reward: 3.4 },
    ],
    metadata: {
      scenario: "standard",
      test_seed: 20002,
      val_seed: 10001,
      checkpoint: "best",
      runs: ["full_seed0"],
      include_posterior: true,
      reward: { reward_correct: 10, penalty_wrong: 10, penalty_timeout: 10, lambda_cost: 0.5, lambda_time: 0.5 },
    },
    distributions: {
      fixed_order: { duration: [30, 36, 40, 36, 33], tests: [8, 8, 8, 8, 8] },
      random: { duration: [10, 25, 45, 30, 20], tests: [3, 5, 7, 4, 5] },
      info_gain: { duration: [12, 20, 28, 22, 18], tests: [3, 5, 8, 6, 5] },
      cost_aware_bayes: { duration: [12, 22, 28, 24, 18], tests: [3, 6, 8, 6, 5] },
      ppo: { duration: [10, 18, 30, 22, 16], tests: [2, 5, 8, 6, 4] },
    },
    ...over,
  };
}
