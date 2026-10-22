"use client";

import { useMemo, useState } from "react";
import { Lines, POLICY_COLORS, Tradeoff, ValueBars, type ScatterSeries } from "@/components/charts";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  Table,
  td,
  th,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { label, num, pct, when } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { EvaluationResults } from "@/lib/types";

const FAMILY_ORDER = ["fixed_order", "random", "info_gain", "cost_aware_bayes"];

function RunEvaluation({ onStarted }: { onStarted: () => void }) {
  const [runs, setRuns] = useState("");
  const [nTest, setNTest] = useState("1000");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ error?: string; ok?: string }>({});

  const submit = async () => {
    setBusy(true);
    setMsg({});
    try {
      const run_names = runs.split(",").map((r) => r.trim()).filter(Boolean);
      if (run_names.length === 0) throw new Error("Enter at least one training run name.");
      await api.startEvaluation({ run_names, n_test: Number(nTest), skip_robustness: false });
      setMsg({ ok: "Evaluation queued. It appears below when the worker finishes it." });
      onStarted();
    } catch (e) {
      setMsg({
        error:
          e instanceof ApiError && e.status === 401
            ? "Admin API key missing or invalid. Set it in the sidebar."
            : e instanceof Error
              ? e.message
              : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Run an evaluation" subtitle="Evaluates trained runs against all baselines on held-out incidents">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Training run names (comma separated)">
          <Input value={runs} onChange={(e) => setRuns(e.target.value)} placeholder="full_seed0, full_seed1" />
        </Field>
        <Field label="Test episodes">
          <Input inputMode="numeric" value={nTest} onChange={(e) => setNTest(e.target.value)} />
        </Field>
        <Button type="submit" loading={busy}>
          Queue
        </Button>
      </form>
      {msg.error && <div className="mt-3"><ErrorBanner error={msg.error} /></div>}
      {msg.ok && <p className="mt-3 text-xs text-good">{msg.ok}</p>}
    </Card>
  );
}

function pivot(rows: Record<string, unknown>[]): Record<string, number | string>[] {
  const byParam = new Map<number, Record<string, number | string>>();
  for (const r of rows) {
    const p = Number(r.param);
    const entry = byParam.get(p) ?? { param: p };
    entry[String(r.policy)] = Number(r.mean_reward);
    byParam.set(p, entry);
  }
  return [...byParam.values()].sort((a, b) => Number(a.param) - Number(b.param));
}

function Results({ r, evalId }: { r: EvaluationResults; evalId: string }) {
  const policies = [...FAMILY_ORDER.filter((p) => p in r.baselines), ...(r.rl ? ["ppo"] : [])];
  const [focus, setFocus] = useState(policies[policies.length - 1] ?? "cost_aware_bayes");

  const scatter: ScatterSeries[] = useMemo(() => {
    const out: ScatterSeries[] = [];
    for (const fam of FAMILY_ORDER) {
      const pts = r.sweeps
        .filter((s) => s.family === fam)
        .sort((a, b) => a.mean_cost - b.mean_cost)
        .map((s) => ({ x: s.mean_cost, y: s.accuracy }));
      if (pts.length) out.push({ name: `${label(fam)} (sweep)`, color: POLICY_COLORS[fam] ?? "#999", points: pts, line: pts.length > 2 });
    }
    if (r.rl) {
      out.push({
        name: "ppo (seeds)",
        color: POLICY_COLORS.ppo ?? "#f87171",
        points: Object.values(r.rl.per_seed).map((s) => ({ x: Number(s.mean_cost), y: Number(s.accuracy) })),
      });
    }
    return out;
  }, [r]);

  const rewardBars = policies.map((p) => {
    if (p === "ppo" && r.rl) {
      const a = r.rl.aggregate.mean_reward;
      return { name: "ppo", value: a?.mean ?? 0, low: (a?.mean ?? 0) - (a?.std ?? 0), high: (a?.mean ?? 0) + (a?.std ?? 0), color: POLICY_COLORS.ppo };
    }
    const b = r.baselines[p];
    return { name: label(p), value: b?.summary.mean_reward ?? 0, low: b?.reward_ci[0], high: b?.reward_ci[1], color: POLICY_COLORS[p] };
  });

  const focusSummary = focus === "ppo" ? r.rl && Object.values(r.rl.per_seed_full)[0] : r.baselines[focus]?.summary;

  return (
    <div className="space-y-4">
      <Card
        title="Performance"
        subtitle={`${r.n_test_episodes.toLocaleString()} held-out test incidents · baseline parameters tuned on ${r.n_val_episodes.toLocaleString()} validation incidents`}
      >
        <Table>
          <thead>
            <tr>
              {["Policy", "Accuracy", "Tests", "Cost", "Duration", "No diagnosis", "Mean reward (95% CI)"].map((h) => (
                <th key={h} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FAMILY_ORDER.filter((p) => p in r.baselines).map((p) => {
              const b = r.baselines[p];
              if (!b) return null;
              return (
                <tr key={p} className="border-t border-line">
                  <td className={td}>{label(p)}</td>
                  <td className={td}>{pct(b.summary.accuracy)}</td>
                  <td className={td}>{num(b.summary.mean_tests)}</td>
                  <td className={td}>{num(b.summary.mean_cost)}</td>
                  <td className={td}>{num(b.summary.mean_duration, 1)} s</td>
                  <td className={td}>{pct(b.summary.no_diagnosis_rate)}</td>
                  <td className={td}>
                    {num(b.summary.mean_reward)} [{num(b.reward_ci[0])}, {num(b.reward_ci[1])}]
                  </td>
                </tr>
              );
            })}
            {r.rl && (
              <tr className="border-t border-line bg-bad/5">
                <td className={td}>ppo <span className="text-xs text-muted">(mean ± std over {Object.keys(r.rl.per_seed).length} seeds)</span></td>
                {(["accuracy", "mean_tests", "mean_cost", "mean_duration", "no_diagnosis_rate", "mean_reward"] as const).map((k) => {
                  const a = r.rl?.aggregate[k];
                  const fmt = k === "accuracy" || k === "no_diagnosis_rate" ? (v: number) => pct(v) : (v: number) => num(v);
                  return <td key={k} className={td}>{a ? `${fmt(a.mean)} ± ${fmt(a.std)}` : "—"}</td>;
                })}
              </tr>
            )}
            {r.reference?.exact && (
              <tr className="border-t border-line">
                <td className={td}>exact optimal (DP)</td>
                <td className={td}>{pct(r.reference.exact.summary.accuracy)}</td>
                <td className={td}>{num(r.reference.exact.summary.mean_tests)}</td>
                <td className={td}>{num(r.reference.exact.summary.mean_cost)}</td>
                <td className={td}>{num(r.reference.exact.summary.mean_duration, 1)} s</td>
                <td className={td}>{pct(r.reference.exact.summary.no_diagnosis_rate)}</td>
                <td className={td}>{num(r.reference.exact.summary.mean_reward)}</td>
              </tr>
            )}
          </tbody>
        </Table>
      </Card>

      {r.paired_rl_minus_baseline && (
        <Card
          title="Statistical comparison"
          subtitle="Seed-averaged PPO minus each baseline, mean reward per incident, paired bootstrap over incidents"
        >
          <Table>
            <thead>
              <tr>
                <th className={th}>vs baseline</th>
                <th className={th}>Difference</th>
                <th className={th}>95% CI</th>
                <th className={th}>Credible?</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(r.paired_rl_minus_baseline).map(([name, d]) => (
                <tr key={name} className="border-t border-line">
                  <td className={td}>{label(name)}</td>
                  <td className={td}>{d.mean_diff >= 0 ? "+" : ""}{num(d.mean_diff, 3)}</td>
                  <td className={td}>[{num(d.ci_low, 3)}, {num(d.ci_high, 3)}]</td>
                  <td className={td}>
                    <Badge tone={d.significant ? (d.mean_diff > 0 ? "good" : "bad") : "neutral"}>
                      {d.significant ? (d.mean_diff > 0 ? "PPO better" : "PPO worse") : "not distinguishable"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-muted">
            A difference counts only if its interval excludes zero. This reflects incident sampling
            noise; seed-to-seed variation is the ± in the table above.
          </p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Accuracy versus testing cost" subtitle="Parameter sweeps of each baseline; PPO per seed">
          <Tradeoff series={scatter} xLabel="mean testing cost" yLabel="accuracy" ariaLabel="Accuracy versus mean testing cost" />
        </Card>
        <Card title="Mean reward" subtitle="Baselines: 95% CI over incidents · PPO: ± std over seeds (tooltip)">
          <ValueBars data={rewardBars} ariaLabel="Mean reward by strategy" />
        </Card>
      </div>

      <Card
        title="Per-fault precision and recall"
        action={
          <Select value={focus} onChange={(e) => setFocus(e.target.value)} aria-label="Policy">
            {policies.map((p) => (
              <option key={p} value={p}>{label(p)}</option>
            ))}
          </Select>
        }
      >
        {focusSummary ? (
          <Table>
            <thead>
              <tr>
                <th className={th}>Fault</th>
                <th className={th}>Precision</th>
                <th className={th}>Recall</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(focusSummary.per_fault).map(([f, v]) => (
                <tr key={f} className="border-t border-line">
                  <td className={td}>{label(f)}</td>
                  <td className={td}>{pct(v.precision)}</td>
                  <td className={td}>{pct(v.recall)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No data for this policy" />
        )}
      </Card>

      {r.robustness && (
        <div className="grid gap-4 lg:grid-cols-3">
          {([["noise", "Test noise ε"], ["wrong_penalty", "Wrong-diagnosis penalty"], ["cost_multiplier", "Test cost multiplier"]] as const).map(([key, title]) => {
            const rows = r.robustness?.[key];
            if (!rows) return null;
            const names = [...new Set(rows.map((x) => String(x.policy)))];
            return (
              <Card key={key} title={`Sensitivity: ${title}`} subtitle="Mean reward; PPO is not retrained">
                <Lines
                  data={pivot(rows)}
                  xKey="param"
                  lines={names.map((n) => ({ key: n, label: label(n), color: POLICY_COLORS[n] }))}
                  height={240}
                  ariaLabel={`Mean reward as ${title} changes`}
                />
              </Card>
            );
          })}
        </div>
      )}

      <Card title="Generated figures" subtitle="Rendered from the recorded evaluation data">
        <div className="grid gap-3 sm:grid-cols-2">
          {["confusion_ppo", "confusion_cost_aware_bayes", "posterior_evolution_ppo", "training_curves"].map((f) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={f} src={api.figureUrl(evalId, `${f}.png`)} alt={label(f)} className="w-full rounded-lg border border-line bg-white" loading="lazy" />
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function ComparisonPage() {
  const evals = useAsync(() => api.evaluations(), []);
  const ready = (evals.data?.items ?? []).filter((e) => e.status === "succeeded");
  const [selected, setSelected] = useState<string | null>(null);
  const evalId = selected ?? ready[0]?.id ?? null;
  const results = useAsync(
    () => (evalId ? api.evaluationResults(evalId) : Promise.resolve(null)),
    [evalId],
  );
  const pending = (evals.data?.items ?? []).filter((e) => e.status === "queued" || e.status === "running");

  return (
    <>
      <PageHeader
        title="Algorithm comparison"
        description="PPO against fixed-order, random, information-gain and cost-aware Bayesian strategies, with uncertainty. Results below are read from recorded evaluation runs."
      />
      <div className="space-y-4">
        <RunEvaluation onStarted={evals.reload} />
        <ErrorBanner error={evals.error} onRetry={evals.reload} />
        {pending.length > 0 && (
          <p className="text-sm text-warn" role="status">
            {pending.length} evaluation(s) in progress…{" "}
            <button className="underline" onClick={evals.reload}>refresh</button>
          </p>
        )}
        {evals.loading && !evals.data && <LoadingBlock />}
        {evals.data && ready.length === 0 && (
          <EmptyState title="No completed evaluations yet">
            Train at least one model and queue an evaluation above (or run{" "}
            <code>python -m diagnoserl.evaluation.run</code> and let the worker import it).
          </EmptyState>
        )}
        {ready.length > 0 && (
          <Field label="Evaluation">
            <Select value={evalId ?? ""} onChange={(e) => setSelected(e.target.value)} className="max-w-md">
              {ready.map((e) => (
                <option key={e.id} value={e.id}>
                  {when(e.finished_at)} — {String((e.params.run_names as string[] | undefined)?.join(", ") ?? e.id)}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <ErrorBanner error={results.error} onRetry={results.reload} />
        {results.loading && evalId && !results.data && <LoadingBlock label="Loading results…" />}
        {results.data && evalId && <Results r={results.data} evalId={evalId} />}
      </div>
    </>
  );
}
