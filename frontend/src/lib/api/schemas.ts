// Runtime schemas for API responses (mirrors src/diagnoserl/api/schemas.py).
// Types are inferred from these, so the validated shape and the TypeScript type cannot drift.

import { z } from "zod";

const nullableNumber = z.number().nullable();

// ------------------------------------------------------------------ diagnostics
export const faultProbability = z.object({ id: z.string(), name: z.string(), probability: z.number() });

export const recommendedAction = z.object({
  type: z.enum(["test", "declare"]),
  id: z.string(),
  name: z.string(),
  estimated_cost: z.number(),
  estimated_duration: z.number(),
});

export const recommendation = z.object({
  policy: z.string(),
  action: recommendedAction,
  confidence: z.number(),
  explanation: z.record(z.unknown()),
});

export const executedTest = z.object({
  step: z.number(),
  test_id: z.string(),
  test_name: z.string(),
  outcome: z.string(),
  cost: z.number(),
  duration: z.number(),
  posterior_before: z.array(z.number()),
  posterior_after: z.array(z.number()),
  recommendation: recommendation.nullable(),
  followed_recommendation: z.boolean().nullable(),
  executed_at: z.string().nullable().optional(),
});

export const session = z.object({
  id: z.string(),
  scenario: z.string(),
  policy: z.string(),
  model_version_id: z.string().nullable(),
  status: z.enum(["active", "declared", "truncated"]),
  steps: z.number(),
  max_steps: z.number(),
  cost: z.number(),
  elapsed: z.number(),
  total_reward: z.number(),
  fault_ids: z.array(z.string()),
  posterior: z.array(faultProbability),
  entropy_bits: z.number(),
  confidence: z.number(),
  executed: z.array(executedTest),
  available_tests: z.array(z.string()),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});

export const testInfo = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  cost: z.number(),
  duration: z.number(),
  outcomes: z.array(z.string()),
  requires: z.array(z.string()),
  executed: z.boolean(),
  available: z.boolean(),
});

export const executeTestResponse = z.object({
  result: executedTest,
  replayed: z.boolean(),
  session,
});

export const declareResponse = z.object({
  declaration: z.object({ fault_id: z.string(), correct: z.boolean(), reward: z.number() }),
  true_fault: z.string(),
  session,
});

export const report = z.object({
  session,
  initial_prior: z.array(faultProbability),
  true_fault: z.string(),
  true_fault_name: z.string(),
  declared_fault: z.string().nullable(),
  correct: z.boolean(),
  timeout: z.boolean(),
  posterior_trace: z.array(
    z.object({ step: z.number(), posterior: z.array(z.number()), entropy_bits: z.number() }),
  ),
});

export const sessionSummary = z.object({
  id: z.string(),
  scenario: z.string(),
  policy: z.string(),
  status: z.enum(["active", "declared", "truncated"]),
  steps: z.number(),
  cost: z.number(),
  elapsed: z.number(),
  total_reward: z.number(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  declared_fault: z.string().nullable(),
  true_fault: z.string().nullable(),
  correct: z.boolean().nullable(),
});

export function page<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), total: z.number(), limit: z.number(), offset: z.number() });
}

export const policies = z.object({
  policies: z.array(z.string()),
  ppo_available_for_scenarios: z.array(z.string()),
});

// -------------------------------------------------------------------- scenarios
export const scenarioSummary = z.object({
  name: z.string(),
  description: z.string(),
  n_faults: z.number(),
  n_tests: z.number(),
  max_steps: z.number(),
});

export const scenarioDetail = scenarioSummary.extend({
  outcomes: z.array(z.string()),
  faults: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      category: z.string(),
      prior: z.number(),
    }),
  ),
  tests: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      category: z.string(),
      cost: z.number(),
      duration: z.number(),
      outcomes: z.array(z.string()),
      requires: z.array(z.string()),
      likelihood: z.array(z.array(z.number())), // [fault][outcome]
    }),
  ),
});

