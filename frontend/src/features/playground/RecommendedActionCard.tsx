"use client";

import { UseQueryResult } from "@tanstack/react-query";
import { FlaskConical, Gavel, TriangleAlert } from "lucide-react";
import { Term } from "@/components/domain/Term";
import { policyLabel } from "@/components/charts/theme";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import type { Recommendation, Session } from "@/lib/api";
import { modelledSeconds, num, pct } from "@/lib/format";
import { actionLabel, parseExplanation } from "./derive";

/**
 * The policy's next action and why. For the RL policy the network's action preferences are shown
 * in their own clearly-labelled block, never mixed with the Bayesian root-cause probabilities.
 */
export function RecommendedActionCard({
  query,
  session,
  testNames,
}: {
  query: UseQueryResult<Recommendation>;
  session: Session;
  testNames: Map<string, string>;
}) {
  const faultNames = new Map(session.posterior.map((p) => [p.id, p.name]));
  const leader = [...session.posterior].sort((a, b) => b.probability - a.probability)[0];

  return (
    <Card>
      <CardHeader
        title="Recommended next action"
        description={`Policy: ${policyLabel(session.policy)}`}
        icon={<FlaskConical />}
      />
      <CardContent className="space-y-4">
        {query.isPending || (query.isFetching && !query.data) ? (
          <div role="status" aria-label="Loading recommendation" className="space-y-2">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} title="Could not get a recommendation" />
        ) : query.data ? (
          (() => {
            const rec = query.data;
            const ex = parseExplanation(rec);
            const isTest = rec.action.type === "test";
            const own = ex.preferences.find(
              (p) => p.action === (isTest ? rec.action.id : `declare:${rec.action.id}`),
            );
            return (
              <>
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                    {isTest ? <FlaskConical className="size-4" /> : <Gavel className="size-4" />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wider text-muted">
                      {isTest ? "Run diagnostic test" : "Declare root cause"}
                    </p>
                    <p className="text-base font-semibold leading-tight">{rec.action.name}</p>
                  </div>
                </div>

                <dl className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <dt className="text-muted">Est. cost</dt>
                    <dd className="mt-0.5 text-sm font-medium tabular-nums">{isTest ? num(rec.action.estimated_cost, 1) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Est. duration</dt>
                    <dd className="mt-0.5 text-sm font-medium tabular-nums">{isTest ? modelledSeconds(rec.action.estimated_duration) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">
                      <Term k="posterior">Leading hypothesis</Term>
                    </dt>
                    <dd className="mt-0.5 text-sm font-medium leading-tight" title={leader?.name}>
                      {leader?.name} <span className="text-muted">{pct(leader?.probability, 0)}</span>
                    </dd>
                  </div>
                </dl>

                {ex.preferences.length > 0 ? (
                  <section aria-label="Policy action preferences" className="rounded-xl border border-border bg-elevated/50 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold">
                        <Term k="actionPreference">Policy action preferences</Term>
                      </h3>
                      <Badge tone="warning">not a diagnosis confidence</Badge>
                    </div>
                    <ul className="space-y-1.5">
                      {ex.preferences.map((p) => (
                        <li key={p.action} className="grid grid-cols-[minmax(0,1fr)_5.5rem_2.75rem] items-center gap-2 text-xs">
                          <span className="truncate" title={actionLabel(p.action, testNames, faultNames)}>
                            {actionLabel(p.action, testNames, faultNames)}
                          </span>
                          <span className="h-1.5 overflow-hidden rounded-full bg-border">
                            <span className="block h-full rounded-full bg-primary" style={{ width: `${p.probability * 100}%` }} />
                          </span>
                          <span className="text-right tabular-nums text-muted">{pct(p.probability, 0)}</span>
                        </li>
                      ))}
                    </ul>
                    {own && (
                      <p className="mt-2 text-xs text-muted">
                        The network assigns {pct(own.probability, 0)} to the recommended action. This is how strongly
                        the policy prefers it, separate from the Bayesian root-cause probabilities.
                      </p>
                    )}
                    {ex.note && (
                      <p className="mt-2 flex gap-1.5 text-[11px] leading-relaxed text-muted">
                        <TriangleAlert className="mt-0.5 size-3 shrink-0 text-warning" aria-hidden />
                        {ex.note}
                      </p>
                    )}
                  </section>
                ) : ex.metrics.length > 0 ? (
                  <section aria-label="Why this action" className="rounded-xl border border-border bg-elevated/50 p-3">
                    <h3 className="mb-2 text-xs font-semibold">Why this action</h3>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
                      {ex.metrics.map((m) => (
                        <div key={m.key} className="contents">
                          <dt className="text-muted">{m.label}</dt>
                          <dd className="text-right tabular-nums">{typeof m.value === "number" ? num(m.value, 3) : m.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-2 text-[11px] text-muted">
                      Computed by the {policyLabel(rec.policy).toLowerCase()} policy from the Bayesian posterior.
                    </p>
                  </section>
                ) : (
                  <p className="text-xs text-muted">
                    This policy does not provide a justification beyond the action itself.
                  </p>
                )}
              </>
            );
          })()
        ) : null}
      </CardContent>
    </Card>
  );
}
