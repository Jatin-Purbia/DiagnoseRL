import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from "react";

const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("fade-in rounded-xl border border-line bg-panel p-4 sm:p-5", className)}>
      {(title || action) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export type Tone = "neutral" | "good" | "bad" | "warn" | "info" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "bg-panel-2 text-muted border-line",
  good: "bg-good/10 text-good border-good/30",
  bad: "bg-bad/10 text-bad border-bad/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  info: "bg-info/10 text-info border-info/30",
  accent: "bg-accent/10 text-accent border-accent/30",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs",
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "succeeded":
    case "declared":
      return "good";
    case "failed":
    case "truncated":
      return "bad";
    case "running":
    case "active":
      return "info";
    case "queued":
      return "warn";
    default:
      return "neutral";
  }
}

export function Spinner() {
  return (
    <span
      role="status"
      aria-label="Loading"
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function Button({
  variant = "primary",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
}) {
  const styles = {
    primary: "bg-accent text-accent-ink hover:bg-accent/90",
    secondary: "border border-line bg-panel-2 text-ink hover:bg-line/60",
    danger: "bg-bad/90 text-white hover:bg-bad",
  }[variant];
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        styles,
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      <span>{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted/80">{hint}</span>}
    </label>
  );
}

const inputCls =
  "rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-sm text-ink placeholder:text-muted/60";

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, props.className)} />;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}

export function ErrorBanner({
  error,
  onRetry,
}: {
  error: Error | string | null;
  onRetry?: () => void;
}) {
  if (!error) return null;
  const message = typeof error === "string" ? error : error.message;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad"
    >
      <span>{message}</span>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="!py-0.5">
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-xs text-muted">{children}</div>}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted" aria-live="polite">
      <Spinner /> {label}
    </div>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 w-full overflow-hidden rounded-full bg-panel-2"
    >
      <div
        className="h-full rounded-full bg-accent transition-all"
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
      {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-left text-sm">{children}</table>
    </div>
  );
}

export const th = "px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-muted";
export const td = "px-2 py-1.5 align-top tabular-nums";
