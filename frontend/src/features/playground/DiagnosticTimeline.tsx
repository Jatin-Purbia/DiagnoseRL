"use client";

import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, CircleAlert, Flag, Siren } from "lucide-react";
import { Badge, OutcomeBadge } from "@/components/ui/badge";
import type { Report, Session } from "@/lib/api";
import { label, modelledSeconds, num, signed, timeOfDay, dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { testImpact } from "./derive";

/** One animated entry per executed test. Click an entry to inspect the belief at that step. */
export function DiagnosticTimeline({
  session,
  report,
  selectedStep,
  onSelect,
  visibleUpTo,
}: {
  session: Session;
  report?: Report | undefined;
  selectedStep: number;
  onSelect: (step: number) => void;
  /** During replay, entries after this step are shown dimmed. */
  visibleUpTo?: number | null;
}) {
  const names = session.posterior.map((p) => p.name);
  const finished = session.status !== "active";
  return (
    <ol aria-label="Diagnostic timeline" className="relative space-y-2 pl-6 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-border">
      <li className="relative">
        <span className="absolute -left-6 top-2 grid size-[22px] place-items-center rounded-full border border-border bg-surface text-warning">
          <Siren className="size-3" aria-hidden />
        </span>
        <button
          type="button"
          onClick={() => onSelect(0)}
          aria-pressed={selectedStep === 0}
          className={cn(
            "w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:border-primary/40",
            selectedStep === 0 ? "border-primary/50 bg-primary/5" : "border-border bg-surface",
          )}
        >
          <span className="font-medium">Incident detected</span>
          <span className="ml-2 text-xs text-muted">{dateTime(session.created_at)}</span>
          <p className="mt-0.5 text-xs text-muted">
            {session.fault_ids.length} candidate root causes, all still possible. Click to see the prior belief.
          </p>
        </button>
      </li>

      <AnimatePresence initial={false}>
        {session.executed.map((e) => {
          const impact = testImpact(e, names);
          const dimmed = visibleUpTo !== null && visibleUpTo !== undefined && e.step > visibleUpTo;
          return (
            <motion.li
              key={e.step}
              layout="position"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: dimmed ? 0.35 : 1, y: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="relative"
            >
              <span className="absolute -left-6 top-2 grid size-[22px] place-items-center rounded-full border border-border bg-surface text-[10px] font-semibold text-muted">
                {e.step}
              </span>
              <button
                type="button"
                onClick={() => onSelect(e.step)}
                aria-pressed={selectedStep === e.step}
                className={cn(
                  "w-full rounded-xl border px-3 py-2.5 text-left transition-colors hover:border-primary/40",
                  selectedStep === e.step ? "border-primary/50 bg-primary/5" : "border-border bg-surface",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{e.test_name}</span>
                  <OutcomeBadge outcome={e.outcome} />
                  {e.followed_recommendation !== null && (
                    <Badge tone={e.followed_recommendation ? "primary" : "neutral"}>
                      {e.followed_recommendation ? "followed policy" : "own choice"}
                    </Badge>
                  )}
                </div>
                <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                  <div className="flex gap-1">
                    <dt>Duration</dt>
                    <dd className="text-ink tabular-nums">{modelledSeconds(e.duration)}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>Cost</dt>
                    <dd className="text-ink tabular-nums">{num(e.cost, 1)}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>At</dt>
                    <dd className="text-ink tabular-nums">{timeOfDay(e.executed_at)}</dd>
                  </div>
                </dl>
                <p className="mt-1.5 text-xs text-muted">
                  <span className="text-ink">Impact:</span> {impact.fault}{" "}
                  <span className={impact.deltaPoints >= 0 ? "text-success" : "text-critical"}>
                    {signed(impact.deltaPoints, 1)} pts
                  </span>
                  {" · "}uncertainty{" "}
                  <span className={impact.entropyDelta <= 0 ? "text-success" : "text-critical"}>
                    {signed(impact.entropyDelta, 2)} bits
                  </span>
                  {" · "}leader {impact.leader} ({(impact.leaderProbability * 100).toFixed(0)}%)
                </p>
              </button>
            </motion.li>
          );
        })}

        {finished && (
          <motion.li
            key="diagnosis"
            layout="position"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: visibleUpTo !== null && visibleUpTo !== undefined && visibleUpTo < session.executed.length ? 0.35 : 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="relative"
          >
            <span
              className={cn(
                "absolute -left-6 top-2 grid size-[22px] place-items-center rounded-full border bg-surface",
                session.status === "truncated" ? "border-critical/40 text-critical" : report?.correct ? "border-success/40 text-success" : "border-critical/40 text-critical",
              )}
            >
              {report?.correct ? <CheckCircle2 className="size-3" aria-hidden /> : session.status === "truncated" ? <CircleAlert className="size-3" aria-hidden /> : <Flag className="size-3" aria-hidden />}
            </span>
            <div className="rounded-xl border border-border bg-surface px-3 py-2.5 text-sm">
              {session.status === "truncated" ? (
                <p className="font-medium text-critical">Step limit reached — no diagnosis declared</p>
              ) : report ? (
                <p className="font-medium">
                  Diagnosis: {label(report.declared_fault ?? "—")}{" "}
                  <Badge tone={report.correct ? "success" : "critical"}>{report.correct ? "correct" : "incorrect"}</Badge>
                </p>
              ) : (
                <p className="font-medium">Diagnosis declared</p>
              )}
            </div>
          </motion.li>
        )}
      </AnimatePresence>
    </ol>
  );
}
