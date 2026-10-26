import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface Trend {
  /** Signed change expressed in the metric's own unit. */
  delta: number;
  label: string;
  /** Whether an increase is good (accuracy) or bad (cost, time). */
  higherIsBetter: boolean;
  format: (n: number) => string;
}

/** Headline number with icon, context line and an optional (data-backed) trend. */
export function MetricCard({
  icon,
  label,
  value,
  context,
  info,
  trend,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  context?: ReactNode;
  info?: string;
  trend?: Trend | null;
}) {
  const good = trend ? trend.delta === 0 || trend.delta > 0 === trend.higherIsBetter : true;
  return (
    <Card className="p-4 transition-colors hover:border-primary/40">
      <div className="flex items-center justify-between text-muted">
        <span className="flex items-center gap-2 text-xs font-medium [&_svg]:size-4">
          {icon}
          {label}
        </span>
        {info && (
          <Tip content={info}>
            <button type="button" aria-label={`About ${label}`} className="rounded-full hover:text-ink">
              <Info className="size-3.5" aria-hidden />
            </button>
          </Tip>
        )}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <div className="mt-1.5 flex min-h-4 flex-wrap items-center gap-x-2 text-xs text-muted">
        {context && <span>{context}</span>}
        {trend && trend.delta !== 0 && (
          <span
            className={cn("inline-flex items-center gap-0.5 font-medium", good ? "text-success" : "text-critical")}
            title={trend.label}
          >
            {trend.delta > 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
            {trend.format(Math.abs(trend.delta))}
          </span>
        )}
      </div>
    </Card>
  );
}
