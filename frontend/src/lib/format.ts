export const pct = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;

export const num = (v: number | null | undefined, digits = 2): string =>
  v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(digits);

export const secs = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : `${v.toFixed(0)} s`;

export const when = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

export const label = (s: string): string => s.replace(/_/g, " ");
