"use client";

import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SkeletonRows } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/states";
import { api } from "@/lib/api";
import { keys } from "@/lib/queries";

interface LogLine {
  ts?: string;
  level?: string;
  msg?: string;
  [k: string]: unknown;
}

function format(line: string): string {
  try {
    const o = JSON.parse(line) as LogLine;
    const { ts, level, msg, logger: _l, ...rest } = o;
    void _l;
    const extra = Object.entries(rest)
      .map(([k, v]) => `${k}=${typeof v === "number" ? Number(v.toPrecision(5)) : String(v)}`)
      .join(" ");
    const time = ts ? new Date(ts).toLocaleTimeString() : "";
    return `${time} ${String(level ?? "").padEnd(5)} ${msg ?? ""} ${extra}`.trim();
  } catch {
    return line;
  }
}

/** Structured training log. Refreshes while the dialog is open and the run is live. */
export function LogsDialog({
  expId,
  open,
  onOpenChange,
  live,
}: {
  expId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  live: boolean;
}) {
  const q = useQuery({
    queryKey: keys.experimentLogs(expId),
    queryFn: ({ signal }) => api.experimentLogs(expId, 300, signal),
    enabled: open,
    refetchInterval: open && live ? 3_000 : false,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Training log"
        description="Most recent entries recorded by the training run."
        className="max-w-3xl"
      >
        <div className="p-4">
          {q.isPending ? (
            <SkeletonRows rows={5} />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data.available || q.data.lines.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">
              No log was recorded for this run. Logs are kept for runs trained after logging was added.
            </p>
          ) : (
            <pre
              tabIndex={0}
              aria-label="Training log lines"
              className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-bg p-3 font-mono text-[11px] leading-relaxed"
            >
              {q.data.lines.map(format).join("\n")}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
