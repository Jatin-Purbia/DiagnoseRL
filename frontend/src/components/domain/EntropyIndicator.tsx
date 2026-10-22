"use client";

import { Term } from "@/components/domain/Term";
import { num } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Remaining uncertainty about the root cause, in bits, relative to the maximum for this scenario. */
export function EntropyIndicator({
  bits,
  nFaults,
  className,
}: {
  bits: number;
  nFaults: number;
  className?: string;
}) {
  const max = Math.log2(Math.max(2, nFaults));
  const ratio = Math.min(1, Math.max(0, bits / max));
  const tone = ratio < 0.35 ? "bg-success" : ratio < 0.7 ? "bg-warning" : "bg-critical";
  return (
    <div className={cn("text-xs", className)}>
      <div className="mb-1 flex items-baseline justify-between text-muted">
        <Term k="entropy">Uncertainty</Term>
        <span className="tabular-nums text-ink">
          {num(bits, 2)} <span className="text-muted">/ {num(max, 2)} bits</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label="Uncertainty about the root cause"
        aria-valuemin={0}
        aria-valuemax={Number(max.toFixed(2))}
        aria-valuenow={Number(bits.toFixed(2))}
        className="h-1.5 overflow-hidden rounded-full bg-elevated"
      >
        <div className={cn("h-full rounded-full transition-[width] duration-300", tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
