"use client";

import Link from "next/link";
import { POLICY_COLORS, ValueBars } from "@/components/charts";
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  StatTile,
  statusTone,
  Table,
  td,
  th,
} from "@/components/ui";
import { api } from "@/lib/api";
import { label, num, pct, secs, when } from "@/lib/format";
import { useAsync } from "@/lib/hooks";

export default function OverviewPage() {
  const { data, error, loading, reload } = useAsync(() => api.overview(), []);

  return (
    <>
      <PageHeader
        title="Overview"
        description="Live statistics from diagnostic sessions and the latest strategy evaluation."
      />
      <ErrorBanner error={error} onRetry={reload} />
      {loading && !data && <LoadingBlock />}
      {data && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile label="Sessions" value={data.total_sessions} hint={`${data.finished_sessions} finished`} />
            <StatTile label="Diagnosis rate" value={pct(data.success_rate)} hint="correct / declared" />
            <StatTile label="Avg. tests" value={num(data.avg_tests, 1)} />
            <StatTile label="Avg. time" value={secs(data.avg_duration)} />
            <StatTile label="Avg. cost" value={num(data.avg_cost, 1)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Active model" subtitle="RL policy used for the “ppo” recommendation policy">
              {data.active_models.length === 0 ? (
                <EmptyState title="No active model">
                  Train a model, register it, and activate it from the{" "}
                  <Link href="/experiments" className="text-accent underline">
                    Experiments
                  </Link>{" "}
                  page.
                </EmptyState>
              ) : (
                <ul className="space-y-1.5">
                  {data.active_models.map((m) => (
                    <li key={m.id} className="flex items-center justify-between text-sm">
                      <span>{m.name}</span>
                      <Badge tone="accent">{m.scenario}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Recent sessions">
              {data.recent_sessions.length === 0 ? (
                <EmptyState title="No sessions yet">
                  Start one in the{" "}
                  <Link href="/playground" className="text-accent underline">
                    Playground
                  </Link>
                  .
                </EmptyState>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th className={th}>Started</th>
                      <th className={th}>Scenario</th>
                      <th className={th}>Policy</th>
                      <th className={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_sessions.map((s) => (
                      <tr key={s.id} className="border-t border-line">
                        <td className={td}>{when(s.created_at)}</td>
                        <td className={td}>{s.scenario}</td>
                        <td className={td}>{label(s.policy)}</td>
                        <td className={td}>
                          <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </div>

          <Card
            title="Strategy comparison"
            subtitle="Mean reward per episode on the held-out test incidents of the latest evaluation"
            action={
              <Link href="/comparison" className="text-xs text-accent underline">
                Details
              </Link>
            }
          >
            {data.strategy_comparison.length === 0 ? (
              <EmptyState title="No evaluation yet">
                Run an evaluation from the Comparison page once a model has been trained.
              </EmptyState>
            ) : (
              <ValueBars
                ariaLabel="Mean reward by strategy"
                data={data.strategy_comparison.map((r) => ({
                  name: label(String(r.policy)),
                  value: Number(r.mean_reward ?? 0),
                  color: POLICY_COLORS[String(r.policy)],
                }))}
              />
            )}
          </Card>

          {data.by_policy.length > 0 && (
            <Card title="Interactive sessions by policy" subtitle="From sessions run in this deployment">
              <Table>
                <thead>
                  <tr>
                    <th className={th}>Policy</th>
                    <th className={th}>Sessions</th>
                    <th className={th}>Accuracy</th>
                    <th className={th}>Mean reward</th>
                    <th className={th}>Mean cost</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_policy.map((p) => (
                    <tr key={p.policy} className="border-t border-line">
                      <td className={td}>{label(p.policy)}</td>
                      <td className={td}>{p.sessions}</td>
                      <td className={td}>{pct(p.accuracy)}</td>
                      <td className={td}>{num(p.mean_reward)}</td>
                      <td className={td}>{num(p.mean_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
