"use client";

import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { Tip } from "@/components/ui/tooltip";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";

/** Inline term with a keyboard-focusable help tooltip. */
export function Term({ k, children }: { k: GlossaryKey; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <Tip content={GLOSSARY[k]}>
        <button
          type="button"
          aria-label={`What is ${typeof children === "string" ? children : k}?`}
          className="rounded-full text-muted/70 transition-colors hover:text-ink"
        >
          <Info className="size-3" aria-hidden />
        </button>
      </Tip>
    </span>
  );
}
