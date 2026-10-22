"use client";

import { signed } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Per-fault change in probability caused by one test: positive bars = more likely, negative = less likely. */
export function TestImpact({
  before,
  after,
  faultNames,
  limit = 6,
}: {
  before: number[];
  after: number[];
  faultNames: string[];
  limit?: number;
}) {
  const deltas = faultNames
    .map((name, i) => ({ name, delta: (after[i] ?? 0) - (before[i] ?? 0) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, limit);
  const max = Math.max(0.01, ...deltas.map((d) => Math.abs(d.delta)));
  return (
    <ul aria-label="Effect of the test on each root cause" className="space-y-1.5">
      {deltas.map((d) => (
        <li key={d.name} className="grid grid-cols-[minmax(0,8rem)_1fr_3.5rem] items-center gap-2 text-xs">
          <span className="truncate text-muted" title={d.name}>
            {d.name}
          </span>
          <span className="relative h-2 rounded-full bg-elevated">
            <span aria-hidden className="absolute inset-y-[-2px] left-1/2 w-px bg-border" />
            <span
              className={cn(
                "absolute inset-y-0 rounded-full transition-all duration-300",
                d.delta >= 0 ? "left-1/2 bg-success" : "right-1/2 bg-critical",
              )}
              style={{ width: `${(Math.abs(d.delta) / max) * 50}%` }}
            />
          </span>
          <span className={cn("text-right tabular-nums", d.delta >= 0 ? "text-success" : "text-critical")}>
            {signed(d.delta * 100, 1)}
          </span>
        </li>
      ))}
    </ul>
  );
}
