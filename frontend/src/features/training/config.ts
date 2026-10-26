// Client-side validation of a training request. Mirrors the server's TrainConfig constraints so the
// user sees problems before submitting; the server remains the authority and re-validates.

import { z } from "zod";

export const MAX_TIMESTEPS = 5_000_000;
const MAX_ENVS = 16;
/** Server requires the training seed to differ from the fixed validation / test seeds. */
const RESERVED_SEEDS = [10_001, 20_002];

export interface TrainingFormValues {
  name: string;
  scenario: string;
  algorithm: string;
  learning_rate: string;
  total_timesteps: string;
  gamma: string;
  seed: string;
  batch_size: string;
  n_envs: string;
  n_steps: string;
  ent_coef: string;
  reward_correct: string;
  penalty_wrong: string;
  penalty_timeout: string;
  lambda_cost: string;
  lambda_time: string;
}

export const DEFAULT_FORM: TrainingFormValues = {
  name: "experiment",
  scenario: "small",
  algorithm: "MaskablePPO",
  learning_rate: "0.0005",
  total_timesteps: "50000",
  gamma: "1.0",
  seed: "0",
  batch_size: "256",
  n_envs: "8",
  n_steps: "128",
  ent_coef: "0.05",
  reward_correct: "10",
  penalty_wrong: "10",
  penalty_timeout: "10",
  lambda_cost: "0.5",
  lambda_time: "0.5",
};

const num = (min: number, max: number, opts: { int?: boolean; minExclusive?: boolean } = {}) =>
  z
    .string()
    .trim()
    .min(1, "Required")
    .transform((s) => Number(s))
    .pipe(
      z
        .number({ invalid_type_error: "Must be a number" })
        .refine((n) => Number.isFinite(n), "Must be a number")
        .refine((n) => !opts.int || Number.isInteger(n), "Must be a whole number")
        .refine((n) => (opts.minExclusive ? n > min : n >= min), opts.minExclusive ? `Must be greater than ${min}` : `Must be at least ${min}`)
        .refine((n) => n <= max, `Must be at most ${max}`),
    );

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(100, "At most 100 characters"),
  scenario: z.string().min(1, "Choose a scenario"),
  algorithm: z.literal("MaskablePPO"),
  learning_rate: num(0, 1, { minExclusive: true }),
  total_timesteps: num(1024, MAX_TIMESTEPS, { int: true }),
  gamma: num(0, 1, { minExclusive: true }),
  seed: num(0, 2_147_483_647, { int: true }),
  batch_size: num(1, 1_000_000, { int: true }),
  n_envs: num(1, MAX_ENVS, { int: true }),
  n_steps: num(1, 100_000, { int: true }),
  ent_coef: num(0, 1),
  reward_correct: num(0, 1000),
  penalty_wrong: num(0, 1000),
  penalty_timeout: num(0, 1000),
  lambda_cost: num(0, 100),
  lambda_time: num(0, 100),
});

interface ValidationResult {
  errors: Partial<Record<keyof TrainingFormValues, string>>;
  request?: { name: string; config: Record<string, unknown> };
}

export function validateTraining(values: TrainingFormValues): ValidationResult {
  const parsed = schema.safeParse(values);
  const errors: ValidationResult["errors"] = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof TrainingFormValues;
      errors[key] ??= issue.message;
    }
    return { errors };
  }
  const v = parsed.data;
  if (RESERVED_SEEDS.includes(v.seed)) {
    errors.seed = `Seed ${v.seed} is reserved for validation/test incidents`;
  }
  if ((v.n_envs * v.n_steps) % v.batch_size !== 0) {
    errors.batch_size = `Must divide n_envs × n_steps (${v.n_envs * v.n_steps})`;
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    request: {
      name: v.name,
      config: {
        scenario: v.scenario,
        learning_rate: v.learning_rate,
        total_timesteps: v.total_timesteps,
        gamma: v.gamma,
        seed: v.seed,
        batch_size: v.batch_size,
        n_envs: v.n_envs,
        n_steps: v.n_steps,
        ent_coef: v.ent_coef,
        reward: {
          reward_correct: v.reward_correct,
          penalty_wrong: v.penalty_wrong,
          penalty_timeout: v.penalty_timeout,
          lambda_cost: v.lambda_cost,
          lambda_time: v.lambda_time,
        },
      },
    },
  };
}
