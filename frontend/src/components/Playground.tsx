"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { label, num, pct, secs } from "@/lib/format";
import { useAsync } from "@/lib/hooks";
import type { ExecutedTest, Recommendation, Report, Session, TestInfo } from "@/lib/types";
import { HBars, Lines } from "./charts";
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
  statusTone,
  Table,
  td,
  th,
} from "./ui";

const outcomeTone = (o: string) =>
  o === "PASS" ? "good" : o === "FAIL" ? "bad" : o === "DEGRADED" ? "warn" : "neutral";

function topChange(step: ExecutedTest, faultNames: string[]): string {
  let best = 0;
  let delta = 0;
  step.posterior_after.forEach((p, i) => {
    const d = p - (step.posterior_before[i] ?? 0);
    if (Math.abs(d) > Math.abs(delta)) {
      delta = d;
      best = i;
    }
  });
  const name = faultNames[best] ?? "?";
  return `${name} ${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)} pts`;
}

function ExplanationView({ rec }: { rec: Recommendation }) {
  const ex = rec.explanation as Record<string, unknown>;
  const topActions = ex.top_actions as { action: string; probability: number }[] | undefined;
  const note = typeof ex.note === "string" ? ex.note : null;
  const scalars = Object.entries(ex).filter(
    ([k, v]) => k !== "top_actions" && k !== "note" && (typeof v === "number" || typeof v === "string"),
  );
  return (
    <div className="space-y-2 text-xs">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
        {scalars.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{label(k)}</dt>
            <dd className="tabular-nums">{typeof v === "number" ? num(v, 3) : String(v)}</dd>
          </div>
        ))}
      </dl>
      {topActions && (
        <ul className="space-y-0.5">
          {topActions.map((a) => (
            <li key={a.action} className="flex justify-between gap-2">
              <span>{a.action}</span>
              <span className="tabular-nums text-muted">{pct(a.probability)}</span>
            </li>
          ))}
        </ul>
      )}
      {note && <p className="rounded-md border border-line bg-panel-2 p-2 text-muted">{note}</p>}
    </div>
  );
}

