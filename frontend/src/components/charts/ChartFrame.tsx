"use client";

import type { ReactElement } from "react";
import { ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

/**
 * Sized, labelled container for a Recharts chart. `initialDimension` lets the chart render before
 * layout is measured (and in jsdom tests); `role="img"` + `aria-label` give screen readers a summary.
 */
export function ChartFrame({
  height = 260,
  label,
  children,
  className,
}: {
  height?: number;
  label: string;
  children: ReactElement;
  className?: string;
}) {
  return (
    <div role="img" aria-label={label} className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}
