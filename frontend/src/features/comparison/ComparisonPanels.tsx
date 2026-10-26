"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ErrorBar,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { Heatmap } from "@/components/charts/Heatmap";
import { Histogram } from "@/components/charts/Histogram";
import { LineSeriesChart } from "@/components/charts/LineSeriesChart";
import { AXIS, C, POLICY_COLORS, policyLabel, policyShort, TOOLTIP_STYLE } from "@/components/charts/theme";
import { Term } from "@/components/domain/Term";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import type { EvaluationResults } from "@/lib/api";
import { label, num, pct, signed } from "@/lib/format";
import { cn } from "@/lib/utils";
import { normaliseRows, policyRows, summaryChoices, topConfusions } from "./lib";

// ---------------------------------------------------------------- performance table
type SortKey = "label" | "accuracy" | "mean_tests" | "mean_duration" | "mean_cost" | "mean_reward" | "no_diagnosis_rate";

export function AlgorithmComparisonTable({ results }: { results: EvaluationResults }) {
  const rows = useMemo(() => policyRows(results, policyLabel), [results]);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "mean_reward", dir: "desc" });
  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key];
    const bv = b[sort.key];
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sort.dir === "asc" ? cmp : -cmp;
  });
  const bestReward = Math.max(...rows.filter((r) => r.key !== "exact").map((r) => r.mean_reward));

  const head = (key: SortKey, text: string, align = "") => (
    <Th className={align} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }))}
        className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink"
      >
        {text}
        {sort.key === key ? sort.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : <ArrowUpDown className="size-3 opacity-40" aria-hidden />}
      </button>
    </Th>
  );

  return (
    <Table aria-label="Performance comparison" className="min-w-[44rem]">
      <thead>
        <tr>
          {head("label", "Algorithm")}
          {head("accuracy", "Accuracy")}
          {head("mean_tests", "Mean tests")}
          {head("mean_duration", "Mean time")}
          {head("mean_cost", "Mean cost")}
          {head("mean_reward", "Mean reward")}
          {head("no_diagnosis_rate", "No diagnosis")}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <Tr key={r.key} className={r.key === "ppo" ? "bg-primary/5" : undefined}>
            <Td>
              <span className="flex items-center gap-2">
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: POLICY_COLORS[r.key] }} />
                <span className="font-medium">{r.label}</span>
                {r.mean_reward === bestReward && r.key !== "exact" && <Badge tone="success">best reward</Badge>}
              </span>
              {r.note && <span className="mt-0.5 block text-[11px] text-muted">{r.note}</span>}
            </Td>
            <Td>
              {pct(r.accuracy)}
              {r.std && <span className="text-xs text-muted"> ±{(r.std.accuracy * 100).toFixed(1)}</span>}
            </Td>
            <Td>{num(r.mean_tests)}</Td>
            <Td>{num(r.mean_duration, 1)}s</Td>
            <Td>{num(r.mean_cost)}</Td>
            <Td>
              <span className="font-medium">{num(r.mean_reward)}</span>
              {r.std && <span className="text-xs text-muted"> ±{num(r.std.mean_reward)}</span>}
              {r.reward_ci && (
                <span className="block text-[11px] text-muted">
                  95% CI [{num(r.reward_ci[0])}, {num(r.reward_ci[1])}]
                </span>
              )}
            </Td>
            <Td>{pct(r.no_diagnosis_rate)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

// ------------------------------------------------------------------ accuracy vs cost
type XAxisKey = "mean_cost" | "mean_duration" | "mean_tests";
const X_LABEL: Record<XAxisKey, string> = {
  mean_cost: "Mean testing cost",
  mean_duration: "Mean modelled time (s)",
  mean_tests: "Mean tests per incident",
};

export function AccuracyCostChart({ results }: { results: EvaluationResults }) {
  const [xKey, setXKey] = useState<XAxisKey>("mean_cost");
  const rows = useMemo(() => policyRows(results, policyLabel), [results]);

  const sweeps = useMemo(() => {
    const byFamily = new Map<string, { x: number; y: number; param: number }[]>();
    for (const s of results.sweeps) {
      const arr = byFamily.get(s.family) ?? [];
      arr.push({ x: s[xKey], y: s.accuracy, param: s.param });
      byFamily.set(s.family, arr);
    }
    return [...byFamily.entries()].map(([k, pts]) => ({ key: k, pts: pts.sort((a, b) => a.x - b.x) }));
  }, [results, xKey]);

  const headline = rows.map((r) => ({ x: r[xKey], y: r.accuracy, key: r.key, name: r.label }));
  const seedPoints = Object.entries(results.rl?.per_seed ?? {}).map(([seed, s]) => ({
    x: Number(s[xKey] ?? Number.NaN),
    y: Number(s.accuracy),
    name: `PPO ${seed}`,
  }));

  return (
    <Card>
      <CardHeader
        title="Accuracy versus cost"
        description="Large markers are the headline policies; small linked markers sweep each baseline's parameter. Policies up and to the left are better."
        action={
          <Segmented<XAxisKey>
            label="X axis"
            value={xKey}
            onChange={setXKey}
            options={[
              { value: "mean_cost", label: "Cost" },
              { value: "mean_duration", label: "Time" },
              { value: "mean_tests", label: "Tests" },
            ]}
          />
        }
      />
      <CardContent>
        <ChartFrame label={`Diagnostic accuracy versus ${X_LABEL[xKey].toLowerCase()} for each policy`} height={340}>
          <ScatterChart margin={{ left: 0, right: 16, top: 8, bottom: 20 }}>
            <CartesianGrid stroke="var(--border)" />
            <XAxis type="number" dataKey="x" name={X_LABEL[xKey]} {...AXIS} domain={["auto", "auto"]} label={{ value: X_LABEL[xKey], position: "insideBottom", offset: -12, fill: "var(--muted)", fontSize: 11 }} />
            <YAxis type="number" dataKey="y" name="Accuracy" {...AXIS} domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} width={48} />
            <Tooltip
              {...TOOLTIP_STYLE}
              cursor={{ strokeDasharray: "3 3" }}
              formatter={(v, n) => (n === "Accuracy" ? `${(Number(v) * 100).toFixed(1)}%` : Number(v).toFixed(2))}
              labelFormatter={() => ""}
            />
            {sweeps.map((s) => (
              <Scatter
                key={s.key}
                name={`${policyLabel(s.key)} (sweep)`}
                data={s.pts}
                fill={POLICY_COLORS[s.key] ?? C.muted}
                line={{ stroke: POLICY_COLORS[s.key] ?? C.muted, strokeOpacity: 0.45 }}
                shape="circle"
                isAnimationActive={false}
              />
            ))}
            {seedPoints.length > 0 && <Scatter name="PPO (each seed)" data={seedPoints} fill={C.primary} fillOpacity={0.45} isAnimationActive={false} />}
            <Scatter
              name="Headline policies"
              data={headline}
              isAnimationActive={false}
              shape={(props: { cx?: number; cy?: number; payload?: { key: string } }) => (
                <circle cx={props.cx} cy={props.cy} r={8} fill={POLICY_COLORS[props.payload?.key ?? ""] ?? C.muted} stroke="var(--surface)" strokeWidth={2} />
              )}
            />
          </ScatterChart>
        </ChartFrame>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted" aria-label="Chart legend">
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-full border-2 border-surface bg-muted" /> large marker: headline policy
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 bg-muted/60" /> small linked markers: parameter sweep
          </li>
          {seedPoints.length > 0 && (
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full bg-primary/50" /> each PPO seed
            </li>
          )}
        </ul>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Headline policies">
          {headline.map((p) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full" style={{ background: POLICY_COLORS[p.key] }} />
              {p.name}: {pct(p.y, 1)} at {num(p.x, 1)}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------------- reward
export function RewardChart({ results }: { results: EvaluationResults }) {
  const rows = useMemo(() => policyRows(results, policyLabel), [results]);
  const data = rows.map((r) => ({
    key: r.key,
    name: policyShort(r.key),
    value: r.mean_reward,
    err: r.reward_ci
      ? [r.mean_reward - r.reward_ci[0], r.reward_ci[1] - r.mean_reward]
      : r.std
        ? [r.std.mean_reward, r.std.mean_reward]
        : [0, 0],
  }));
  return (
    <Card>
      <CardHeader
        title="Mean reward"
        description="Error bars: 95% CI over incidents (baselines) or ± standard deviation across training seeds (PPO)."
      />
      <CardContent>
        <ChartFrame label="Mean reward per incident for each policy" height={300}>
          <BarChart data={data} margin={{ left: 0, right: 12, top: 12, bottom: 4 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" {...AXIS} interval={0} />
            <YAxis {...AXIS} width={40} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [Number(v).toFixed(2), "Mean reward"]} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.key} fill={POLICY_COLORS[d.key] ?? C.muted} />
              ))}
              <ErrorBar dataKey="err" stroke="var(--ink)" strokeWidth={1.5} width={6} />
            </Bar>
          </BarChart>
        </ChartFrame>
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------------------- durations
export function DurationChart({ results }: { results: EvaluationResults }) {
  const dist = results.distributions;
  const [metric, setMetric] = useState<"duration" | "tests">("duration");
  const rows = useMemo(() => policyRows(results, policyLabel), [results]);
  return (
    <Card>
      <CardHeader
        title="Diagnostic effort distribution"
        description={
          dist
            ? "Share of episodes at each level. Each policy is normalised so differing episode counts stay comparable."
            : "Episode-level samples were not recorded for this evaluation; showing percentiles instead."
        }
        action={
          dist ? (
            <Segmented<"duration" | "tests">
              label="Metric"
              value={metric}
              onChange={setMetric}
              options={[
                { value: "duration", label: "Time" },
                { value: "tests", label: "Tests" },
              ]}
            />
          ) : undefined
        }
      />
      <CardContent>
        {dist ? (
          <Histogram
            label={`Distribution of ${metric === "duration" ? "modelled diagnostic time" : "tests per incident"} by policy`}
            xLabel={metric === "duration" ? "modelled time (s)" : "tests per incident"}
            series={rows
              .filter((r) => dist[r.key])
              .map((r) => ({ key: r.key, label: r.label, color: POLICY_COLORS[r.key] ?? C.muted, values: dist[r.key]![metric] }))}
          />
        ) : (
          <Table aria-label="Duration percentiles">
            <thead>
              <tr>
                <Th>Algorithm</Th>
                <Th>Mean</Th>
                <Th>Median</Th>
                <Th>90th pct</Th>
                <Th>95th pct</Th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(results.baselines).map(([k, b]) => (
                <Tr key={k}>
                  <Td>{policyLabel(k)}</Td>
                  <Td>{num(b.summary.mean_duration, 1)}s</Td>
                  <Td>{num(b.summary.median_duration, 1)}s</Td>
                  <Td>{num(b.summary.p90_duration, 1)}s</Td>
                  <Td>{num(b.summary.p95_duration, 1)}s</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ confusion matrix
export function ConfusionPanel({ results, faultIds }: { results: EvaluationResults; faultIds: string[] }) {
  const choices = useMemo(() => summaryChoices(results, policyLabel), [results]);
  const [key, setKey] = useState(choices.find((c) => c.key.startsWith("ppo"))?.key ?? choices[0]?.key ?? "");
  const choice = choices.find((c) => c.key === key) ?? choices[0];
  if (!choice) return null;
  const matrix = choice.summary.confusion_matrix;
  const rowsN = matrix.length;
  const ids = faultIds.length === rowsN ? faultIds : Array.from({ length: rowsN }, (_, i) => `fault ${i}`);
  const confusions = topConfusions(matrix, ids);
  const perFault = Object.entries(choice.summary.per_fault);

  return (
    <Card>
      <CardHeader
        title="Confusion matrix"
        description="Rows are the true fault, columns what the policy declared (last column: no diagnosis). Cells show the share of that fault's incidents."
        action={
          <Select value={choice.key} onChange={(e) => setKey(e.target.value)} aria-label="Policy for the confusion matrix" className="w-56">
            {choices.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </Select>
        }
      />
      <CardContent className="space-y-5">
        <Heatmap
          caption={`Confusion matrix for ${choice.label}`}
          rowHeader="True \ declared"
          rows={ids.map(label)}
          cols={[...ids.map(label), "no diagnosis"]}
          values={normaliseRows(matrix)}
          max={1}
          format={(v) => (v === 0 ? "·" : `${Math.round(v * 100)}`)}
          highlightDiagonal
          compact
          cellTitle={(i, j, v) => `${label(ids[i] ?? "")} → ${j >= ids.length ? "no diagnosis" : label(ids[j] ?? "")}: ${(v * 100).toFixed(1)}% of ${matrix[i]?.reduce((a, b) => a + b, 0)} incidents`}
        />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold">Most common mistakes</h3>
            {confusions.length === 0 ? (
              <p className="text-xs text-muted">No misdiagnoses recorded.</p>
            ) : (
              <ol className="space-y-1.5 text-xs">
                {confusions.map((c) => (
                  <li key={`${c.truth}-${c.predicted}`} className="flex items-center justify-between gap-3">
                    <span>
                      <span className="font-medium">{label(c.truth)}</span> <span className="text-muted">declared as</span>{" "}
                      <span className="font-medium">{label(c.predicted)}</span>
                    </span>
                    <span className="tabular-nums text-muted">
                      {c.count} ({(c.rate * 100).toFixed(0)}% of that fault)
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold">Per-fault precision and recall</h3>
            <div className="max-h-56 overflow-y-auto">
              <Table aria-label="Per-fault precision and recall" className="min-w-0">
                <thead>
                  <tr>
                    <Th>Fault</Th>
                    <Th>Precision</Th>
                    <Th>Recall</Th>
                  </tr>
                </thead>
                <tbody>
                  {perFault.map(([f, v]) => (
                    <Tr key={f}>
                      <Td className="py-1.5 text-xs">{label(f)}</Td>
                      <Td className="py-1.5 text-xs">{pct(v.precision, 0)}</Td>
                      <Td className="py-1.5 text-xs">{pct(v.recall, 0)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ statistics
export function StatisticsPanel({ results }: { results: EvaluationResults }) {
  const paired = results.paired_rl_minus_baseline;
  if (!paired) return null;
  return (
    <Card>
      <CardHeader
        title={<Term k="paired">Statistical comparison</Term>}
        description="Seed-averaged PPO minus each baseline, mean reward per incident, paired bootstrap over identical incidents."
      />
      <CardContent>
        <Table aria-label="Paired comparison" className="min-w-[30rem]">
          <thead>
            <tr>
              <Th>PPO versus</Th>
              <Th>Difference</Th>
              <Th>
                <Term k="ci">95% interval</Term>
              </Th>
              <Th>Verdict</Th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(paired).map(([k, d]) => (
              <Tr key={k}>
                <Td className="font-medium">{policyLabel(k)}</Td>
                <Td>{signed(d.mean_diff, 3)}</Td>
                <Td className="text-xs">
                  [{signed(d.ci_low, 3)}, {signed(d.ci_high, 3)}]
                </Td>
                <Td>
                  <Badge tone={d.significant ? (d.mean_diff > 0 ? "success" : "critical") : "neutral"}>
                    {d.significant ? (d.mean_diff > 0 ? "PPO better" : "PPO worse") : "not distinguishable"}
                  </Badge>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-3 text-xs text-muted">
          A difference counts only when its interval excludes zero. This reflects incident-sampling noise; seed-to-seed
          variation is the ± shown in the performance table.
        </p>
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------- robustness
const SWEEPS: { key: string; title: string; xLabel: string }[] = [
  { key: "noise", title: "Noisier tests", xLabel: "noise ε" },
  { key: "wrong_penalty", title: "Wrong-diagnosis penalty", xLabel: "penalty" },
  { key: "cost_multiplier", title: "Test cost multiplier", xLabel: "multiplier" },
];

export function RobustnessPanel({ results }: { results: EvaluationResults }) {
  const rob = results.robustness;
  if (!rob) return null;
  return (
    <Card>
      <CardHeader
        title="Sensitivity"
        description="Mean reward as conditions change. The RL policy is not retrained for these conditions, so this measures transfer of the nominal policy."
      />
      <CardContent className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {SWEEPS.map((s) => {
          const rows = rob[s.key];
          if (!rows) return null;
          const policies = [...new Set(rows.map((r) => String(r.policy)))];
          const byParam = new Map<number, Record<string, number>>();
          for (const r of rows) {
            const p = Number(r.param);
            byParam.set(p, { ...(byParam.get(p) ?? { param: p }), [String(r.policy)]: Number(r.mean_reward) });
          }
          const data = [...byParam.values()].sort((a, b) => (a.param ?? 0) - (b.param ?? 0));
          return (
            <div key={s.key}>
              <h3 className="mb-2 text-xs font-semibold">{s.title}</h3>
              <LineSeriesChart
                label={`Mean reward as ${s.title.toLowerCase()} changes`}
                xKey="param"
                xLabel={s.xLabel}
                height={230}
                data={data}
                series={policies.map((p) => ({ key: p, label: policyLabel(p), color: POLICY_COLORS[p] ?? C.muted }))}
                yFormatter={(v) => v.toFixed(1)}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function EvaluationBadges({ results }: { results: EvaluationResults }) {
  const m = results.metadata;
  const items: [string, string][] = [
    ["Test episodes", results.n_test_episodes.toLocaleString()],
    ["Validation episodes", results.n_val_episodes.toLocaleString()],
    ...(m
      ? ([
          ["Scenario", m.scenario],
          ["Evaluation seed", String(m.test_seed)],
          ["Checkpoint", m.checkpoint],
          ["Runs", m.runs.join(", ")],
        ] as [string, string][])
      : []),
  ];
  const reward = m?.reward ?? results.reward_config;
  return (
    <div className="space-y-2">
      <dl className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
        {items.map(([k, v]) => (
          <div key={k} className={cn("flex gap-1.5")}>
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {reward && (
        <p className="text-[11px] text-muted">
          Reward: {Object.entries(reward).map(([k, v]) => `${label(k)} ${v}`).join(" · ")}
        </p>
      )}
      {!m && (
        <p className="text-[11px] text-warning">
          This evaluation predates configuration metadata (seed, checkpoint, runs); those filters cannot apply to it.
        </p>
      )}
    </div>
  );
}
