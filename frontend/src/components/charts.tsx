"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const PALETTE = {
  accent: "#4fd1c5",
  info: "#60a5fa",
  good: "#4ade80",
  warn: "#fbbf24",
  bad: "#f87171",
  violet: "#a78bfa",
  muted: "#94a3b8",
  grid: "#243149",
};

export const POLICY_COLORS: Record<string, string> = {
  ppo: PALETTE.bad,
  cost_aware_bayes: PALETTE.good,
  info_gain: PALETTE.info,
  fixed_order: PALETTE.muted,
  random: PALETTE.warn,
};

const SERIES = [PALETTE.accent, PALETTE.info, PALETTE.warn, PALETTE.violet, PALETTE.bad, PALETTE.good];
const AXIS = { stroke: PALETTE.muted, fontSize: 11 } as const;
const TOOLTIP = {
  contentStyle: {
    background: "#101722",
    border: `1px solid ${PALETTE.grid}`,
    borderRadius: 8,
    fontSize: 12,
  },
  labelStyle: { color: "#e6edf7" },
} as const;

function Frame({ height, children }: { height: number; children: React.ReactElement }) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export interface BarDatum {
  name: string;
  value: number;
  highlight?: boolean;
}

/** Horizontal bars, e.g. the posterior over faults. */
export function HBars({
  data,
  height = 320,
  formatter = (v: number) => `${(v * 100).toFixed(1)}%`,
  max = 1,
  ariaLabel,
}: {
  data: BarDatum[];
  height?: number;
  formatter?: (v: number) => string;
  max?: number;
  ariaLabel: string;
}) {
  return (
    <div role="img" aria-label={ariaLabel}>
      <Frame height={height}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid stroke={PALETTE.grid} horizontal={false} />
          <XAxis type="number" domain={[0, max]} tickFormatter={formatter} {...AXIS} />
          <YAxis type="category" dataKey="name" width={150} {...AXIS} />
          <Tooltip {...TOOLTIP} formatter={(v) => formatter(Number(v))} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.highlight ? PALETTE.accent : PALETTE.info} />
            ))}
          </Bar>
        </BarChart>
      </Frame>
    </div>
  );
}

export interface LineDef {
  key: string;
  label: string;
  color?: string;
}

export function Lines({
  data,
  xKey,
  lines,
  height = 280,
  xLabel,
  yFormatter,
  ariaLabel,
}: {
  data: Record<string, number | string>[];
  xKey: string;
  lines: LineDef[];
  height?: number;
  xLabel?: string;
  yFormatter?: (v: number) => string;
  ariaLabel: string;
}) {
  return (
    <div role="img" aria-label={ariaLabel}>
      <Frame height={height}>
        <LineChart data={data} margin={{ left: 0, right: 16, top: 8 }}>
          <CartesianGrid stroke={PALETTE.grid} />
          <XAxis
            dataKey={xKey}
            {...AXIS}
            label={xLabel ? { value: xLabel, position: "insideBottom", offset: -2, fill: PALETTE.muted, fontSize: 11 } : undefined}
          />
          <YAxis {...AXIS} tickFormatter={yFormatter} width={48} />
          <Tooltip {...TOOLTIP} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {lines.map((l, i) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.label}
              stroke={l.color ?? SERIES[i % SERIES.length]}
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </Frame>
    </div>
  );
}

export interface ScatterSeries {
  name: string;
  color: string;
  points: { x: number; y: number }[];
  line?: boolean;
}

/** Accuracy-versus-cost style trade-off plot. */
export function Tradeoff({
  series,
  xLabel,
  yLabel,
  height = 340,
  ariaLabel,
}: {
  series: ScatterSeries[];
  xLabel: string;
  yLabel: string;
  height?: number;
  ariaLabel: string;
}) {
  return (
    <div role="img" aria-label={ariaLabel}>
      <Frame height={height}>
        <ScatterChart margin={{ left: 0, right: 16, top: 8, bottom: 16 }}>
          <CartesianGrid stroke={PALETTE.grid} />
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel}
            {...AXIS}
            label={{ value: xLabel, position: "insideBottom", offset: -8, fill: PALETTE.muted, fontSize: 11 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            domain={[0, 1]}
            tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
            {...AXIS}
            width={48}
          />
          <Tooltip {...TOOLTIP} cursor={{ strokeDasharray: "3 3" }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => (
            <Scatter
              key={s.name}
              name={s.name}
              data={s.points}
              fill={s.color}
              line={s.line ? { stroke: s.color, strokeWidth: 1.5 } : undefined}
              isAnimationActive={false}
            />
          ))}
        </ScatterChart>
      </Frame>
    </div>
  );
}

export interface ErrorBarDatum {
  name: string;
  value: number;
  low?: number;
  high?: number;
  color?: string;
}

/** Vertical bars with a plain-text CI shown in the tooltip. */
export function ValueBars({
  data,
  height = 280,
  yFormatter = (v: number) => v.toFixed(1),
  ariaLabel,
}: {
  data: ErrorBarDatum[];
  height?: number;
  yFormatter?: (v: number) => string;
  ariaLabel: string;
}) {
  return (
    <div role="img" aria-label={ariaLabel}>
      <Frame height={height}>
        <BarChart data={data} margin={{ left: 0, right: 16, top: 8 }}>
          <CartesianGrid stroke={PALETTE.grid} vertical={false} />
          <XAxis dataKey="name" {...AXIS} />
          <YAxis {...AXIS} tickFormatter={yFormatter} width={48} />
          <Tooltip
            {...TOOLTIP}
            formatter={(v, _n, item) => {
              const d = item?.payload as ErrorBarDatum | undefined;
              const ci =
                d?.low !== undefined && d?.high !== undefined
                  ? ` (95% CI ${yFormatter(d.low)} to ${yFormatter(d.high)})`
                  : "";
              return `${yFormatter(Number(v))}${ci}`;
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color ?? PALETTE.info} />
            ))}
          </Bar>
        </BarChart>
      </Frame>
    </div>
  );
}
