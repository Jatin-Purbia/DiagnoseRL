"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, Download, FileText, GitCompare, OctagonX, Package, WifiOff } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { toast } from "sonner";
import { LineSeriesChart } from "@/components/charts/LineSeriesChart";
import { Term } from "@/components/domain/Term";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tip } from "@/components/ui/tooltip";
import { api, type ExperimentDetail } from "@/lib/api";
import { compact, dateTime, num, pct, wallClock } from "@/lib/format";
import { keys, useExperiment, useModels } from "@/lib/queries";

function Stat({ label, value, hint }: { label: React.ReactNode; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1.5 text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

const NOT_RECORDED = "Not recorded for this run (it was trained before telemetry was added, or has not produced an update yet).";

function ChartCard({
  title,
  description,
  empty,
  children,
}: {
  title: string;
  description?: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardContent>
        {empty ? <p className="py-10 text-center text-xs text-muted">{NOT_RECORDED}</p> : children}
      </CardContent>
    </Card>
  );
}

export function TrainingMonitor({
  id,
  onCompare,
  onLogs,
}: {
  id: string;
  onCompare: () => void;
  onLogs: () => void;
}) {
  const qc = useQueryClient();
  const q = useExperiment(id);
  const models = useModels();
  const exp = q.data;

  const cancel = useMutation({
    mutationFn: () => api.cancelExperiment(id),
    onSuccess: () => {
      toast.success("Experiment cancelled");
      void qc.invalidateQueries({ queryKey: keys.experiment(id) });
      void qc.invalidateQueries({ queryKey: keys.experiments });
    },
  });

  const viewModel = useMemo(() => derive(exp), [exp]);

  if (q.isPending) {
    return (
      <div className="space-y-4">
        <SkeletonCard />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (q.isError && !exp) return <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load this experiment" />;
  if (!exp || !viewModel) return null;

  const registered = (models.data ?? []).filter((m) => m.experiment_id === exp.id);
  const live = exp.status === "running" || exp.status === "queued";
  const { train, val, last } = viewModel;
  const noTelemetry = train.length === 0;

  return (
    <div className="space-y-4">
      {q.isError && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <WifiOff className="size-4" aria-hidden /> Connection lost — showing the last known state and retrying. The training job keeps running on the server.
        </div>
      )}

      <Card>
        <CardHeader
          title={exp.run_name}
          description={`${String(exp.config.scenario ?? "")} · seed ${exp.seed} · started ${dateTime(exp.started_at ?? exp.created_at)}`}
          action={<StatusBadge status={exp.status} />}
        />
        <CardContent className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="text-muted">Training progress</span>
              <span className="tabular-nums">
                {exp.progress_timesteps.toLocaleString()} / {exp.total_timesteps.toLocaleString()} timesteps
              </span>
            </div>
            <Progress
              value={exp.progress_timesteps}
              max={exp.total_timesteps}
              label="Training progress"
              tone={exp.status === "failed" ? "critical" : exp.status === "succeeded" ? "success" : "primary"}
            />
          </div>
          {exp.error && (
            <pre className="max-h-44 overflow-auto rounded-lg border border-critical/30 bg-critical/5 p-3 text-xs text-critical">
              {exp.error}
            </pre>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {exp.status === "queued" && (
              <Button variant="outline" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                <Ban /> Cancel queued run
              </Button>
            )}
            <Tip
              content={
                exp.status === "running"
                  ? "Stopping a running job is not supported yet: the worker runs it to completion. Only queued runs can be cancelled."
                  : "Only a running job could be stopped, and that is not supported yet."
              }
            >
              <span>
                <Button variant="outline" size="sm" disabled>
                  <OctagonX /> Stop training
                </Button>
              </span>
            </Tip>
            <Button variant="outline" size="sm" onClick={onLogs}>
              <FileText /> View logs
            </Button>
            <Button variant="outline" size="sm" onClick={onCompare}>
              <GitCompare /> Compare runs
            </Button>
          </div>
        </CardContent>
      </Card>

      <section aria-label="Training metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Current timestep" value={compact(exp.progress_timesteps)} hint={live ? "live" : undefined} />
        <Stat label="Wall-clock time" value={wallClock(exp.elapsed_seconds)} hint={exp.status === "queued" ? "waiting for the worker" : undefined} />
        <Stat
          label={<Term k="reward">Mean episode reward</Term>}
          value={last.ep_rew_mean !== undefined ? num(last.ep_rew_mean, 2) : "—"}
          hint={last.ep_rew_mean !== undefined ? "training episodes" : "not recorded"}
        />
        <Stat
          label={<Term k="accuracy">Validation accuracy</Term>}
          value={last.val_accuracy !== undefined ? pct(last.val_accuracy, 1) : "—"}
          hint="fixed validation incidents"
        />
        <Stat label="Policy loss" value={last.policy_loss !== undefined ? num(last.policy_loss, 4) : "—"} hint={last.policy_loss === undefined ? "not recorded" : undefined} />
        <Stat label="Value loss" value={last.value_loss !== undefined ? num(last.value_loss, 3) : "—"} hint={last.value_loss === undefined ? "not recorded" : undefined} />
        <Stat
          label={<Term k="entropy">Policy entropy</Term>}
          value={last.entropy !== undefined ? num(last.entropy, 3) : "—"}
          hint={last.entropy === undefined ? "not recorded" : "nats"}
        />
        <Stat label="Validation reward" value={last.val_reward !== undefined ? num(last.val_reward, 2) : "—"} />
      </section>

      {noTelemetry && !live && exp.validation_curve.length > 0 && (
        <EmptyState title="Limited metrics for this run" className="py-6">
          This run only recorded validation metrics. Reward, loss and entropy curves are available for runs trained
          after telemetry was added.
        </EmptyState>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ChartCard title="Reward versus timesteps" description="Training-episode mean (raw reward) and validation mean" empty={noTelemetry && val.length === 0}>
          <LineSeriesChart
            label="Mean episode reward versus training timesteps"
            xKey="timesteps"
            xLabel="timesteps"
            xFormatter={compact}
            data={mergeByTimestep(train.map((t) => ({ timesteps: t.timesteps, train: t.ep_rew_mean })), val.map((v) => ({ timesteps: v.timesteps, validation: v.mean_reward })))}
            series={[
              { key: "train", label: "Training episodes" },
              { key: "validation", label: "Validation", dashed: true },
            ]}
            yFormatter={(v) => v.toFixed(1)}
          />
        </ChartCard>
        <ChartCard title="Validation accuracy" description="Share of fixed validation incidents diagnosed correctly" empty={val.length === 0}>
          <LineSeriesChart
            label="Validation accuracy versus training timesteps"
            xKey="timesteps"
            xLabel="timesteps"
            xFormatter={compact}
            data={val.map((v) => ({ timesteps: v.timesteps, accuracy: v.accuracy }))}
            series={[{ key: "accuracy", label: "Accuracy" }]}
            yFormatter={(v) => `${Math.round(v * 100)}%`}
            domain={[0, 1]}
            legend={false}
          />
        </ChartCard>
        <ChartCard title="Tests per episode" description="Mean number of tests before the policy declares (validation)" empty={val.length === 0}>
          <LineSeriesChart
            label="Mean tests per validation episode versus training timesteps"
            xKey="timesteps"
            xLabel="timesteps"
            xFormatter={compact}
            data={val.map((v) => ({ timesteps: v.timesteps, tests: v.mean_tests }))}
            series={[{ key: "tests", label: "Tests per episode" }]}
            yFormatter={(v) => v.toFixed(1)}
            legend={false}
          />
        </ChartCard>
        <ChartCard title="Policy entropy" description="Higher means the policy still explores; it falls as it commits" empty={train.every((t) => t.entropy === undefined)}>
          <LineSeriesChart
            label="Policy entropy versus training timesteps"
            xKey="timesteps"
            xLabel="timesteps"
            xFormatter={compact}
            data={train.map((t) => ({ timesteps: t.timesteps, entropy: t.entropy }))}
            series={[{ key: "entropy", label: "Entropy" }]}
            yFormatter={(v) => v.toFixed(2)}
            legend={false}
          />
        </ChartCard>
        <ChartCard title="Policy loss" description="Clipped policy-gradient objective of the latest update" empty={train.every((t) => t.policy_loss === undefined)}>
          <LineSeriesChart
            label="Policy loss versus training timesteps"
            xKey="timesteps"
            xLabel="timesteps"
            xFormatter={compact}
            data={train.map((t) => ({ timesteps: t.timesteps, loss: t.policy_loss }))}
            series={[{ key: "loss", label: "Policy loss" }]}
            yFormatter={(v) => v.toFixed(3)}
            legend={false}
          />
        </ChartCard>
        <ChartCard title="Value loss" description="Error of the critic's return estimate" empty={train.every((t) => t.value_loss === undefined)}>
          <LineSeriesChart
            label="Value loss versus training timesteps"
            xKey="timesteps"
            xLabel="timesteps"
            xFormatter={compact}
            data={train.map((t) => ({ timesteps: t.timesteps, loss: t.value_loss }))}
            series={[{ key: "loss", label: "Value loss" }]}
            yFormatter={(v) => v.toFixed(2)}
            legend={false}
          />
        </ChartCard>
      </div>

      <Card>
        <CardHeader title="Metrics and checkpoints" icon={<Package />} />
        <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold">Download metrics</h3>
            {exp.artifacts.length === 0 ? (
              <p className="text-xs text-muted">Nothing available yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {exp.artifacts.map((a) => (
                  <li key={a}>
                    <a
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                      href={api.artifactUrl(exp.id, a)}
                      download
                    >
                      <Download className="size-3.5" aria-hidden /> {a}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold">Registered checkpoints</h3>
            {registered.length === 0 ? (
              <p className="text-xs text-muted">
                {exp.status === "succeeded"
                  ? "Not registered yet. Register the best checkpoint in the Model Registry."
                  : "Checkpoints are registered automatically when training succeeds."}
              </p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {registered.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2">
                    <Link href="/models" className="text-primary hover:underline">
                      {m.name}
                    </Link>
                    <span className="text-muted">{m.is_active ? "active" : "inactive"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface Derived {
  train: { timesteps: number; ep_rew_mean?: number; policy_loss?: number; value_loss?: number; entropy?: number }[];
  val: { timesteps: number; mean_reward: number; accuracy: number; mean_tests: number }[];
  last: {
    ep_rew_mean?: number;
    policy_loss?: number;
    value_loss?: number;
    entropy?: number;
    val_accuracy?: number;
    val_reward?: number;
  };
}

function derive(exp: ExperimentDetail | undefined): Derived | null {
  if (!exp) return null;
  const train = exp.training_curve.map((t) => ({
    timesteps: t.timesteps,
    ...(t.ep_rew_mean !== undefined ? { ep_rew_mean: t.ep_rew_mean } : {}),
    ...(t.policy_loss !== undefined ? { policy_loss: t.policy_loss } : {}),
    ...(t.value_loss !== undefined ? { value_loss: t.value_loss } : {}),
    // SB3 logs entropy_loss = −(mean policy entropy); flip the sign to show the entropy itself.
    ...(t.entropy_loss !== undefined ? { entropy: -t.entropy_loss } : {}),
  }));
  const val = exp.validation_curve.map((v) => ({
    timesteps: v.timesteps,
    mean_reward: v.mean_reward,
    accuracy: v.accuracy,
    mean_tests: v.mean_tests,
  }));
  const lastTrain = [...train].reverse();
  const pick = <K extends keyof Derived["train"][number]>(k: K) => lastTrain.find((t) => t[k] !== undefined)?.[k];
  const lastVal = val[val.length - 1];
  return {
    train,
    val,
    last: {
      ...(pick("ep_rew_mean") !== undefined ? { ep_rew_mean: pick("ep_rew_mean") as number } : {}),
      ...(pick("policy_loss") !== undefined ? { policy_loss: pick("policy_loss") as number } : {}),
      ...(pick("value_loss") !== undefined ? { value_loss: pick("value_loss") as number } : {}),
      ...(pick("entropy") !== undefined ? { entropy: pick("entropy") as number } : {}),
      ...(lastVal ? { val_accuracy: lastVal.accuracy, val_reward: lastVal.mean_reward } : {}),
    },
  };
}

/** Merge two series that share a timestep axis into rows for one chart. */
export function mergeByTimestep(
  ...series: Record<string, number | undefined>[][]
): Record<string, number | undefined>[] {
  const rows = new Map<number, Record<string, number | undefined>>();
  for (const s of series) {
    for (const p of s) {
      const t = p.timesteps as number;
      rows.set(t, { ...(rows.get(t) ?? { timesteps: t }), ...p });
    }
  }
  return [...rows.values()].sort((a, b) => (a.timesteps as number) - (b.timesteps as number));
}
