"use client";

import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { policyLabel } from "@/components/charts/theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import type { Policies, ScenarioSummary } from "@/lib/api";
import { randomSeed, type StartConfig } from "./useInvestigation";

export const POLICY_HELP: Record<string, string> = {
  cost_aware_bayes: "Weighs the expected value of another test against declaring now, two steps ahead.",
  info_gain: "Runs the test expected to reduce uncertainty the most per unit cost.",
  fixed_order: "Follows a fixed runbook order, then declares the most likely fault.",
  random: "Picks random tests and stops at random. A floor for comparison.",
  ppo: "The trained reinforcement-learning policy (requires an active model).",
};

export function StartPanel({
  scenarios,
  policies,
  loading,
  onStart,
  initialScenario,
}: {
  scenarios: ScenarioSummary[] | undefined;
  policies: Policies | undefined;
  loading: boolean;
  onStart: (cfg: StartConfig) => void;
  initialScenario?: string;
}) {
  const [scenario, setScenario] = useState(initialScenario ?? "standard");
  const [policy, setPolicy] = useState("cost_aware_bayes");
  const [seed, setSeed] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Keep the selection valid when the scenario list loads or changes.
  useEffect(() => {
    const names = scenarios?.map((s) => s.name);
    if (names?.length && !names.includes(scenario)) setScenario(names[0] as string);
  }, [scenarios, scenario]);

  const ppoReady = policies?.ppo_available_for_scenarios.includes(scenario) ?? false;
  useEffect(() => {
    if (policy === "ppo" && !ppoReady) setPolicy("cost_aware_bayes");
  }, [policy, ppoReady]);

  const picked = scenarios?.find((s) => s.name === scenario);

  const submit = () => {
    const trimmed = seed.trim();
    const parsed = trimmed === "" ? randomSeed() : Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setError("Seed must be a non-negative whole number.");
      return;
    }
    setError(null);
    onStart({ scenario, policy, seed: parsed });
  };

  return (
    <Card>
      <CardHeader
        title="New investigation"
        description="Pick a simulated incident and the policy that will recommend each step."
      />
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field
            label="Scenario"
            hint={picked ? `${picked.n_faults} possible root causes · ${picked.n_tests} diagnostic tests · up to ${picked.max_steps} steps` : undefined}
          >
            <Select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Scenario">
              {(scenarios ?? [{ name: scenario } as ScenarioSummary]).map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Diagnostic policy" hint={POLICY_HELP[policy]}>
            <Select value={policy} onChange={(e) => setPolicy(e.target.value)} aria-label="Diagnostic policy">
              {(policies?.policies ?? ["cost_aware_bayes"]).map((p) => (
                <option key={p} value={p} disabled={p === "ppo" && !ppoReady}>
                  {policyLabel(p)}
                  {p === "ppo" && !ppoReady ? " (no active model)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Incident seed (optional)" hint="The same seed always produces the same incident." error={error}>
            <Input
              inputMode="numeric"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="random"
              aria-label="Incident seed (optional)"
              aria-invalid={error ? true : undefined}
            />
          </Field>
          <Button type="submit" className="w-full" loading={loading}>
            <Play /> Start investigation
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
