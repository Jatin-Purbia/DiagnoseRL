import { cn } from "@/lib/utils";

export function Progress({
  value,
  max = 100,
  className,
  label,
  tone = "primary",
}: {
  value: number;
  max?: number;
  className?: string;
  label?: string;
  tone?: "primary" | "success" | "warning" | "critical";
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const bar = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    critical: "bg-critical",
  }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-elevated", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300 ease-out", bar)}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}
