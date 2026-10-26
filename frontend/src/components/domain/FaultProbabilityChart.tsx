"use client";

import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";

interface FaultBar {
  id: string;
  name: string;
  probability: number;
}

/**
 * Animated horizontal bars of the Bayesian posterior over root causes.
 * All values come from the backend's Bayesian engine; `previous` (optional) draws the change since
 * the prior step as a small delta so the effect of each test is visible.
 */
export function FaultProbabilityChart({
  faults,
  previous,
  limit = 8,
  className,
  onSelect,
  selectedId,
}: {
  faults: FaultBar[];
  previous?: number[];
  limit?: number;
  className?: string;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => {
    const withIndex = faults.map((f, i) => ({ ...f, index: i }));
    return withIndex.sort((a, b) => b.probability - a.probability);
  }, [faults]);
  const shown = expanded ? rows : rows.slice(0, limit);
  const leader = rows[0]?.id;

  return (
    <div className={cn("space-y-2", className)}>
      <ul aria-label="Root-cause probabilities" className="space-y-1.5">
        {shown.map((f) => {
          const delta = previous ? f.probability - (previous[f.index] ?? 0) : null;
          const isLeader = f.id === leader;
          const Row = onSelect ? "button" : "div";
          return (
            <li key={f.id}>
              <Row
                {...(onSelect
                  ? { type: "button" as const, onClick: () => onSelect(f.id), "aria-pressed": selectedId === f.id }
                  : {})}
                className={cn(
                  "block w-full rounded-lg px-1.5 py-1 text-left text-xs",
                  onSelect && "cursor-pointer transition-colors hover:bg-elevated",
                  selectedId === f.id && "bg-elevated",
                )}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cn("min-w-0 break-words", isLeader ? "font-semibold text-ink" : "text-muted")}>
                    {f.name}
                  </span>
                  <span className="flex shrink-0 items-baseline gap-1.5 tabular-nums">
                    <span className={cn("font-medium", isLeader && "text-ink")}>{pct(f.probability, 1)}</span>
                    {delta !== null && Math.abs(delta) >= 0.0005 && (
                      <span
                        className={cn("text-[10px]", delta > 0 ? "text-success" : "text-critical")}
                        aria-label={`${delta > 0 ? "up" : "down"} ${Math.abs(delta * 100).toFixed(1)} points`}
                      >
                        {delta > 0 ? "▲" : "▼"}
                        {Math.abs(delta * 100).toFixed(1)}
                      </span>
                    )}
                  </span>
                </span>
                <span className="relative mt-1 block h-2 overflow-hidden rounded-full bg-elevated">
                  <motion.span
                    className={cn("absolute inset-y-0 left-0 rounded-full", isLeader ? "bg-primary" : "bg-secondary/70")}
                    initial={false}
                    animate={{ width: `${Math.max(0, Math.min(1, f.probability)) * 100}%` }}
                    transition={{ type: "spring", stiffness: 140, damping: 22 }}
                  />
                </span>
              </Row>
            </li>
          );
        })}
      </ul>
      {rows.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-xs font-medium text-primary hover:underline"
        >
          {expanded ? "Show fewer" : `Show all ${rows.length} root causes`}
        </button>
      )}
    </div>
  );
}
