import type { Analytics } from "@/lib/api";

type Row = Analytics["timeseries"][number];

/**
 * Change in a metric between the most recent days and the days before them, or null when there
 * is not enough history for a trend to mean anything (fewer than 4 days with data).
 * Weighted by the number of sessions per day so a day with one session does not dominate.
 */
export function trendOf(
  series: Row[],
  key: "accuracy" | "mean_cost" | "mean_duration" | "mean_tests" | "mean_reward",
  recentDays = 2,
): number | null {
  const usable = series.filter((r) => r[key] !== null && r.sessions > 0);
  if (usable.length < recentDays + 2) return null;
  const weighted = (rows: Row[]) => {
    const n = rows.reduce((a, r) => a + r.sessions, 0);
    return rows.reduce((a, r) => a + (r[key] as number) * r.sessions, 0) / n;
  };
  const recent = usable.slice(-recentDays);
  const before = usable.slice(0, -recentDays);
  return weighted(recent) - weighted(before);
}
