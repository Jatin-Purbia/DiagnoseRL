import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const field =
  "h-9 w-full rounded-lg border border-border bg-elevated px-3 text-sm text-ink placeholder:text-muted/60 transition-colors hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-critical";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...props} />;
}

/** Native <select>: fully keyboard/screen-reader accessible and works on mobile. */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(field, "appearance-none bg-no-repeat pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-xs font-medium text-muted", className)}>
      <span>{label}</span>
      {children}
      {error ? (
        <span role="alert" className="font-normal text-critical">
          {error}
        </span>
      ) : (
        hint && <span className="font-normal text-muted/80">{hint}</span>
      )}
    </label>
  );
}
