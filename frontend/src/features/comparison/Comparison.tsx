"use client";

import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Scale, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { policyLabel } from "@/components/charts/theme";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { api, type Evaluation, type EvaluationResults } from "@/lib/api";
import { dateTime, num, signed } from "@/lib/format";
import { keys, useEvaluations, useExperiments } from "@/lib/queries";
import {
  AccuracyCostChart,
  AlgorithmComparisonTable,
  ConfusionPanel,
  DurationChart,
  EvaluationBadges,
  RewardChart,
  RobustnessPanel,
  StatisticsPanel,
} from "./ComparisonPanels";
import { equivalence, policyRows } from "./lib";

interface Entry {
  evaluation: Evaluation;
  results: EvaluationResults;
}

function RunEvaluationForm() {
  const qc = useQueryClient();
  const experiments = useExperiments();
  const finished = (experiments.data?.items ?? []).filter((e) => e.status === "succeeded");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState("");
  const [nTest, setNTest] = useState("1000");
  const [checkpoint, setCheckpoint] = useState<"best" | "final">("best");
  const [robust, setRobust] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: () => {
      const run_names = [...picked, ...extra.split(",").map((s) => s.trim()).filter(Boolean)];
      const n = Number(nTest);
      if (run_names.length === 0) throw new Error("Choose at least one training run.");
      if (!Number.isInteger(n) || n < 50 || n > 20_000) throw new Error("Test episodes must be between 50 and 20,000.");
      setError(null);
      return api.startEvaluation({ run_names, model: checkpoint, n_test: n, skip_robustness: !robust });
    },
    onSuccess: () => {
      toast.success("Evaluation queued", { description: "It appears below when the worker has finished it." });
      void qc.invalidateQueries({ queryKey: keys.evaluations });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Failed"),
    meta: { silent: true },
  });

  return (
    <Card>
      <CardHeader
        title="Run an evaluation"
        description="Scores the selected runs and every baseline on the same held-out incidents. Training and baseline tuning never see them."
        icon={<FlaskConical />}
      />
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start.mutate();
          }}
        >
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-muted">Training runs (seeds are averaged)</legend>
            {finished.length === 0 ? (
              <p className="text-xs text-muted">No completed runs from the worker yet. You can also type run names trained on the command line.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {finished.map((e) => (
                  <label key={e.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-elevated">
                    <input
                      type="checkbox"
                      checked={picked.has(e.run_name)}
                      onChange={() =>
                        setPicked((s) => {
                          const n = new Set(s);
                          if (n.has(e.run_name)) n.delete(e.run_name);
                          else n.add(e.run_name);
                          return n;
                        })
                      }
                      className="accent-[var(--primary)]"
                    />
                    {e.run_name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <Field label="Other run names (comma separated)" className="sm:col-span-2">
              <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="full_seed0, full_seed1" aria-label="Other run names" />
            </Field>
            <Field label="Test episodes">
              <Input inputMode="numeric" value={nTest} onChange={(e) => setNTest(e.target.value)} aria-label="Test episodes" />
            </Field>
            <Field label="Checkpoint">
              <Select value={checkpoint} onChange={(e) => setCheckpoint(e.target.value as "best" | "final")} aria-label="Checkpoint">
                <option value="best">Best on validation</option>
                <option value="final">Final</option>
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={robust} onChange={(e) => setRobust(e.target.checked)} className="accent-[var(--primary)]" />
            Include sensitivity sweeps (noise, cost, penalty). Much slower.
          </label>
          {error && (
            <p role="alert" className="text-xs text-critical">
              {error}
            </p>
          )}
          <Button type="submit" loading={start.isPending}>
            Queue evaluation
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function Comparison() {
  const evaluations = useEvaluations();
  const succeeded = useMemo(
    () => (evaluations.data?.items ?? []).filter((e) => e.status === "succeeded").slice(0, 12),
    [evaluations.data],
  );
  const pending = (evaluations.data?.items ?? []).filter((e) => e.status === "queued" || e.status === "running");
  const failed = (evaluations.data?.items ?? []).filter((e) => e.status === "failed").slice(0, 3);

  const results = useQueries({
    queries: succeeded.map((e) => ({
      queryKey: keys.evaluationResults(e.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.evaluationResults(e.id, signal),
      staleTime: 5 * 60_000,
    })),
  });
  const loading = results.some((r) => r.isPending);
  const entries: Entry[] = succeeded.flatMap((evaluation, i) =>
    results[i]?.data ? [{ evaluation, results: results[i]!.data! }] : [],
  );

  // ---- filters (derived from the actual evaluations; nothing is assumed)
  const [f, setF] = useState({ scenario: "", seed: "", checkpoint: "", run: "", reward: "" });
  const rewardKey = (r: EvaluationResults) => (r.metadata ? JSON.stringify(Object.entries(r.metadata.reward).sort()) : "");
  const rewardLabel = (r: EvaluationResults) =>
    r.metadata ? Object.entries(r.metadata.reward).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ") : "";
  const options = useMemo(() => {
    const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
    return {
      scenarios: uniq(entries.map((e) => e.results.metadata?.scenario ?? "")),
      seeds: uniq(entries.map((e) => String(e.results.metadata?.test_seed ?? ""))),
      checkpoints: uniq(entries.map((e) => e.results.metadata?.checkpoint ?? "")),
      runs: uniq(entries.flatMap((e) => e.results.metadata?.runs ?? [])),
      rewards: uniq(entries.map((e) => rewardKey(e.results))),
    };
  }, [entries]);
  const filtered = entries.filter(({ results: r }) => {
    const m = r.metadata;
    return (
      (!f.scenario || m?.scenario === f.scenario) &&
      (!f.seed || String(m?.test_seed) === f.seed) &&
      (!f.checkpoint || m?.checkpoint === f.checkpoint) &&
      (!f.run || m?.runs.includes(f.run)) &&
      (!f.reward || rewardKey(r) === f.reward)
    );
  });

  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState("");
  const A = filtered.find((e) => e.evaluation.id === aId) ?? filtered[0];
  const B = bId ? entries.find((e) => e.evaluation.id === bId) : undefined;
  const faultIds = A ? Object.keys(A.results.baselines[Object.keys(A.results.baselines)[0] ?? ""]?.summary.per_fault ?? {}) : [];
  const eq = A && B ? equivalence(A.results, B.results) : null;

  const entryLabel = (e: Entry) =>
    `${dateTime(e.evaluation.finished_at)} · ${e.results.metadata?.runs.join(", ") ?? String((e.evaluation.params.run_names as string[] | undefined)?.join(", ") ?? e.evaluation.id.slice(0, 8))}`;

  return (
    <>
      <PageHeader
        title="Algorithm Comparison"
        description="Benchmark the trained policy against fixed-order, random, information-gain and cost-aware Bayesian strategies on held-out incidents. Only recorded evaluation results are shown."
      />

      <div className="space-y-4">
        {evaluations.isError && !evaluations.data && <ErrorState error={evaluations.error} onRetry={() => evaluations.refetch()} />}

        {pending.length > 0 && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/8 px-3 py-2 text-xs">
            <StatusBadge status="running" /> {pending.length} evaluation{pending.length > 1 ? "s" : ""} in progress — results appear automatically.
          </div>
        )}
        {failed.length > 0 && (
          <div role="alert" className="rounded-lg border border-critical/30 bg-critical/5 px-3 py-2 text-xs text-critical">
            <TriangleAlert className="mr-1.5 inline size-3.5" aria-hidden />
            {failed.length} recent evaluation{failed.length > 1 ? "s" : ""} failed: {failed[0]?.error?.split("\n").slice(-2).join(" ").slice(0, 160)}
          </div>
        )}

        {/* ---- selectors and filters ---- */}
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Scenario">
              <Select value={f.scenario} onChange={(e) => setF({ ...f, scenario: e.target.value })} aria-label="Scenario" className="w-36">
                <option value="">All</option>
                {options.scenarios.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Evaluation seed">
              <Select value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value })} aria-label="Evaluation seed" className="w-32">
                <option value="">All</option>
                {options.seeds.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Model checkpoint">
              <Select value={f.checkpoint} onChange={(e) => setF({ ...f, checkpoint: e.target.value })} aria-label="Model checkpoint" className="w-32">
                <option value="">All</option>
                {options.checkpoints.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label="Experiment run">
              <Select value={f.run} onChange={(e) => setF({ ...f, run: e.target.value })} aria-label="Experiment run" className="w-44">
                <option value="">All</option>
                {options.runs.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </Field>
            {options.rewards.length > 1 && (
              <Field label="Reward configuration">
                <Select value={f.reward} onChange={(e) => setF({ ...f, reward: e.target.value })} aria-label="Reward configuration" className="w-48">
                  <option value="">All</option>
                  {options.rewards.map((k) => {
                    const e = entries.find((x) => rewardKey(x.results) === k);
                    return <option key={k} value={k}>{e ? rewardLabel(e.results).slice(0, 36) : k}</option>;
                  })}
                </Select>
              </Field>
            )}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Evaluation">
              <Select value={A?.evaluation.id ?? ""} onChange={(e) => setAId(e.target.value)} aria-label="Evaluation" disabled={filtered.length === 0}>
                {filtered.length === 0 && <option value="">No evaluations</option>}
                {filtered.map((e) => (
                  <option key={e.evaluation.id} value={e.evaluation.id}>{entryLabel(e)}</option>
                ))}
              </Select>
            </Field>
            <Field label="Compare with (optional)">
              <Select value={bId} onChange={(e) => setBId(e.target.value)} aria-label="Compare with" disabled={entries.length < 2}>
                <option value="">None</option>
                {entries.filter((e) => e.evaluation.id !== A?.evaluation.id).map((e) => (
                  <option key={e.evaluation.id} value={e.evaluation.id}>{entryLabel(e)}</option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        {loading && succeeded.length > 0 && entries.length === 0 && <Skeleton className="h-96 w-full rounded-xl" />}

        {!loading && entries.length === 0 && !evaluations.isError && (
          <EmptyState title="No completed evaluations yet" icon={<Scale />}>
            Nothing is shown until real results exist. Train a model, then queue an evaluation below — or run{" "}
            <code className="rounded bg-elevated px-1">python -m diagnoserl.evaluation.run</code> and the worker will pick up registered runs.
          </EmptyState>
        )}

        {entries.length > 0 && filtered.length === 0 && (
          <EmptyState title="No evaluations match these filters">Clear a filter to see results.</EmptyState>
        )}

        {A && (
          <>
            <Card>
              <CardContent className="pt-5">
                <EvaluationBadges results={A.results} />
              </CardContent>
            </Card>

            {B && eq && (
              <Card className={eq.equivalent ? "border-success/40" : "border-warning/50"}>
                <CardHeader
                  title={eq.equivalent ? "Equivalent evaluation configurations" : "These evaluations are not directly comparable"}
                  description={
                    eq.equivalent
                      ? "Same scenario, evaluation seed, episode count and reward configuration."
                      : `They differ in: ${eq.differences.join("; ")}. Differences in the numbers below may reflect the configuration, not the policies.`
                  }
                />
                <CardContent>
                  <Table aria-label="Evaluation comparison" className="min-w-[28rem]">
                    <thead>
                      <tr>
                        <Th>Algorithm</Th>
                        <Th>Mean reward (A)</Th>
                        <Th>Mean reward (B)</Th>
                        <Th>B − A</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {policyRows(A.results, policyLabel).map((a) => {
                        const b = policyRows(B.results, policyLabel).find((x) => x.key === a.key);
                        return (
                          <Tr key={a.key}>
                            <Td className="font-medium">{a.label}</Td>
                            <Td>{num(a.mean_reward)}</Td>
                            <Td>{b ? num(b.mean_reward) : "—"}</Td>
                            <Td>
                              {b ? (
                                <Badge tone={b.mean_reward - a.mean_reward >= 0 ? "success" : "critical"}>{signed(b.mean_reward - a.mean_reward)}</Badge>
                              ) : "—"}
                            </Td>
                          </Tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader title="Performance comparison" description="Click a column header to sort." />
              <CardContent className="pt-2">
                <AlgorithmComparisonTable results={A.results} />
              </CardContent>
            </Card>

            <StatisticsPanel results={A.results} />

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <AccuracyCostChart results={A.results} />
              <RewardChart results={A.results} />
            </div>
            <DurationChart results={A.results} />
            <ConfusionPanel results={A.results} faultIds={faultIds} />
            <RobustnessPanel results={A.results} />
          </>
        )}

        <RunEvaluationForm />
        <p className="text-xs text-muted">
          Need a model first?{" "}
          <Link href="/training" className="text-primary hover:underline">
            Train one
          </Link>
          .
        </p>
      </div>
    </>
  );
}
