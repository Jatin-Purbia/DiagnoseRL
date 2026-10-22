/** Number / date formatting shared by every screen. Null-safe: missing data renders as an em dash. */

const DASH = "—";

export const pct = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined || Number.isNaN(v) ? DASH : `${(v * 100).toFixed(digits)}%`;

export const num = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || Number.isNaN(v) ? DASH : v.toFixed(digits);

export const signed = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || Number.isNaN(v) ? DASH : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

export const compact = (v: number | null | undefined): string =>
  v === null || v === undefined
    ? DASH
    : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(v);

/** Modelled (simulated) seconds as "1m 12s". These are the scenario's test durations, not wall-clock. */
export function modelledSeconds(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return DASH;
  if (v < 60) return `${v.toFixed(0)}s`;
  const m = Math.floor(v / 60);
  return `${m}m ${Math.round(v - m * 60)}s`;
}

/** Real elapsed wall-clock time, e.g. for training jobs. */
export function wallClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return DASH;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? DASH
    : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function timeOfDay(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? DASH : d.toLocaleTimeString(undefined, { timeStyle: "medium" });
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return DASH;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return DASH;
  const diff = Math.round((now - t) / 1000);
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)} d ago`;
}

export const label = (s: string): string => s.replace(/_/g, " ");

export const shortId = (id: string): string => id.slice(0, 8);

export const titleCase = (s: string): string =>
  label(s).replace(/\b\w/g, (c) => c.toUpperCase());
