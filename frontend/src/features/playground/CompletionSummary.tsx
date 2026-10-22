"use client";

import { motion } from "motion/react";
import { CheckCircle2, CircleAlert, History, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Report, Session } from "@/lib/api";
import { dateTime, label, modelledSeconds, num } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Result of a finished investigation. The true root cause is shown because the simulation has ended. */
export function CompletionSummary({
  session,
  report,
  onReplay,
  replaying,
}: {
  session: Session;
  report: Report | undefined;
  onReplay: () => void;
  replaying: boolean;
}) {
  const truncated = session.status === "truncated";
  const correct = report?.correct === true;
  const tone = truncated ? "critical" : correct ? "success" : "critical";
  const Icon = truncated ? CircleAlert : correct ? CheckCircle2 : XCircle;
  const headline = truncated
    ? "Step limit reached — no diagnosis"
    : correct
      ? "Correct diagnosis"
      : "Incorrect diagnosis";

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}>
      <Card className={cn("overflow-hidden", tone === "success" ? "border-success/40" : "border-critical/40")}>
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 px-5 py-4",
            tone === "success" ? "bg-success/8" : "bg-critical/8",
          )}
        >
          <div className="flex items-center gap-3">
            <Icon className={cn("size-6", tone === "success" ? "text-success" : "text-critical")} aria-hidden />
            <div>
              <h2 className="text-base font-semibold">{headline}</h2>
              <p className="text-xs text-muted">Completed {dateTime(session.completed_at)}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onReplay} disabled={replaying || session.executed.length === 0}>
            <History /> Replay investigation
          </Button>
        </div>
        <CardContent className="pt-4">
          {report ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-xs sm:grid-cols-3 xl:grid-cols-6">
              <Fact label="Predicted root cause" value={report.declared_fault ? label(report.declared_fault) : "none declared"} />
              <Fact label="Actual root cause" value={report.true_fault_name} hint="simulation only" />
              <Fact label="Tests executed" value={String(session.executed.length)} />
              <Fact label="Total duration (modelled)" value={modelledSeconds(session.elapsed)} />
              <Fact label="Total cost" value={num(session.cost, 1)} />
              <Fact
                label="Episode reward"
                value={<Badge tone={session.total_reward >= 0 ? "success" : "critical"}>{num(session.total_reward, 2)}</Badge>}
              />
            </dl>
          ) : (
            <p className="text-sm text-muted">Loading the final report…</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function Fact({ label: l, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <dt className="text-muted">{l}</dt>
      <dd className="mt-1 text-sm font-semibold">{value}</dd>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
