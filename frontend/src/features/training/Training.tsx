"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/shell/PageHeader";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { SkeletonRows } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { relativeTime } from "@/lib/format";
import { useExperiments, useScenarios } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { TrainingForm } from "./TrainingForm";
import { TrainingMonitor } from "./TrainingMonitor";

export function Training() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const scenarios = useScenarios();
  const experiments = useExperiments();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");

  const items = useMemo(() => experiments.data?.items ?? [], [experiments.data]);
  const runId = params.get("run") ?? items[0]?.id ?? null;
  const open = (id: string) => router.replace(`${pathname}?run=${id}`);

  const visible = useMemo(
    () =>
      items.filter(
        (e) =>
          (!status || e.status === status) &&
          (!search || e.run_name.toLowerCase().includes(search.toLowerCase()) || e.name.toLowerCase().includes(search.toLowerCase())),
      ),
    [items, status, search],
  );

  return (
    <>
      <PageHeader
        title="RL Training"
        description="Configure and queue MaskablePPO training, then follow it live. Jobs run on the worker, so progress survives page refreshes and dropped connections."
      />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[26rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <TrainingForm scenarios={scenarios.data} onStarted={open} />

          <Card>
            <CardHeader title="Experiments" />
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <label className="relative flex-1">
                  <span className="sr-only">Search experiments</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search runs" className="pl-9" />
                </label>
                <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className="w-32">
                  <option value="">All</option>
                  <option value="running">Running</option>
                  <option value="queued">Queued</option>
                  <option value="succeeded">Succeeded</option>
                  <option value="failed">Failed</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </div>

              {experiments.isPending ? (
                <SkeletonRows rows={4} />
              ) : experiments.isError && !experiments.data ? (
                <ErrorState error={experiments.error} onRetry={() => experiments.refetch()} />
              ) : visible.length === 0 ? (
                <EmptyState title={items.length === 0 ? "No training runs yet" : "No runs match"}>
                  {items.length === 0
                    ? "Queue your first run above. The worker process picks it up automatically."
                    : "Clear the search or status filter."}
                </EmptyState>
              ) : (
                <ul className="space-y-1.5">
                  {visible.map((e) => (
                    <li key={e.id} className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => open(e.id)}
                        aria-pressed={e.id === runId}
                        className={cn(
                          "min-w-0 flex-1 rounded-lg border px-3 py-2 text-left transition-colors",
                          e.id === runId ? "border-primary/60 bg-primary/8" : "border-border hover:bg-elevated",
                        )}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">{e.run_name}</span>
                          <StatusBadge status={e.status} />
                        </span>
                        <Progress className="mt-2" value={e.progress_timesteps} max={e.total_timesteps} label={`${e.run_name} progress`} />
                        <span className="mt-1 block text-[11px] text-muted">
                          {e.progress_timesteps.toLocaleString()} / {e.total_timesteps.toLocaleString()} · seed {e.seed} · {relativeTime(e.created_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0">
          {runId ? (
            <TrainingMonitor id={runId} />
          ) : (
            <EmptyState title="Select or start a run to see its learning curves">
              Reward, accuracy, losses and entropy appear here as soon as the worker reports them.
            </EmptyState>
          )}
        </div>
      </div>

    </>
  );
}
