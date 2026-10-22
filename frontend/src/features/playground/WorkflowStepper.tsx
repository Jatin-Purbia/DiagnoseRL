"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { STAGES, type Stage } from "./derive";

/** Incident Detected → Evidence Collection → Test Execution → Belief Update → Diagnosis. */
export function WorkflowStepper({ stage, finished }: { stage: Stage; finished: boolean }) {
  return (
    <ol aria-label="Investigation workflow" className="flex items-center gap-1 overflow-x-auto pb-1">
      {STAGES.map((s, i) => {
        const done = finished ? true : i < stage;
        const current = !finished && i === stage;
        return (
          <li key={s.key} className="flex min-w-0 flex-1 items-center gap-1" aria-current={current ? "step" : undefined}>
            <div
              className={cn(
                "flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                current && "border-primary/50 bg-primary/10 text-ink",
                done && !current && "border-success/30 bg-success/5 text-ink",
                !done && !current && "border-border text-muted",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                  current && "bg-primary text-primary-ink",
                  done && !current && "bg-success text-white",
                  !done && !current && "bg-elevated text-muted",
                )}
              >
                {done && !current ? <Check className="size-3" aria-hidden /> : i + 1}
              </span>
              <span className="truncate font-medium">{s.label}</span>
              {current && <span aria-hidden className="ml-auto size-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />}
            </div>
            {i < STAGES.length - 1 && <span aria-hidden className="h-px w-2 shrink-0 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