// -------------------------------------------------------------------- analytics
const groupStats = z.object({
  sessions: z.number(),
  correct: z.number(),
  accuracy: nullableNumber,
  mean_tests: nullableNumber,
  mean_duration: nullableNumber,
  mean_cost: nullableNumber,
  mean_reward: nullableNumber,
});

export const analytics = z.object({
  filters: z.object({
    scenario: z.string().nullable(),
    policy: z.string().nullable(),
    since: z.string().nullable(),
    until: z.string().nullable(),
  }),
  total_investigations: z.number(),
  active: z.number(),
  finished: z.number(),
  declared: z.number(),
  truncated: z.number(),
  correct: z.number(),
  accuracy: nullableNumber,
  mean_tests: nullableNumber,
  mean_duration: nullableNumber,
  mean_cost: nullableNumber,
  mean_reward: nullableNumber,
  timeseries: z.array(groupStats.omit({ sessions: true }).extend({ date: z.string(), sessions: z.number() })),
  by_policy: z.array(groupStats.extend({ policy: z.string() })),
  fault_frequency: z.array(
    z.object({
      fault: z.string(),
      count: z.number(),
      identified: z.number(),
      identification_rate: z.number(),
    }),
  ),
  recent: z.array(
    z.object({
      id: z.string(),
      scenario: z.string(),
      policy: z.string(),
      status: z.string(),
      steps: z.number(),
      tests: z.number(),
      cost: z.number(),
      created_at: z.string(),
      declared_fault: z.string().nullable(),
      true_fault: z.string().nullable(),
      correct: z.boolean().nullable(),
    }),
  ),
  truncated_to_most_recent: z.boolean(),
  options: z.object({ scenarios: z.array(z.string()), policies: z.array(z.string()) }),
});

export const overview = z.object({
  active_models: z.array(z.object({ id: z.string(), name: z.string(), scenario: z.string() })),
  strategy_comparison: z.array(z.record(z.union([z.number(), z.string()]))),
  latest_evaluation_id: z.string().nullable(),
});

// ------------------------------------------------------------- models / jobs
export const modelVersion = z.object({
  id: z.string(),
  name: z.string(),
  scenario: z.string(),
  experiment_id: z.string().nullable(),
  sha256: z.string(),
  include_posterior: z.boolean(),
  seed: z.number(),
  metrics: z.object({
    checkpoint: z.string().optional(),
    validation: z.record(z.number()).optional(),
  }),
  is_active: z.boolean(),
  created_at: z.string(),
});

export const experiment = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  run_name: z.string(),
  seed: z.number(),
  total_timesteps: z.number(),
  progress_timesteps: z.number(),
  error: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  config: z.record(z.unknown()),
});

export const validationPoint = z.object({
  timesteps: z.number(),
  mean_reward: z.number(),
  accuracy: z.number(),
  mean_tests: z.number(),
  mean_cost: z.number(),
});

export const trainingPoint = z.object({
  timesteps: z.number(),
  wall_seconds: z.number(),
  ep_rew_mean: z.number().optional(),
  ep_len_mean: z.number().optional(),
  policy_loss: z.number().optional(),
  value_loss: z.number().optional(),
  entropy_loss: z.number().optional(),
  approx_kl: z.number().optional(),
  explained_variance: z.number().optional(),
});

export const experimentDetail = experiment.extend({
  validation_curve: z.array(validationPoint.passthrough()),
  training_curve: z.array(trainingPoint).default([]),
  elapsed_seconds: z.number().nullable().default(null),
  artifacts: z.array(z.string()),
});

export const experimentLogs = z.object({ lines: z.array(z.string()), available: z.boolean() });

export const evaluation = z.object({
  id: z.string(),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  params: z.record(z.unknown()),
  error: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});

