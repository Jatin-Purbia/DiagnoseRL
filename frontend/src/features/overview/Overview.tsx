"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Activity, Boxes, Clock, Coins, ListChecks, RefreshCw, Target } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { AXIS, C, POLICY_COLORS, policyLabel, policyShort, TOOLTIP_STYLE } from "@/components/charts/theme";
import { MetricCard } from "@/components/domain/MetricCard";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import type { AnalyticsFilters } from "@/lib/api";
import { label, modelledSeconds, num, pct, relativeTime, shortId } from "@/lib/format";
import { useAnalytics, useEvaluationResults, useExperiments, useOverview } from "@/lib/queries";
import { trendOf } from "./trend";

type Range = "7d" | "30d" | "all" | "custom";

const isoDay = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

function rangeFilters(range: Range, since: string, until: string): Pick<AnalyticsFilters, "since" | "until"> {
  if (range === "all") return {};
  if (range === "custom") return { ...(since ? { since } : {}), ...(until ? { until } : {}) };
  const days = range === "7d" ? 6 : 29;
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { since: isoDay(from) };
}

export function Overview() {
  const qc = useQueryClient();
  const [range, setRange] = useState<Range>("all");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [scenario, setScenario] = useState("");
  const [policy, setPolicy] = useState("");

  const filters: AnalyticsFilters = useMemo(
    () => ({
      ...(scenario ? { scenario } : {}),
      ...(policy ? { policy } : {}),
      ...rangeFilters(range, since, until),
    }),
    [range, since, until, scenario, policy],
  );

  const analytics = useAnalytics(filters);
  const overview = useOverview();
  const experiments = useExperiments();
  const latestEval = useEvaluationResults(overview.data?.latest_evaluation_id);
  const a = analytics.data;
  const model = overview.data?.active_models[0];
  const invalidRange = range === "custom" && since && until && since > until;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["analytics"] });
    void qc.invalidateQueries({ queryKey: ["overview"] });
    void qc.invalidateQueries({ queryKey: ["experiments"] });
  };

  const trends = a
    ? {
        accuracy: trendOf(a.timeseries, "accuracy"),
        cost: trendOf(a.timeseries, "mean_cost"),
        time: trendOf(a.timeseries, "mean_duration"),
        tests: trendOf(a.timeseries, "mean_tests"),
      }
    : null;

  return (
    <>
      <PageHeader
        title="Overview"
        description="How investigations are going: accuracy, cost and effort, computed from the sessions stored by the backend."
        actions={
          <Button variant="outline" size="sm" onClick={refresh} loading={analytics.isFetching && !analytics.isPending}>
            <RefreshCw /> Refresh
          </Button>
        }
      />

      {/* ---- filters ---- */}
      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Period">
            <Select value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label="Period" className="w-40">
              <option value="all">All time</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="custom">Custom range</option>
            </Select>
          </Field>
          {range === "custom" && (
            <>
              <Field label="From">
                <Input type="date" value={since} onChange={(e) => setSince(e.target.value)} aria-label="From date" />
              </Field>
              <Field label="To" error={invalidRange ? "“From” must not be after “To”" : null}>
                <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} aria-label="To date" />
              </Field>
            </>
          )}
          <Field label="Scenario">
            <Select value={scenario} onChange={(e) => setScenario(e.target.value)} aria-label="Scenario" className="w-40">
              <option value="">All scenarios</option>
              {a?.options.scenarios.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Algorithm">
            <Select value={policy} onChange={(e) => setPolicy(e.target.value)} aria-label="Algorithm" className="w-48">
              <option value="">All algorithms</option>
              {a?.options.policies.map((p) => (
                <option key={p} value={p}>
                  {policyLabel(p)}
                </option>
              ))}
            </Select>
          </Field>
          {(scenario || policy || range !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setScenario("");
                setPolicy("");
                setRange("all");
                setSince("");
                setUntil("");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      {analytics.isError && !a && <ErrorState error={analytics.error} onRetry={() => analytics.refetch()} />}

      {/* ---- metric cards ---- */}
      <section aria-label="Key metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {!a ? (
          Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              icon={<Activity />}
              label="Investigations"
              value={a.total_investigations}
              context={`${a.finished} finished · ${a.active} active`}
              info="Every investigation matching the filters, including ones still in progress."
            />
            <MetricCard
              icon={<Target />}
              label="Accuracy"
              value={pct(a.accuracy)}
              context={a.finished ? `${a.correct} of ${a.finished} correct` : "no finished investigations"}
              info="Correct diagnoses divided by finished investigations. Investigations that hit the step limit count as failures."
              trend={
                trends?.accuracy != null
                  ? { delta: trends.accuracy, higherIsBetter: true, label: "Recent days vs earlier", format: (n) => `${(n * 100).toFixed(1)} pts` }
                  : null
              }
            />
            <MetricCard
              icon={<Clock />}
              label="Avg time"
              value={modelledSeconds(a.mean_duration)}
              context="modelled test time"
              info="Sum of the modelled durations of the tests run, not wall-clock time."
              trend={
                trends?.time != null
                  ? { delta: trends.time, higherIsBetter: false, label: "Recent days vs earlier", format: (n) => modelledSeconds(n) }
                  : null
              }
            />
            <MetricCard
              icon={<Coins />}
              label="Avg cost"
              value={num(a.mean_cost, 1)}
              context="cost units per incident"
              info="Mean resource cost of the tests run per finished investigation."
              trend={
                trends?.cost != null
                  ? { delta: trends.cost, higherIsBetter: false, label: "Recent days vs earlier", format: (n) => n.toFixed(1) }
                  : null
              }
            />
            <MetricCard
              icon={<ListChecks />}
              label="Avg tests"
              value={num(a.mean_tests, 1)}
              context={a.mean_reward !== null ? `mean reward ${num(a.mean_reward, 1)}` : undefined}
              info="Average number of diagnostic tests run before the investigation ended."
              trend={
                trends?.tests != null
                  ? { delta: trends.tests, higherIsBetter: false, label: "Recent days vs earlier", format: (n) => n.toFixed(1) }
                  : null
              }
            />
            <MetricCard
              icon={<Boxes />}
              label="Active policy"
              value={<span className="block truncate text-lg">{model ? model.name : "None"}</span>}
              context={model ? `scenario ${model.scenario}` : "register one in Model Registry"}
              info="The reinforcement-learning policy used when an investigation selects MaskablePPO."
            />
          </>
        )}
      </section>

      {a && a.finished === 0 && (
        <EmptyState
          className="mt-5"
          title={a.total_investigations === 0 ? "No investigations yet" : "No finished investigations match these filters"}
          action={
            <Button asChild>
              <Link href="/playground">Start an investigation</Link>
            </Button>
          }
        >
          Charts appear once investigations have been completed. Run one in the Diagnostic Playground.
        </EmptyState>
      )}

      {a && a.finished > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {/* accuracy over time */}
          <Card>
            <CardHeader title="Diagnosis accuracy over time" description="Share of finished investigations diagnosed correctly, per day" />
            <CardContent>
              {a.timeseries.length < 2 ? (
                <p className="py-10 text-center text-sm text-muted">
                  {a.timeseries.length === 1
                    ? `Only one day of data so far (${a.timeseries[0]?.date}: ${pct(a.timeseries[0]?.accuracy)} over ${a.timeseries[0]?.sessions} investigations).`
                    : "No data in range."}
                </p>
              ) : (
                <ChartFrame label="Diagnosis accuracy per day" height={240}>
                  <AreaChart data={a.timeseries} margin={{ left: 0, right: 12, top: 8 }}>
                    <defs>
                      <linearGradient id="accFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="date" {...AXIS} />
                    <YAxis {...AXIS} domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} width={44} />
                    <Tooltip
                      {...TOOLTIP_STYLE}
                      formatter={(v, _n, item) => [`${(Number(v) * 100).toFixed(1)}% (${(item.payload as { sessions: number }).sessions} investigations)`, "Accuracy"]}
                    />
                    <Area type="monotone" dataKey="accuracy" stroke="var(--primary)" strokeWidth={2} fill="url(#accFill)" isAnimationActive={false} />
                  </AreaChart>
                </ChartFrame>
              )}
            </CardContent>
          </Card>

          {/* cost by algorithm */}
          <Card>
            <CardHeader title="Diagnostic cost by algorithm" description="Mean testing cost per finished investigation" />
            <CardContent>
              <ChartFrame label="Mean testing cost by algorithm" height={240}>
                <BarChart
                  data={a.by_policy.map((p) => ({ ...p, name: policyShort(p.policy) }))}
                  margin={{ left: 0, right: 12, top: 8 }}
                >
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" {...AXIS} interval={0} />
                  <YAxis {...AXIS} width={36} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v, _n, item) => {
                      const p = item.payload as { accuracy: number | null; sessions: number };
                      return [`${Number(v).toFixed(2)} · accuracy ${pct(p.accuracy, 0)} · n=${p.sessions}`, "Mean cost"];
                    }}
                  />
                  <Bar dataKey="mean_cost" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {a.by_policy.map((p) => (
                      <Cell key={p.policy} fill={POLICY_COLORS[p.policy] ?? C.primary} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartFrame>
            </CardContent>
          </Card>

          {/* fault frequency */}
          <Card>
            <CardHeader title="Fault frequency" description="True root causes of finished investigations, and how often they were identified" />
            <CardContent>
              <ChartFrame label="Number of investigations per true root cause" height={Math.max(200, a.fault_frequency.length * 30)}>
                <BarChart
                  layout="vertical"
                  data={a.fault_frequency.map((f) => ({ ...f, name: label(f.fault) }))}
                  margin={{ left: 8, right: 16 }}
                >
                  <CartesianGrid stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" {...AXIS} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={130} {...AXIS} />
                  <Tooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v, _n, item) => {
                      const f = item.payload as { identified: number; identification_rate: number };
                      return [`${v} (identified ${f.identified}, ${pct(f.identification_rate, 0)})`, "Investigations"];
                    }}
                  />
                  <Bar dataKey="count" fill="var(--secondary)" radius={[0, 6, 6, 0]} isAnimationActive={false} />
                </BarChart>
              </ChartFrame>
            </CardContent>
          </Card>

          {/* recent outcomes */}
          <Card>
            <CardHeader title="Recent incident outcomes" description="Click an investigation to open its trace" />
            <CardContent className="pt-2">
              <ul className="divide-y divide-border">
                {a.recent.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/playground?session=${r.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg px-1 py-2.5 transition-colors hover:bg-elevated/70"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {r.true_fault ? label(r.true_fault) : "Root cause hidden"}
                          <span className="ml-2 font-mono text-xs text-muted">{shortId(r.id)}</span>
                        </p>
                        <p className="text-xs text-muted">
                          {policyLabel(r.policy)} · {r.tests} tests · {relativeTime(r.created_at)}
                        </p>
                      </div>
                      {r.status === "active" ? (
                        <StatusBadge status="active" />
                      ) : r.status === "truncated" ? (
                        <Badge tone="critical">no diagnosis</Badge>
                      ) : (
                        <Badge tone={r.correct ? "success" : "critical"}>{r.correct ? "correct" : "incorrect"}</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ---- RL vs baselines + experiments (independent of the session filters) ---- */}
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="RL versus baselines"
            description={
              latestEval.data?.metadata
                ? `Mean reward per incident · scenario ${latestEval.data.metadata.scenario} · ${latestEval.data.n_test_episodes.toLocaleString()} held-out incidents · latest evaluation`
                : "Mean reward per incident on held-out test incidents, from the latest evaluation"
            }
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/comparison">Details</Link>
              </Button>
            }
          />
          <CardContent>
            {overview.isPending ? (
              <Skeleton className="h-52 w-full" />
            ) : overview.data && overview.data.strategy_comparison.length > 0 ? (
              <ChartFrame label="Mean reward per incident by strategy in the latest evaluation" height={240}>
                <BarChart
                  data={overview.data.strategy_comparison.map((r) => ({
                    policy: String(r.policy),
                    name: policyShort(String(r.policy)),
                    reward: Number(r.mean_reward ?? 0),
                  }))}
                  margin={{ left: 0, right: 12, top: 8 }}
                >
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="name" {...AXIS} interval={0} />
                  <YAxis {...AXIS} width={36} />
                  <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [Number(v).toFixed(2), "Mean reward"]} />
                  <Bar dataKey="reward" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {overview.data.strategy_comparison.map((r) => (
                      <Cell key={String(r.policy)} fill={POLICY_COLORS[String(r.policy)] ?? C.primary} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartFrame>
            ) : (
              <EmptyState title="No evaluation yet">
                Run an evaluation on the Comparison page once a model has been trained. Nothing is shown until real
                results exist.
              </EmptyState>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="Recent experiments"
            action={
              <Button variant="ghost" size="sm" asChild>
                <Link href="/experiments">All experiments</Link>
              </Button>
            }
          />
          <CardContent className="pt-2">
            {experiments.isPending ? (
              <Skeleton className="h-40 w-full" />
            ) : experiments.data && experiments.data.items.length > 0 ? (
              <ul className="divide-y divide-border">
                {experiments.data.items.slice(0, 5).map((e) => (
                  <li key={e.id}>
                    <Link href={`/training?run=${e.id}`} className="block rounded-lg px-1 py-2.5 transition-colors hover:bg-elevated/70">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium">{e.run_name}</p>
                        <StatusBadge status={e.status} />
                      </div>
                      <Progress className="mt-2" value={e.progress_timesteps} max={e.total_timesteps} label={`${e.run_name} progress`} />
                      <p className="mt-1 text-xs text-muted">
                        {e.progress_timesteps.toLocaleString()} / {e.total_timesteps.toLocaleString()} steps · seed {e.seed}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No training experiments">Queue one from the RL Training page.</EmptyState>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
