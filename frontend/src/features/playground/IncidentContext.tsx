"use client";

import { Gauge, Info, Lock, Siren } from "lucide-react";
import { Term } from "@/components/domain/Term";
import { policyLabel } from "@/components/charts/theme";
import { Badge, OutcomeBadge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tip } from "@/components/ui/tooltip";
import type { ScenarioSummary, Session, TestInfo } from "@/lib/api";
import { dateTime, label, modelledSeconds, num, shortId } from "@/lib/format";
import type { StartConfig } from "./useInvestigation";

/** Left panel: what the incident is, how much budget is used, and which tests are available. */
export function IncidentContext({
  session,
  scenario,
  tests,
  startConfig,
  canRun,
  onRun,
}: {
  session: Session;
  scenario: ScenarioSummary | undefined;
  tests: TestInfo[] | undefined;
  startConfig: StartConfig | null;
  canRun: boolean;
  onRun: (testId: string) => void;
}) {
  const done = new Map(session.executed.map((e) => [e.test_id, e]));
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`Incident ${shortId(session.id)}`}
          description={scenario?.description || session.scenario}
          icon={<Siren />}
          action={<StatusBadge status={session.status} />}
        />
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
            <dt className="text-muted">Scenario</dt>
            <dd className="text-right font-medium">{session.scenario}</dd>
            <dt className="text-muted">
              <Term k="policy">Policy</Term>
            </dt>
            <dd className="text-right font-medium">{policyLabel(session.policy)}</dd>
            {startConfig && (
              <>
                <dt className="text-muted">Seed</dt>
                <dd className="text-right font-mono">{startConfig.seed}</dd>
              </>
            )}
            <dt className="text-muted">Started</dt>
            <dd className="text-right">{dateTime(session.created_at)}</dd>
          </dl>
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-elevated/70 p-2.5 text-[11px] leading-relaxed text-muted">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Severity, affected service and initial symptoms are <strong className="text-ink">not modelled</strong> in
              this simulation, so none are shown. The hidden root cause is revealed only when the investigation ends.
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Investigation budget" icon={<Gauge />} description="Costs and times are modelled units, not wall-clock." />
        <CardContent className="space-y-3">
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-muted">Steps used</span>
              <span className="tabular-nums">
                {session.steps} / {session.max_steps}
              </span>
            </div>
            <Progress
              value={session.steps}
              max={session.max_steps}
              label="Steps used"
              tone={session.steps >= session.max_steps - 1 && session.status === "active" ? "warning" : "primary"}
            />
            {session.status === "active" && session.steps >= session.max_steps - 1 && (
              <p className="mt-1.5 text-[11px] text-warning">
                Last step: another test would end the investigation without a diagnosis.
              </p>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-muted">
                <Term k="modelled">Testing cost</Term>
              </dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums">{num(session.cost, 1)}</dd>
            </div>
            <div>
              <dt className="text-muted">Elapsed (modelled)</dt>
              <dd className="mt-0.5 text-base font-semibold tabular-nums">{modelledSeconds(session.elapsed)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Diagnostic tests" description={`${session.executed.length} of ${tests?.length ?? "…"} run`} />
        <CardContent className="pt-3">
          {!tests ? (
            <div role="status" aria-label="Loading tests" className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {tests.map((t) => {
                const result = done.get(t.id);
                const locked = !t.available && !t.executed;
                return (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium" title={t.name}>
                        {t.name}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                        <Badge>{t.category}</Badge>
                        <span className="tabular-nums">cost {num(t.cost, 0)}</span>
                        <span className="tabular-nums">{modelledSeconds(t.duration)}</span>
                      </p>
                    </div>
                    {result ? (
                      <OutcomeBadge outcome={result.outcome} />
                    ) : locked ? (
                      <Tip
                        content={
                          session.status !== "active"
                            ? "The investigation has ended."
                            : t.requires.length
                              ? `Requires ${t.requires.map(label).join(", ")} first.`
                              : "Not available."
                        }
                      >
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted">
                          <Lock className="size-3" aria-hidden />
                          {session.status === "active" ? "locked" : "—"}
                        </span>
                      </Tip>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!canRun || !t.available}
                        onClick={() => onRun(t.id)}
                        aria-label={`Run ${t.name}`}
                      >
                        Run
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
