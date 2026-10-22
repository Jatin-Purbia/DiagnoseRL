"use client";

import { Pause, Play, RotateCcw, Square, Stethoscope } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shell/PageHeader";
import { useScenarios, usePolicies } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ChooseTestDialog, DeclareDialog, TraceDialog } from "./Dialogs";
import { CompletionSummary } from "./CompletionSummary";
import { ControlBar } from "./ControlBar";
import { currentStage } from "./derive";
import { DiagnosticTimeline } from "./DiagnosticTimeline";
import { IncidentContext } from "./IncidentContext";
import { ReasoningPanel } from "./ReasoningPanel";
import { RecommendedActionCard } from "./RecommendedActionCard";
import { StartPanel } from "./StartPanel";
import { BASE_STEP_DELAY_MS, useInvestigation } from "./useInvestigation";
import { WorkflowStepper } from "./WorkflowStepper";

/** The live diagnostic playground: incident context, investigation workflow, and AI reasoning. */
export function Playground() {
  const inv = useInvestigation();
  const scenarios = useScenarios();
  const policies = usePolicies();
  const { session, report } = inv;

  const [viewStep, setViewStep] = useState<number | null>(null);
  const [replay, setReplay] = useState<{ step: number; playing: boolean } | null>(null);
  const [dialog, setDialog] = useState<"choose" | "declare" | "trace" | null>(null);

  const latest = session?.executed.length ?? 0;
  const shownStep = replay ? replay.step : (viewStep ?? latest);

  // A different investigation resets inspection and replay state.
  useEffect(() => {
    setViewStep(null);
    setReplay(null);
  }, [inv.sessionId]);

  // Replay: step through the recorded trace on a visual timer (the trace itself never changes).
  useEffect(() => {
    if (!replay?.playing) return;
    if (replay.step >= latest) {
      setReplay((r) => (r ? { ...r, playing: false } : r));
      return;
    }
    const t = setTimeout(
      () => setReplay((r) => (r ? { ...r, step: r.step + 1 } : r)),
      BASE_STEP_DELAY_MS / inv.speed,
    );
    return () => clearTimeout(t);
  }, [replay, latest, inv.speed]);

  const testNames = useMemo(() => new Map((inv.tests ?? []).map((t) => [t.id, t.name])), [inv.tests]);
  const scenario = scenarios.data?.find((s) => s.name === session?.scenario);
  const rec = inv.recommendation;

  const stage = currentStage({
    session,
    runningTest: inv.runTest.isPending,
    declaring: inv.declare.isPending,
    loadingRecommendation: rec.isFetching && !rec.data,
  });

  const headerActions = session ? (
    <Button variant="outline" size="sm" onClick={() => inv.open(null)}>
      New investigation
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Diagnostic Playground"
        description="Start a simulated incident and watch the root-cause probabilities, costs and recommendations update as evidence arrives. The true fault stays hidden until the investigation ends."
        actions={headerActions}
      />

      {inv.sessionId && inv.sessionQ.isError && (
        <ErrorState
          className="mb-4"
          error={inv.sessionQ.error}
          title="Could not load this investigation"
          onRetry={() => inv.sessionQ.refetch()}
        />
      )}

      {session && (
        <div className="mb-4 space-y-3">
      <WorkflowStepper stage={stage} finished={session.status !== "active"} />

      {inv.active && (
        <ControlBar
          active={inv.active}
          started={session.steps > 0}
          busy={inv.busy}
          hasRecommendation={Boolean(rec.data)}
          recommendedIsTest={rec.data?.action.type === "test"}
          mode={inv.mode}
          onMode={inv.setMode}
          playing={inv.playing}
          onPlayingChange={inv.setPlaying}
          speed={inv.speed}
          onSpeed={inv.setSpeed}
          onExecuteRecommended={() => inv.followRecommendation()}
          onChooseTest={() => setDialog("choose")}
          onDeclare={() => setDialog("declare")}
          onReset={inv.reset}
          onTrace={() => setDialog("trace")}
        />
      )}

      {!inv.active && (
        <CompletionSummary
          session={session}
          report={report.data}
          replaying={Boolean(replay)}
          onReplay={() => setReplay({ step: 0, playing: true })}
        />
      )}

      {replay && (
        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Replay controls">
            <span className="mr-1 text-xs font-medium text-muted">
              Replay · step {replay.step} of {latest}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setReplay((r) => (r ? { step: r.step >= latest ? 0 : r.step, playing: !r.playing } : r))
              }
            >
              {replay.playing ? <Pause /> : <Play />} {replay.playing ? "Pause" : replay.step >= latest ? "Replay again" : "Play"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setReplay({ step: 0, playing: false })}>
              <RotateCcw /> Restart
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <span className="sr-only">Visualization speed</span>
              <select
                aria-label="Visualization speed"
                value={inv.speed}
                onChange={(e) => inv.setSpeed(Number(e.target.value))}
                className="h-8 rounded-lg border border-border bg-elevated px-2 text-xs text-ink"
              >
                {[0.5, 1, 2, 4].map((s) => (
                  <option key={s} value={s}>
                    {s}× speed
                  </option>
                ))}
              </select>
            </label>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setReplay(null)}>
              <Square /> Stop replay
            </Button>
          </div>
        </Card>
      )}

        </div>
      )}

      {/*
        Three panels from 1400px (context | timeline | reasoning). Below that the reasoning panel moves
        above the timeline so the probabilities and recommendation stay next to the evidence.
        On phones the order is reasoning, timeline, context (start form first when idle).
      */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:grid-rows-[auto_1fr] pane:grid-cols-[18rem_minmax(0,1fr)_24rem] pane:grid-rows-1">
        {/* ---- left: incident context ---- */}
        <div
          className={cn(
            "space-y-4 lg:order-none lg:row-span-2 pane:row-span-1",
            inv.sessionId ? "order-3" : "order-1",
          )}
        >
          {!inv.sessionId ? (
            <StartPanel
              scenarios={scenarios.data}
              policies={policies.data}
              loading={inv.start.isPending}
              onStart={(cfg) => inv.start.mutate(cfg)}
            />
          ) : session ? (
            <IncidentContext
              session={session}
              scenario={scenario}
              tests={inv.tests}
              startConfig={inv.startConfig}
              canRun={inv.active && !inv.busy && !replay}
              onRun={(id) => inv.runTest.mutate(id)}
            />
          ) : (
            <Skeleton className="h-96 w-full rounded-xl" />
          )}
        </div>

        {/* ---- center: investigation timeline ---- */}
        <div className="order-2 min-w-0 space-y-4 lg:order-none lg:col-start-2 lg:row-start-2 pane:row-start-1">

          {!inv.sessionId && (
            <Card>
              <CardHeader title="How an investigation works" icon={<Stethoscope />} />
              <CardContent className="space-y-4">
                <WorkflowStepper stage={0} finished={false} />
                <p className="text-sm leading-relaxed text-muted">
                  A root cause is hidden in the simulation. Each diagnostic test costs time and money and returns a
                  noisy result. After every result a Bayesian posterior updates the probability of each cause, and the
                  policy decides whether another test is worth its cost or whether to declare. Choose a scenario and
                  policy on the left to begin, then step through manually or let the agent drive.
                </p>
              </CardContent>
            </Card>
          )}

          {session && (
            <>
              <Card>
                <CardHeader
                  title="Diagnostic timeline"
                  description={
                    session.executed.length === 0
                      ? "No tests yet. Run the recommended test or choose your own."
                      : "Select an entry to inspect the belief at that step."
                  }
                  action={
                    viewStep !== null && !replay && viewStep !== latest ? (
                      <Button variant="ghost" size="sm" onClick={() => setViewStep(null)}>
                        Back to latest
                      </Button>
                    ) : undefined
                  }
                />
                <CardContent>
                  <DiagnosticTimeline
                    session={session}
                    report={report.data}
                    selectedStep={shownStep}
                    visibleUpTo={replay ? replay.step : null}
                    onSelect={(s) => {
                      if (replay) setReplay({ step: s, playing: false });
                      else setViewStep(s === latest ? null : s);
                    }}
                  />
                </CardContent>
              </Card>
            </>
          )}

          {!session && inv.sessionId && inv.sessionQ.isPending && <Skeleton className="h-72 w-full rounded-xl" />}
        </div>

        {/* ---- right: reasoning ---- */}
        <div className="order-1 min-w-0 space-y-4 lg:order-none lg:col-start-2 lg:row-start-1 pane:col-start-3">
          {session ? (
            <>
              <ReasoningPanel
                session={session}
                viewStep={shownStep}
                onViewStep={(s) => {
                  if (replay) setReplay({ step: s, playing: false });
                  else setViewStep(s === latest ? null : s);
                }}
              />
              {inv.active && <RecommendedActionCard query={rec} session={session} testNames={testNames} />}
            </>
          ) : (
            <EmptyState title="Root-cause probabilities will appear here" icon={<Stethoscope />}>
              Once an investigation starts you will see the Bayesian probability of every candidate cause, how each
              test changed it, and the policy&apos;s recommended next action.
            </EmptyState>
          )}
        </div>
      </div>

      {session && inv.tests && (
        <ChooseTestDialog
          open={dialog === "choose"}
          onOpenChange={(o) => setDialog(o ? "choose" : null)}
          tests={inv.tests}
          busy={inv.busy}
          onChoose={(id) => inv.runTest.mutate(id)}
        />
      )}
      {session && (
        <>
          <DeclareDialog
            open={dialog === "declare"}
            onOpenChange={(o) => setDialog(o ? "declare" : null)}
            session={session}
            busy={inv.declare.isPending}
            onDeclare={(id) => inv.declare.mutate(id)}
          />
          <TraceDialog
            open={dialog === "trace"}
            onOpenChange={(o) => setDialog(o ? "trace" : null)}
            session={session}
            report={report.data}
          />
        </>
      )}
    </>
  );
}