export function Playground() {
  const scenarios = useAsync(() => api.scenarios(), []);
  const policies = useAsync(() => api.policies(), []);

  const [scenario, setScenario] = useState("standard");
  const [policy, setPolicy] = useState("cost_aware_bayes");
  const [seed, setSeed] = useState("");

  const [session, setSession] = useState<Session | null>(null);
  const [tests, setTests] = useState<TestInfo[]>([]);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declareChoice, setDeclareChoice] = useState("");

  // Keep the selection valid: if the chosen scenario is not offered, fall back to the first one.
  useEffect(() => {
    const names = scenarios.data?.map((s) => s.name);
    if (names && names.length > 0 && !names.includes(scenario)) setScenario(names[0] as string);
  }, [scenarios.data, scenario]);

  const ppoOk = policies.data?.ppo_available_for_scenarios.includes(scenario) ?? false;

  const loadAround = useCallback(async (s: Session) => {
    if (s.status === "active") {
      const [t, r] = await Promise.all([api.sessionTests(s.id), api.recommendation(s.id)]);
      setTests(t);
      setRec(r);
      setReport(null);
    } else {
      setTests(await api.sessionTests(s.id));
      setRec(null);
      setReport(await api.report(s.id));
    }
  }, []);

  const guarded = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError && e.code === "stale_step") {
        setError("The session changed elsewhere; state was refreshed.");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const start = () =>
    guarded(async () => {
      const parsedSeed = seed.trim() === "" ? undefined : Number(seed);
      if (parsedSeed !== undefined && (!Number.isInteger(parsedSeed) || parsedSeed < 0)) {
        throw new Error("Seed must be a non-negative integer.");
      }
      const s = await api.createSession({ scenario, policy, seed: parsedSeed });
      setSession(s);
      setDeclareChoice(s.posterior[0]?.id ?? "");
      await loadAround(s);
    });

  const runTest = (testId: string) =>
    guarded(async () => {
      if (!session) return;
      try {
        const res = await api.executeTest(session.id, testId, session.steps);
        setSession(res.session);
        await loadAround(res.session);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const fresh = await api.session(session.id);
          setSession(fresh);
          await loadAround(fresh);
        }
        throw e;
      }
    });

  const declare = (faultId: string) =>
    guarded(async () => {
      if (!session) return;
      const res = await api.declare(session.id, faultId);
      setSession(res.session);
      await loadAround(res.session);
    });

  const followRecommendation = () => {
    if (!rec) return;
    return rec.action.type === "test" ? runTest(rec.action.id) : declare(rec.action.id);
  };

  const faultNames = session?.posterior.map((p) => p.name) ?? [];
  const posteriorData = [...(session?.posterior ?? [])]
    .sort((a, b) => b.probability - a.probability)
    .map((p, i) => ({ name: p.name, value: p.probability, highlight: i === 0 }));
  const finished = session !== null && session.status !== "active";

  return (
    <>
      <PageHeader
        title="Live diagnostic playground"
        description="Start a simulated incident, choose a policy, and watch the belief over root causes change as you run diagnostic tests. The true fault stays hidden until you declare (or the investigation runs out of steps)."
      />

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <Card title="New investigation">
            {scenarios.error && <ErrorBanner error={scenarios.error} onRetry={scenarios.reload} />}
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void start();
              }}
            >
              <Field label="Scenario">
                <Select value={scenario} onChange={(e) => setScenario(e.target.value)}>
                  {(scenarios.data ?? [{ name: "standard" } as { name: string }]).map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Diagnostic policy"
                hint={
                  policy === "ppo" && !ppoOk
                    ? "No active RL model for this scenario."
                    : "Used for the recommended next action."
                }
              >
                <Select value={policy} onChange={(e) => setPolicy(e.target.value)}>
                  {(policies.data?.policies ?? ["cost_aware_bayes"]).map((p) => (
                    <option key={p} value={p} disabled={p === "ppo" && !ppoOk}>
                      {label(p)}
                      {p === "ppo" && !ppoOk ? " (no active model)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Incident seed (optional)" hint="Same seed, same incident.">
                <Input
                  inputMode="numeric"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="random"
                />
              </Field>
              <Button type="submit" loading={busy && !session} disabled={busy}>
                Start investigation
              </Button>
            </form>
          </Card>

          {session && (
            <Card
              title="Diagnostic tests"
              subtitle={`Step ${session.steps} of ${session.max_steps} · cost ${num(session.cost, 1)} · ${secs(session.elapsed)}`}
            >
              <Table>
                <thead>
                  <tr>
                    <th className={th}>Test</th>
                    <th className={th}>Cost</th>
                    <th className={th}>Time</th>
                    <th className={th}>
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t) => {
                    const done = session.executed.find((e) => e.test_id === t.id);
                    return (
                      <tr key={t.id} className="border-t border-line">
                        <td className={td}>
                          <div className="font-medium">{t.name}</div>
                          {t.requires.length > 0 && !t.executed && !t.available && (
                            <div className="text-[11px] text-muted">
                              needs {t.requires.map(label).join(", ")}
                            </div>
                          )}
                        </td>
                        <td className={td}>{t.cost}</td>
                        <td className={td}>{t.duration}s</td>
                        <td className={`${td} text-right`}>
                          {done ? (
                            <Badge tone={outcomeTone(done.outcome)}>{done.outcome}</Badge>
                          ) : (
                            <Button
                              variant="secondary"
                              className="!px-2 !py-0.5 text-xs"
                              disabled={!t.available || busy || finished}
                              onClick={() => void runTest(t.id)}
                              aria-label={`Run ${t.name}`}
                            >
                              Run
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <ErrorBanner error={error} />
          {!session && (
            <EmptyState title="No investigation running">
              Choose a scenario and policy, then start. Every number on this page comes from the
              backend.
            </EmptyState>
          )}
          {session && (
            <>
              <Card
                title="Suspected root causes"
                subtitle={`Entropy ${num(session.entropy_bits, 2)} bits · top confidence ${pct(session.confidence)}`}
                action={<Badge tone={statusTone(session.status)}>{session.status}</Badge>}
              >
                <HBars
                  data={posteriorData}
                  ariaLabel="Posterior probability of each candidate root cause"
                />
              </Card>

              {!finished && rec && (
                <Card
                  title="Recommended next action"
                  subtitle={`Policy: ${label(rec.policy)}`}
                  action={
                    <Button onClick={() => void followRecommendation()} loading={busy}>
                      {rec.action.type === "test" ? "Run recommended test" : "Declare as recommended"}
                    </Button>
                  }
                >
                  <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Metric
                      label={rec.action.type === "test" ? "Run test" : "Declare fault"}
                      value={rec.action.name}
                    />
                    <Metric label="Est. cost" value={num(rec.action.estimated_cost, 1)} />
                    <Metric label="Est. duration" value={secs(rec.action.estimated_duration)} />
                    <Metric label="Current confidence" value={pct(rec.confidence)} />
                  </div>
                  <ExplanationView rec={rec} />
                </Card>
              )}

              {!finished && (
                <Card title="Declare a root cause">
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="Fault">
                      <Select
                        value={declareChoice}
                        onChange={(e) => setDeclareChoice(e.target.value)}
                        aria-label="Fault to declare"
                      >
                        {session.posterior.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({pct(p.probability)})
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button
                      variant="secondary"
                      disabled={!declareChoice || busy}
                      onClick={() => void declare(declareChoice)}
                    >
                      Declare root cause
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    Declaring ends the investigation. Running out of steps without declaring counts
                    as no diagnosis.
                  </p>
                </Card>
              )}

              {finished && report && <ReportCard report={report} />}

              <Card title="Investigation trace" subtitle="Each test and how it moved the belief">
                {session.executed.length === 0 ? (
                  <p className="text-sm text-muted">No tests run yet.</p>
                ) : (
                  <ol className="space-y-2">
                    {session.executed.map((e) => (
                      <li
                        key={e.step}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm"
                      >
                        <span className="text-xs text-muted">#{e.step}</span>
                        <span className="font-medium">{e.test_name}</span>
                        <Badge tone={outcomeTone(e.outcome)}>{e.outcome}</Badge>
                        <span className="text-xs text-muted">{topChange(e, faultNames)}</span>
                        {e.followed_recommendation !== null && (
                          <Badge tone={e.followed_recommendation ? "accent" : "neutral"}>
                            {e.followed_recommendation ? "followed policy" : "own choice"}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </>
          )}
          {policies.loading && !policies.data && <LoadingBlock label="Loading policies…" />}
        </div>
      </div>
    </>
  );
}

function Metric({ label: l, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-muted">{l}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function ReportCard({ report }: { report: Report }) {
  const names = report.session.posterior.map((p) => p.name);
  const top = report.session.posterior
    .slice()
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 4);
  const topIdx = top.map((t) => report.session.posterior.findIndex((p) => p.id === t.id));
  const trace = report.posterior_trace.map((s) => ({
    step: s.step,
    ...Object.fromEntries(topIdx.map((i) => [names[i] ?? `f${i}`, s.posterior[i] ?? 0])),
  }));
  return (
    <Card
      title="Final diagnostic report"
      action={
        <Badge tone={report.correct ? "good" : "bad"}>
          {report.timeout ? "no diagnosis (step limit)" : report.correct ? "correct" : "incorrect"}
        </Badge>
      }
    >
      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="True root cause" value={report.true_fault_name} />
        <Metric
          label="Declared"
          value={report.declared_fault ? label(report.declared_fault) : "none"}
        />
        <Metric label="Total cost" value={num(report.session.cost, 1)} />
        <Metric label="Episode reward" value={num(report.session.total_reward, 2)} />
      </dl>
      <Lines
        data={trace}
        xKey="step"
        xLabel="step"
        lines={topIdx.map((i) => ({ key: names[i] ?? `f${i}`, label: names[i] ?? `f${i}` }))}
        yFormatter={(v) => `${Math.round(v * 100)}%`}
        ariaLabel="Posterior probability of the leading faults after each step"
      />
    </Card>
  );
}