export const policySummary = z.object({
  n_episodes: z.number().optional(),
  accuracy: z.number(),
  incorrect_rate: z.number().optional(),
  no_diagnosis_rate: z.number(),
  mean_tests: z.number(),
  mean_cost: z.number(),
  mean_duration: z.number(),
  median_duration: z.number().optional(),
  p90_duration: z.number().optional(),
  p95_duration: z.number().optional(),
  mean_reward: z.number(),
  std_reward: z.number().optional(),
  per_fault: z.record(z.object({ precision: nullableNumber, recall: nullableNumber })),
  confusion_matrix: z.array(z.array(z.number())),
});

export const evaluationResults = z.object({
  n_test_episodes: z.number(),
  n_val_episodes: z.number(),
  reward_config: z.record(z.number()).optional(),
  tuned_on_validation: z.record(z.union([z.number(), z.string()])),
  baselines: z.record(z.object({ summary: policySummary, reward_ci: z.tuple([z.number(), z.number()]) })),
  rl: z
    .object({
      per_seed: z.record(z.record(z.number())),
      per_seed_full: z.record(policySummary),
      aggregate: z.record(z.object({ mean: z.number(), std: z.number() })),
      seed_averaged_reward_ci: z.tuple([z.number(), z.number()]),
    })
    .optional(),
  paired_rl_minus_baseline: z
    .record(
      z.object({
        mean_diff: z.number(),
        ci_low: z.number(),
        ci_high: z.number(),
        significant: z.boolean(),
      }),
    )
    .optional(),
  sweeps: z.array(
    z.object({
      family: z.string(),
      param: z.number(),
      accuracy: z.number(),
      mean_cost: z.number(),
      mean_tests: z.number(),
      mean_duration: z.number(),
      mean_reward: z.number(),
    }),
  ),
  reference: z.object({ exact: z.object({ optimal_value: z.number(), summary: policySummary }).optional() }).optional(),
  robustness: z.record(z.array(z.record(z.unknown()))).optional(),
  distributions: z.record(z.object({ duration: z.array(z.number()), tests: z.array(z.number()) })).optional(),
  metadata: z
    .object({
      scenario: z.string(),
      test_seed: z.number(),
      val_seed: z.number(),
      checkpoint: z.string(),
      runs: z.array(z.string()),
      include_posterior: z.boolean(),
      reward: z.record(z.number()),
    })
    .optional(),
});

export const health = z.object({
  status: z.string(),
  checks: z.record(z.string()).optional(),
});

// ------------------------------------------------------------------ inferred types
export type FaultProbability = z.infer<typeof faultProbability>;
export type Recommendation = z.infer<typeof recommendation>;
export type ExecutedTest = z.infer<typeof executedTest>;
export type Session = z.infer<typeof session>;
export type TestInfo = z.infer<typeof testInfo>;
export type ExecuteTestResponse = z.infer<typeof executeTestResponse>;
export type DeclareResponse = z.infer<typeof declareResponse>;
export type Report = z.infer<typeof report>;
export type SessionSummary = z.infer<typeof sessionSummary>;
export type Policies = z.infer<typeof policies>;
export type ScenarioSummary = z.infer<typeof scenarioSummary>;
export type ScenarioDetail = z.infer<typeof scenarioDetail>;
export type Analytics = z.infer<typeof analytics>;
export type Overview = z.infer<typeof overview>;
export type ModelVersion = z.infer<typeof modelVersion>;
export type Experiment = z.infer<typeof experiment>;
export type ExperimentDetail = z.infer<typeof experimentDetail>;
export type TrainingPoint = z.infer<typeof trainingPoint>;
export type ValidationPoint = z.infer<typeof validationPoint>;
export type Evaluation = z.infer<typeof evaluation>;
export type PolicySummary = z.infer<typeof policySummary>;
export type EvaluationResults = z.infer<typeof evaluationResults>;
export type Health = z.infer<typeof health>;
