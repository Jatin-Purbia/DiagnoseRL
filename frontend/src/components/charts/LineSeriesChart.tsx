"use client";

import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "./ChartFrame";
import { AXIS, SERIES, TOOLTIP_STYLE } from "./theme";

export interface SeriesDef {
  key: string;
  label: string;
  color?: string;
  dashed?: boolean;
}

/** Multi-series line chart over a numeric x axis (timesteps, steps, epsilon, ...). */
export function LineSeriesChart({
  data,
  xKey,
  series,
  label,
  height = 240,
  xLabel,
  yFormatter,
  xFormatter,
  legend = true,
  domain,
}: {
  data: Record<string, number | string | undefined>[];
  xKey: string;
  series: SeriesDef[];
  label: string;
  height?: number;
  xLabel?: string;
  yFormatter?: (v: number) => string;
  xFormatter?: (v: number) => string;
  legend?: boolean;
  domain?: [number | "auto", number | "auto"];
}) {
  return (
    <ChartFrame label={label} height={height}>
      <LineChart data={data} margin={{ left: 0, right: 12, top: 8, bottom: xLabel ? 16 : 4 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey={xKey}
          type="number"
          domain={["dataMin", "dataMax"]}
          {...AXIS}
          tickFormatter={xFormatter}
          label={xLabel ? { value: xLabel, position: "insideBottom", offset: -10, fill: "var(--muted)", fontSize: 11 } : undefined}
        />
        <YAxis {...AXIS} tickFormatter={yFormatter} width={52} {...(domain ? { domain } : {})} />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={(v) => `${xLabel ?? xKey}: ${xFormatter ? xFormatter(Number(v)) : v}`}
          formatter={(v) => (typeof v === "number" ? (yFormatter ? yFormatter(v) : v.toFixed(3)) : String(v))}
        />
        {legend && series.length > 1 && <Legend verticalAlign="top" height={28} wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? SERIES[i % SERIES.length]}
            strokeWidth={2}
            strokeDasharray={s.dashed ? "5 4" : undefined}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}
