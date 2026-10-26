"use client";

import { Download, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { LineSeriesChart } from "@/components/charts/LineSeriesChart";
import { PageHeader } from "@/components/shell/PageHeader";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { api, type Experiment } from "@/lib/api";
import { compact, dateTime, label, num, pct } from "@/lib/format";
import { useExperiment, useExperiments, useModels } from "@/lib/queries";

const ALGORITHM = "MaskablePPO";

function ExperimentDetailDialog({ exp, onClose, modelName }: { exp: Experiment | null; onClose: () => void; modelName?: string | undefined }) {
  const detail = useExperiment(exp?.id);
  const d = detail.data;
  return (
    <Dialog open={exp !== null} onOpenChange={(o) => !o && onClose()}>
      {exp && (
        <DialogContent title={exp.run_name} description={`${ALGORITHM} · seed ${exp.seed} · ${dateTime(exp.started_at ?? exp.created_at)}`} className="max-w-3xl">
          <div className="space-y-5 p-5">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <StatusBadge status={exp.status} />
              <span className="text-muted">
                {exp.progress_timesteps.toLocaleString()} / {exp.total_timesteps.toLocaleString()} timesteps
              </span>
              {modelName && (
                <Link href="/models" className="text-primary hover:underline">
                  Model: {modelName}
                </Link>
              )}
              <Link href={`/training?run=${exp.id}`} className="text-primary hover:underline">
                Open in RL Training
              </Link>
            </div>

            <section aria-label="Configuration">
              <h3 className="mb-2 text-xs font-semibold">Training configuration</h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-border bg-elevated/50 p-3 text-xs sm:grid-cols-3">
                {Object.entries(exp.config)
                  .filter(([k]) => !["output_dir", "mlflow_tracking_uri", "run_name"].includes(k))
                  .map(([k, v]) => (
                    <div key={k} className="min-w-0">
                      <dt className="truncate text-muted">{label(k)}</dt>
                      <dd className="truncate font-mono" title={typeof v === "object" ? JSON.stringify(v) : String(v)}>
                        {typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>

            <section aria-label="Validation curve">
              <h3 className="mb-2 text-xs font-semibold">Validation reward</h3>
              {d && d.validation_curve.length > 0 ? (
                <LineSeriesChart
                  label={`Validation reward of ${exp.run_name}`}
                  xKey="timesteps"
                  xLabel="timesteps"
                  xFormatter={compact}
                  data={d.validation_curve.map((v) => ({ timesteps: v.timesteps, reward: v.mean_reward, accuracy: v.accuracy }))}
                  series={[{ key: "reward", label: "Validation reward" }]}
                  legend={false}
                  height={200}
                  yFormatter={(v) => v.toFixed(1)}
                />
              ) : (
                <p className="text-xs text-muted">{detail.isPending ? "Loading…" : "No validation metrics recorded yet."}</p>
              )}
            </section>

            <section aria-label="Downloads">
              <h3 className="mb-2 text-xs font-semibold">Available metrics</h3>
              {d && d.artifacts.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {d.artifacts.map((a) => (
                    <li key={a}>
                      <Button variant="outline" size="sm" asChild>
                        <a href={api.artifactUrl(exp.id, a)} download>
                          <Download /> {a}
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">Nothing to download yet.</p>
              )}
            </section>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

export function Experiments() {
  const experiments = useExperiments();
  const models = useModels();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [scenario, setScenario] = useState("");
  const [open, setOpen] = useState<Experiment | null>(null);

  const items = useMemo(() => experiments.data?.items ?? [], [experiments.data]);
  const scenarios = useMemo(() => [...new Set(items.map((e) => String(e.config.scenario ?? "")).filter(Boolean))], [items]);
  const modelFor = (id: string) => (models.data ?? []).find((m) => m.experiment_id === id);
  const rows = items.filter(
    (e) =>
      (!status || e.status === status) &&
      (!scenario || e.config.scenario === scenario) &&
      (!query || `${e.run_name} ${e.name}`.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <>
      <PageHeader
        title="Experiment History"
        description="Every training run with its configuration, status and resulting checkpoint."
      />

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="relative min-w-56 flex-1">
            <span className="sr-only">Search experiments</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or run" className="pl-9" />
          </label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="w-36">
            <option value="">All statuses</option>
            <option value="succeeded">Succeeded</option>
            <option value="running">Running</option>
            <option value="queued">Queued</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          <Select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Scenario" className="w-40">
            <option value="">All scenarios</option>
            {scenarios.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </div>
      </Card>

      {experiments.isError && !experiments.data ? (
        <ErrorState error={experiments.error} onRetry={() => experiments.refetch()} />
      ) : experiments.isPending ? (
        <SkeletonRows rows={5} />
      ) : rows.length === 0 ? (
        <EmptyState title={items.length === 0 ? "No experiments recorded" : "No experiments match"}>
          {items.length === 0 ? (
            <>
              Queue a run from <Link href="/training" className="text-primary hover:underline">RL Training</Link>. Runs trained on the command line are not
              listed here until registered.
            </>
          ) : (
            "Clear the search or filters."
          )}
        </EmptyState>
      ) : (
        <Card>
          <Table aria-label="Experiments" className="min-w-[60rem]">
            <thead>
              <tr>
                <Th>Experiment</Th>
                <Th>Algorithm</Th>
                <Th>Scenario</Th>
                <Th>Seed</Th>
                <Th>Started</Th>
                <Th>Status</Th>
                <Th>Timesteps</Th>
                <Th>Validation (reward / acc.)</Th>
                <Th>Checkpoint</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const m = modelFor(e.id);
                const v = m?.metrics.validation;
                return (
                  <Tr key={e.id}>
                    <Td>
                      <button type="button" onClick={() => setOpen(e)} className="text-left">
                        <span className="block font-medium hover:text-primary">{e.run_name}</span>
                        <span className="text-[11px] text-muted">{e.name}</span>
                      </button>
                    </Td>
                    <Td>{ALGORITHM}</Td>
                    <Td>{String(e.config.scenario ?? "—")}</Td>
                    <Td>{e.seed}</Td>
                    <Td className="whitespace-nowrap text-xs text-muted">{dateTime(e.started_at ?? e.created_at)}</Td>
                    <Td>
                      <StatusBadge status={e.status} />
                    </Td>
                    <Td className="text-xs">
                      {compact(e.progress_timesteps)} / {compact(e.total_timesteps)}
                    </Td>
                    <Td className="text-xs">{v ? `${num(v.mean_reward)} / ${pct(v.accuracy, 0)}` : "—"}</Td>
                    <Td className="text-xs">{m ? m.name : "—"}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      )}

      <ExperimentDetailDialog exp={open} onClose={() => setOpen(null)} modelName={open ? modelFor(open.id)?.name : undefined} />
    </>
  );
}
