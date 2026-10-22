import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "primary" | "secondary" | "success" | "warning" | "critical";

const TONES: Record<Tone, string> = {
  neutral: "border-border bg-elevated text-muted",
  primary: "border-primary/30 bg-primary/10 text-primary",
  secondary: "border-secondary/30 bg-secondary/10 text-secondary",
  success: "border-success/30 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  critical: "border-critical/30 bg-critical/10 text-critical",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

const STATUS: Record<string, { tone: Tone; label: string }> = {
  succeeded: { tone: "success", label: "Succeeded" },
  declared: { tone: "success", label: "Declared" },
  running: { tone: "primary", label: "Running" },
  active: { tone: "primary", label: "Active" },
  queued: { tone: "warning", label: "Queued" },
  failed: { tone: "critical", label: "Failed" },
  truncated: { tone: "critical", label: "Step limit" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

/** Consistent status chip for sessions, jobs and evaluations. */
export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: "neutral" as Tone, label: status };
  return (
    <Badge tone={s.tone}>
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full bg-current",
          (status === "running" || status === "active") && "motion-safe:animate-pulse",
        )}
      />
      {s.label}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const tone: Tone =
    outcome === "PASS" ? "success" : outcome === "FAIL" ? "critical" : outcome === "DEGRADED" ? "warning" : "neutral";
  return <Badge tone={tone}>{outcome}</Badge>;
}
