"use client";

import { Bug, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { Heatmap } from "@/components/charts/Heatmap";
import { AXIS, C, TOOLTIP_STYLE } from "@/components/charts/theme";
import { PageHeader } from "@/components/shell/PageHeader";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tip } from "@/components/ui/tooltip";
import { label, modelledSeconds, num, pct, titleCase } from "@/lib/format";
import { useScenario, useScenarios } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { faultDifficulties, faultSignals, type Difficulty } from "./lib";

const DIFFICULTY: Record<Difficulty, { tone: Tone; label: string }> = {
  easy: { tone: "success", label: "Relatively easy" },
  moderate: { tone: "warning", label: "Medium" },
  hard: { tone: "critical", label: "Relatively hard" },
};

export function Faults() {
  const scenarios = useScenarios();
  const [name, setName] = useState("standard");
  const scenarioName = scenarios.data?.some((s) => s.name === name) ? name : scenarios.data?.[0]?.name;
  const detail = useScenario(scenarioName);
  const sc = detail.data;

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [faultId, setFaultId] = useState<string | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const difficulties = useMemo(() => (sc ? faultDifficulties(sc) : []), [sc]);
  const categories = useMemo(() => [...new Set((sc?.faults ?? []).map((f) => f.category))], [sc]);
  const faults = (sc?.faults ?? []).filter(
    (f) =>
      (!category || f.category === category) &&
      (!query || `${f.name} ${f.description} ${f.category}`.toLowerCase().includes(query.toLowerCase())),
  );
  const selected = sc?.faults.find((f) => f.id === faultId) ?? faults[0];
  const selectedIndex = sc && selected ? sc.faults.findIndex((f) => f.id === selected.id) : -1;
  const signals = useMemo(() => (sc && selectedIndex >= 0 ? faultSignals(sc, selectedIndex) : []), [sc, selectedIndex]);
  const activeSignal = signals.find((s) => s.testId === testId) ?? signals[0];
  const diff = difficulties.find((d) => d.faultId === selected?.id);
  const heatOutcome = outcome ?? sc?.outcomes.find((o) => o === "FAIL") ?? sc?.outcomes[0] ?? "";

  return (
    <>
      <PageHeader
        title="Fault Explorer"
        description="The simulated failures, how likely each is, and how every diagnostic test behaves under each failure. These probabilities define the environment; they are hand-authored, not measured from real systems."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Field label="Scenario">
          <Select
            value={scenarioName ?? ""}
            onChange={(e) => {
              setName(e.target.value);
              setFaultId(null);
              setTestId(null);
            }}
            aria-label="Scenario"
            className="w-44"
          >
            {(scenarios.data ?? []).map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.n_faults} faults)
              </option>
            ))}
          </Select>
        </Field>
        <label className="relative min-w-56 flex-1 sm:max-w-xs">
          <span className="sr-only">Search faults</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search faults" className="pl-9" />
        </label>
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-1.5">
          {["", ...categories].map((c) => (
            <button
              key={c || "all"}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                category === c ? "border-primary bg-primary/10 text-primary" : "border-border text-muted hover:text-ink",
              )}
            >
              {c ? titleCase(c) : "All"}
            </button>
          ))}
        </div>
      </div>

      {(scenarios.isError || detail.isError) && !sc && (
        <ErrorState error={scenarios.error ?? detail.error} onRetry={() => { void scenarios.refetch(); void detail.refetch(); }} />
      )}
      {(scenarios.isPending || detail.isPending) && !sc && <Skeleton className="h-96 w-full rounded-xl" />}

      {sc && (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
          <div className="min-w-0 space-y-4">
            {faults.length === 0 ? (
              <EmptyState title="No faults match" icon={<Bug />}>
                Try a different search term or category.
              </EmptyState>
            ) : (
              <ul aria-label="Faults" className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {faults.map((f) => {
                  const d = difficulties.find((x) => x.faultId === f.id);
                  const active = f.id === selected?.id;
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setFaultId(f.id);
                          setTestId(null);
                        }}
                        aria-pressed={active}
                        className={cn(
                          "h-full w-full rounded-xl border bg-surface p-4 text-left shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/50",
                          active ? "border-primary ring-1 ring-primary/40" : "border-border",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold leading-snug">{f.name}</h3>
                          <Badge>{titleCase(f.category)}</Badge>
                        </div>
                        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted">{f.description}</p>
                        <div className="mt-3 flex items-center justify-between text-xs">
                          <span className="text-muted">
                            Prior <span className="font-medium text-ink">{pct(f.prior, 0)}</span>
                          </span>
                          {d && <Badge tone={DIFFICULTY[d.level].tone}>{DIFFICULTY[d.level].label}</Badge>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <Card>
              <CardHeader
                title="Fault signatures across tests"
                description="Probability that each test returns the chosen outcome under each fault. Click a cell to inspect that fault and test."
                action={
                  <Select value={heatOutcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome shown in the heatmap" className="w-36">
                    {sc.outcomes.map((o) => (
                      <option key={o} value={o}>
                        P({o})
                      </option>
                    ))}
                  </Select>
                }
              />
              <CardContent>
                <Heatmap
                  caption={`Probability of outcome ${heatOutcome} for each fault and test`}
                  rowHeader="Fault \ test"
                  rows={sc.faults.map((f) => f.name)}
                  cols={sc.tests.map((t) => t.name)}
                  values={sc.faults.map((_, fi) =>
                    sc.tests.map((t) => t.likelihood[fi]?.[sc.outcomes.indexOf(heatOutcome)] ?? 0),
                  )}
                  max={1}
                  format={(v) => `${Math.round(v * 100)}`}
                  tone={heatOutcome === "PASS" ? "success" : "critical"}
                  compact
                  onCellClick={(r, c) => {
                    setFaultId(sc.faults[r]!.id);
                    setTestId(sc.tests[c]!.id);
                  }}
                  cellTitle={(r, c, v) => `${sc.faults[r]?.name} · ${sc.tests[c]?.name}: P(${heatOutcome}) = ${(v * 100).toFixed(1)}%`}
                />
              </CardContent>
            </Card>
          </div>

          {/* ---- detail ---- */}
          {selected && (
            <div className="space-y-4 xl:sticky xl:top-20">
              <Card>
                <CardHeader title={selected.name} description={selected.description} action={<Badge>{titleCase(selected.category)}</Badge>} />
                <CardContent className="space-y-4">
                  <dl className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <dt className="text-muted">Prior probability</dt>
                      <dd className="mt-0.5 text-base font-semibold">{pct(selected.prior, 1)}</dd>
                    </div>
                    <div>
                      <dt className="flex items-center gap-1 text-muted">
                        Estimated difficulty
                        <Tip content="Relative within this scenario. Based on how well this fault's best single test separates it from the other faults, using the outcome distributions below. It is not a measured diagnosis rate.">
                          <button type="button" className="rounded-full text-muted/70 hover:text-ink" aria-label="How difficulty is estimated">
                            ⓘ
                          </button>
                        </Tip>
                      </dt>
                      <dd className="mt-0.5">
                        {diff && <Badge tone={DIFFICULTY[diff.level].tone}>{DIFFICULTY[diff.level].label}</Badge>}
                        {diff && (
                          <span className="mt-1 block text-[11px] text-muted">
                            best test: {diff.bestTest} ({pct(diff.bestSeparation, 0)} separation)
                          </span>
                        )}
                      </dd>
                    </div>
                  </dl>
                  <p className="rounded-lg bg-elevated/70 p-2.5 text-[11px] leading-relaxed text-muted">
                    Symptoms are not modelled in this simulation: the agent only learns about a fault through diagnostic test results.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader title="Most relevant tests" description="Ranked by how well they tell this fault apart from the others." />
                <CardContent className="pt-3">
                  <ol className="space-y-1">
                    {signals.slice(0, 5).map((s) => {
                      const t = sc.tests.find((x) => x.id === s.testId)!;
                      return (
                        <li key={s.testId}>
                          <button
                            type="button"
                            onClick={() => setTestId(s.testId)}
                            aria-pressed={activeSignal?.testId === s.testId}
                            className={cn(
                              "flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-elevated",
                              activeSignal?.testId === s.testId && "bg-elevated",
                            )}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{s.testName}</span>
                              <span className="text-muted">
                                cost {num(t.cost, 0)} · {modelledSeconds(t.duration)}
                              </span>
                            </span>
                            <span className="shrink-0 tabular-nums text-muted">{pct(s.separation, 0)} separation</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </CardContent>
              </Card>

              {activeSignal && (
                <Card>
                  <CardHeader
                    title={<span className="font-mono text-xs">P(result | fault, test)</span>}
                    description={`${activeSignal.testName} under “${selected.name}” compared with the other faults (prior-weighted)`}
                  />
                  <CardContent>
                    <ChartFrame label={`Outcome probabilities of ${activeSignal.testName} for ${selected.name} versus other faults`} height={220}>
                      <BarChart
                        data={sc.outcomes.map((o, i) => ({ outcome: o, [selected.name]: activeSignal.own[i] ?? 0, "Other faults": activeSignal.others[i] ?? 0 }))}
                        margin={{ left: 0, right: 8, top: 8 }}
                      >
                        <CartesianGrid stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="outcome" {...AXIS} />
                        <YAxis {...AXIS} domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} width={44} />
                        <Tooltip {...TOOLTIP_STYLE} formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey={selected.name} fill={C.primary} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                        <Bar dataKey="Other faults" fill={C.muted} fillOpacity={0.55} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                      </BarChart>
                    </ChartFrame>
                    <p className="mt-2 text-[11px] text-muted">
                      {label(activeSignal.testName)} is run once per investigation and its result is random, drawn from these probabilities.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
