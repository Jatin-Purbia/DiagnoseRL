// Mirrors the FastAPI response models (src/diagnoserl/api/schemas.py).

export interface FaultProbability {
  id: string;
  name: string;
  probability: number;
}

export interface ExecutedTest {
  step: number;
  test_id: string;
  test_name: string;
  outcome: string;
  cost: number;
  duration: number;
  posterior_before: number[];
  posterior_after: number[];
  recommendation: Recommendation | null;
  followed_recommendation: boolean | null;
}

export interface Session {
  id: string;
  scenario: string;
  policy: string;
  model_version_id: string | null;
  status: "active" | "declared" | "truncated";
  steps: number;
  max_steps: number;
  cost: number;
  elapsed: number;
  total_reward: number;
  fault_ids: string[];
  posterior: FaultProbability[];
  entropy_bits: number;
  confidence: number;
  executed: ExecutedTest[];
  available_tests: string[];
  created_at: string;
  completed_at: string | null;
}

export interface TestInfo {
  id: string;
  name: string;
  category: string;
  cost: number;
  duration: number;
  outcomes: string[];
  requires: string[];
  executed: boolean;
  available: boolean;
}

export interface RecommendedAction {
  type: "test" | "declare";
  id: string;
  name: string;
  estimated_cost: number;
  estimated_duration: number;
}

export interface Recommendation {
  policy: string;
  action: RecommendedAction;
  confidence: number;
  explanation: Record<string, unknown>;
}

export interface ExecuteTestResponse {
  result: ExecutedTest;
  replayed: boolean;
  session: Session;
}

export interface DeclareResponse {
  declaration: { fault_id: string; correct: boolean; reward: number };
  true_fault: string;
  session: Session;
}

export interface Report {
  session: Session;
  initial_prior: FaultProbability[];
  true_fault: string;
  true_fault_name: string;
  declared_fault: string | null;
  correct: boolean;
  timeout: boolean;
  posterior_trace: { step: number; posterior: number[]; entropy_bits: number }[];
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface PoliciesResponse {
  policies: string[];
  ppo_available_for_scenarios: string[];
}

export interface ScenarioSummary {
  name: string;
  description: string;
  n_faults: number;
  n_tests: number;
  max_steps: number;
}

export interface ScenarioDetail extends ScenarioSummary {
  outcomes: string[];
  faults: { id: string; name: string; prior: number }[];
  tests: {
    id: string;
    name: string;
    description: string;
    category: string;
    cost: number;
    duration: number;
    outcomes: string[];
    requires: string[];
    likelihood: number[][]; // [fault][outcome]
  }[];
}

export interface ModelVersion {
  id: string;
  name: string;
  scenario: string;
  experiment_id: string | null;
  sha256: string;
  include_posterior: boolean;
  seed: number;
  metrics: { checkpoint?: string; validation?: Record<string, number> };
  is_active: boolean;
  created_at: string;
}

export interface Experiment {
  id: string;
  name: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  run_name: string;
  seed: number;
  total_timesteps: number;
  progress_timesteps: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  config: Record<string, unknown>;
}

export interface ExperimentDetail extends Experiment {
  validation_curve: ValidationPoint[];
  artifacts: string[];
}

export interface ValidationPoint {
  timesteps: number;
  mean_reward: number;
  accuracy: number;
  mean_tests: number;
  mean_cost: number;
}

export interface Evaluation {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  params: Record<string, unknown>;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface PolicySummary {
  accuracy: number;
  mean_tests: number;
  mean_cost: number;
  mean_duration: number;
  no_diagnosis_rate: number;
  mean_reward: number;
  per_fault: Record<string, { precision: number | null; recall: number | null }>;
  confusion_matrix: number[][];
}

export interface EvaluationResults {
  n_test_episodes: number;
  n_val_episodes: number;
  tuned_on_validation: Record<string, number>;
  baselines: Record<string, { summary: PolicySummary; reward_ci: [number, number] }>;
  rl?: {
    per_seed: Record<string, Record<string, number>>;
    per_seed_full: Record<string, PolicySummary>;
    aggregate: Record<string, { mean: number; std: number }>;
    seed_averaged_reward_ci: [number, number];
  };
  paired_rl_minus_baseline?: Record<
    string,
    { mean_diff: number; ci_low: number; ci_high: number; significant: boolean }
  >;
  sweeps: {
    family: string;
    param: number;
    accuracy: number;
    mean_cost: number;
    mean_tests: number;
    mean_duration: number;
    mean_reward: number;
  }[];
  reference?: { exact?: { optimal_value: number; summary: PolicySummary } };
  robustness?: Record<string, Record<string, unknown>[]>;
}

export interface Overview {
  total_sessions: number;
  finished_sessions: number;
  declared_sessions: number;
  success_rate: number | null;
  avg_tests: number | null;
  avg_duration: number | null;
  avg_cost: number | null;
  active_models: { id: string; name: string; scenario: string }[];
  recent_sessions: {
    id: string;
    scenario: string;
    policy: string;
    status: string;
    steps: number;
    created_at: string;
  }[];
  by_policy: {
    policy: string;
    sessions: number;
    accuracy: number | null;
    mean_reward: number | null;
    mean_cost: number | null;
  }[];
  strategy_comparison: Record<string, number | string>[];
  latest_evaluation_id: string | null;
}
