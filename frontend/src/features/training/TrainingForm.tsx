"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Rocket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Tip } from "@/components/ui/tooltip";
import { api, ApiError, type ScenarioSummary } from "@/lib/api";
import { keys } from "@/lib/queries";
import { DEFAULT_FORM, MAX_TIMESTEPS, validateTraining, type TrainingFormValues } from "./config";

/** Training configuration. Validated locally, re-validated by the server, queued for the worker. */
export function TrainingForm({
  scenarios,
  onStarted,
}: {
  scenarios: ScenarioSummary[] | undefined;
  onStarted: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [values, setValues] = useState<TrainingFormValues>(DEFAULT_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof TrainingFormValues, string>>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const set = (k: keyof TrainingFormValues) => (e: { target: { value: string } }) => {
    const next = { ...values, [k]: e.target.value };
    setValues(next);
    if (showErrors) setErrors(validateTraining(next).errors);
  };

  const start = useMutation({
    mutationFn: (req: { name: string; config: Record<string, unknown> }) => api.startTraining(req),
    onSuccess: (exp) => {
      void qc.invalidateQueries({ queryKey: keys.experiments });
      toast.success("Training queued", { description: `${exp.run_name} will start when the worker is free.` });
      onStarted(exp.id);
    },
  });

  const submit = () => {
    const result = validateTraining(values);
    setErrors(result.errors);
    setShowErrors(true);
    if (!result.request) {
      if (Object.keys(result.errors).some((k) => !["name", "scenario", "learning_rate", "total_timesteps", "seed"].includes(k))) setAdvanced(true);
      toast.error("Fix the highlighted fields", { id: "training-form" });
      return;
    }
    start.mutate(result.request);
  };

  const needsKey = start.error instanceof ApiError && (start.error.status === 401 || start.error.status === 503);

  return (
    <Card>
      <CardHeader
        title="Start a training run"
        description="Queued, then executed by the worker. Progress survives page refreshes."
        icon={<Rocket />}
      />
      <CardContent>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Run name" error={errors.name ?? null}>
              <Input value={values.name} onChange={set("name")} aria-label="Run name" aria-invalid={errors.name ? true : undefined} />
            </Field>
            <Field label="Scenario" error={errors.scenario ?? null}>
              <Select value={values.scenario} onChange={set("scenario")} aria-label="Scenario">
                {(scenarios ?? [{ name: values.scenario } as ScenarioSummary]).map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                    {s.n_faults ? ` (${s.n_faults} faults)` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Algorithm" hint="MaskablePPO is the only trainer implemented.">
              <Tip content="Proximal Policy Optimisation with action masking, so ineligible tests can never be chosen.">
                <Select value={values.algorithm} onChange={set("algorithm")} aria-label="Algorithm">
                  <option value="MaskablePPO">MaskablePPO</option>
                </Select>
              </Tip>
            </Field>
            <Field label="Total timesteps" error={errors.total_timesteps ?? null} hint={`1,024 – ${MAX_TIMESTEPS.toLocaleString()}`}>
              <Input inputMode="numeric" value={values.total_timesteps} onChange={set("total_timesteps")} aria-label="Total timesteps" aria-invalid={errors.total_timesteps ? true : undefined} />
            </Field>
            <Field label="Learning rate" error={errors.learning_rate ?? null}>
              <Input inputMode="decimal" value={values.learning_rate} onChange={set("learning_rate")} aria-label="Learning rate" aria-invalid={errors.learning_rate ? true : undefined} />
            </Field>
            <Field label="Random seed" error={errors.seed ?? null}>
              <Input inputMode="numeric" value={values.seed} onChange={set("seed")} aria-label="Random seed" aria-invalid={errors.seed ? true : undefined} />
            </Field>
          </div>

          <button
            type="button"
            onClick={() => setAdvanced((a) => !a)}
            aria-expanded={advanced}
            className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-ink"
          >
            <ChevronDown className={`size-4 transition-transform ${advanced ? "rotate-180" : ""}`} aria-hidden />
            Discount, batching and reward parameters
          </button>

          {advanced && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Discount factor (γ)" error={errors.gamma ?? null}>
                <Input inputMode="decimal" value={values.gamma} onChange={set("gamma")} aria-label="Discount factor" aria-invalid={errors.gamma ? true : undefined} />
              </Field>
              <Field label="Entropy coefficient" error={errors.ent_coef ?? null} hint="Higher values explore more.">
                <Input inputMode="decimal" value={values.ent_coef} onChange={set("ent_coef")} aria-label="Entropy coefficient" aria-invalid={errors.ent_coef ? true : undefined} />
              </Field>
              <Field label="Parallel environments" error={errors.n_envs ?? null}>
                <Input inputMode="numeric" value={values.n_envs} onChange={set("n_envs")} aria-label="Parallel environments" aria-invalid={errors.n_envs ? true : undefined} />
              </Field>
              <Field label="Rollout steps per env" error={errors.n_steps ?? null}>
                <Input inputMode="numeric" value={values.n_steps} onChange={set("n_steps")} aria-label="Rollout steps per environment" aria-invalid={errors.n_steps ? true : undefined} />
              </Field>
              <Field label="Batch size" error={errors.batch_size ?? null} hint="Must divide envs × steps.">
                <Input inputMode="numeric" value={values.batch_size} onChange={set("batch_size")} aria-label="Batch size" aria-invalid={errors.batch_size ? true : undefined} />
              </Field>
              <div className="hidden sm:block" />
              <Field label="Reward: correct" error={errors.reward_correct ?? null}>
                <Input inputMode="decimal" value={values.reward_correct} onChange={set("reward_correct")} aria-label="Reward for a correct diagnosis" />
              </Field>
              <Field label="Penalty: wrong" error={errors.penalty_wrong ?? null}>
                <Input inputMode="decimal" value={values.penalty_wrong} onChange={set("penalty_wrong")} aria-label="Penalty for a wrong diagnosis" />
              </Field>
              <Field label="Penalty: step limit" error={errors.penalty_timeout ?? null}>
                <Input inputMode="decimal" value={values.penalty_timeout} onChange={set("penalty_timeout")} aria-label="Penalty for hitting the step limit" />
              </Field>
              <Field label="Test cost weight (λ cost)" error={errors.lambda_cost ?? null}>
                <Input inputMode="decimal" value={values.lambda_cost} onChange={set("lambda_cost")} aria-label="Test cost weight" />
              </Field>
              <Field label="Test time weight (λ time)" error={errors.lambda_time ?? null}>
                <Input inputMode="decimal" value={values.lambda_time} onChange={set("lambda_time")} aria-label="Test time weight" />
              </Field>
            </div>
          )}

          {needsKey && (
            <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              Training needs the admin API key. Add it in Settings, then submit again.
            </p>
          )}
          <Button type="submit" loading={start.isPending} className="w-full sm:w-auto">
            <Rocket /> Queue training
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
