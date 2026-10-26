"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { AXIS, SERIES, TOOLTIP_STYLE } from "@/components/charts/theme";

interface BeliefStep {
  step: number;
  label: string;
  posterior: number[];
}

/** How the posterior of the leading hypotheses changed after each step. Click a point to inspect that step. */
export function BeliefEvolutionChart({
  steps,
  faultNames,
  selectedStep,
  onSelect,
  topN = 5,
  height = 240,
}: {
  steps: BeliefStep[];
  faultNames: string[];
  selectedStep: number;
  onSelect?: (step: number) => void;
  topN?: number;
  height?: number;
}) {
  // Faults that ever lead the field (plus the final leader), capped at topN.
  const tracked = useMemo(() => {
    const peak = faultNames.map((_, f) => Math.max(...steps.map((s) => s.posterior[f] ?? 0)));
    return peak
      .map((p, f) => ({ f, p }))
      .sort((a, b) => b.p - a.p)
      .slice(0, topN)
      .map((x) => x.f);
  }, [steps, faultNames, topN]);

  const data = useMemo(
    () =>
      steps.map((s) => ({
        step: s.step,
        label: s.label,
        ...Object.fromEntries(tracked.map((f) => [faultNames[f] ?? `fault ${f}`, s.posterior[f] ?? 0])),
      })),
    [steps, tracked, faultNames],
  );

  return (
    <ChartFrame
      height={height}
      label={`Posterior probability of the ${tracked.length} leading root causes after each step`}
    >
      <LineChart
        data={data}
        margin={{ left: 0, right: 12, top: 8, bottom: 4 }}
        onClick={(e) => {
          const idx = e?.activeTooltipIndex;
          if (onSelect && typeof idx === "number" && data[idx]) onSelect(data[idx].step);
        }}
      >
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="step" {...AXIS} allowDecimals={false} />
        <YAxis {...AXIS} domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} width={44} />
        <Tooltip
          {...TOOLTIP_STYLE}
          labelFormatter={(step) => {
            const row = data.find((d) => d.step === step);
            return row ? `Step ${step} · ${row.label}` : `Step ${step}`;
          }}
          formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`}
        />
        <ReferenceLine x={selectedStep} stroke="var(--primary)" strokeDasharray="4 3" />
        {tracked.map((f, i) => (
          <Line
            key={f}
            type="monotone"
            dataKey={faultNames[f] ?? `fault ${f}`}
            stroke={SERIES[i % SERIES.length]}
            strokeWidth={i === 0 ? 2.5 : 1.75}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
            isAnimationActive
            animationDuration={250}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}
