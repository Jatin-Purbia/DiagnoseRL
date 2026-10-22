"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "./ChartFrame";
import { AXIS, TOOLTIP_STYLE } from "./theme";

export interface HistogramSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

/** Bin raw samples into shared bins; returns recharts rows `{ bin, [seriesKey]: share }`. */
export function binSeries(series: HistogramSeries[], bins = 14) {
  const all = series.flatMap((s) => s.values);
  if (all.length === 0) return [];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const width = (hi - lo || 1) / bins;
  const rows = Array.from({ length: bins }, (_, i) => ({
    bin: `${Math.round(lo + i * width)}–${Math.round(lo + (i + 1) * width)}`,
    start: lo + i * width,
    ...Object.fromEntries(series.map((s) => [s.key, 0])),
  })) as Record<string, number | string>[];
  for (const s of series) {
    for (const v of s.values) {
      const idx = Math.min(bins - 1, Math.floor((v - lo) / width));
      rows[idx]![s.key] = (rows[idx]![s.key] as number) + 1 / s.values.length;
    }
  }
  return rows;
}

/** Distribution comparison: each series is normalised, so different episode counts stay comparable. */
export function Histogram({
  series,
  xLabel,
  height = 260,
  label,
}: {
  series: HistogramSeries[];
  xLabel: string;
  height?: number;
  label: string;
}) {
  const data = useMemo(() => binSeries(series), [series]);
  return (
    <ChartFrame height={height} label={label}>
      <BarChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: 16 }} barGap={1}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="bin"
          {...AXIS}
          interval="preserveStartEnd"
          label={{ value: xLabel, position: "insideBottom", offset: -10, fill: "var(--muted)", fontSize: 11 }}
        />
        <YAxis {...AXIS} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} width={44} />
        <Tooltip {...TOOLTIP_STYLE} formatter={(v) => `${(Number(v) * 100).toFixed(1)}% of episodes`} />
        <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} fillOpacity={0.8} isAnimationActive={false} />
        ))}
      </BarChart>
    </ChartFrame>
  );
}
