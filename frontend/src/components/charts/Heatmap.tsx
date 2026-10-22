"use client";

import { cn } from "@/lib/utils";

/**
 * Accessible heatmap rendered as a real table (row/column headers, cell values readable by
 * screen readers). Colour intensity is relative to `max`, and the value is always printed too,
 * so colour is never the only channel.
 */
export function Heatmap({
  rows,
  cols,
  values,
  max,
  format = (v) => v.toFixed(2),
  rowHeader = "",
  caption,
  onCellClick,
  highlightDiagonal = false,
  tone = "primary",
  compact = false,
  cellTitle,
}: {
  rows: string[];
  cols: string[];
  values: number[][];
  max?: number;
  format?: (v: number) => string;
  rowHeader?: string;
  caption: string;
  onCellClick?: (row: number, col: number) => void;
  highlightDiagonal?: boolean;
  tone?: "primary" | "success" | "critical";
  compact?: boolean;
  cellTitle?: (row: number, col: number, value: number) => string;
}) {
  const top = max ?? Math.max(1e-9, ...values.flat());
  return (
    <div className="relative overflow-x-auto">
      <table className="border-separate border-spacing-0.5 text-[11px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1 text-left font-medium text-muted">
              {rowHeader}
            </th>
            {cols.map((c) => (
              <th
                key={c}
                scope="col"
                className={cn(
                  "px-1 py-1 align-bottom font-medium leading-tight text-muted",
                  cols.length <= 6 ? "max-w-28" : "max-w-[5.5rem]",
                )}
              >
                <span className="block break-words text-center" title={c}>
                  {c}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r}>
              <th scope="row" className="max-w-40 truncate whitespace-nowrap pr-2 text-left font-medium text-muted" title={r}>
                {r}
              </th>
              {cols.map((c, j) => {
                const v = values[i]?.[j] ?? 0;
                const intensity = Math.min(1, Math.max(0, v / top));
                const diagonal = highlightDiagonal && i === j;
                const cell = (
                  <span
                    className={cn(
                      "grid min-w-9 place-items-center rounded-md px-1 text-center tabular-nums transition-colors",
                      compact ? "h-6" : "h-8",
                      intensity > 0.55 ? "text-white" : "text-ink",
                      diagonal && "ring-1 ring-inset ring-ink/30",
                    )}
                    style={{
                      background: `color-mix(in srgb, var(--${tone}) ${Math.round(intensity * 85)}%, var(--elevated))`,
                    }}
                    title={cellTitle ? cellTitle(i, j, v) : `${r} × ${c}: ${format(v)}`}
                  >
                    {format(v)}
                  </span>
                );
                return (
                  <td key={c} className="p-0">
                    {onCellClick ? (
                      <button
                        type="button"
                        className="block w-full rounded-md"
                        onClick={() => onCellClick(i, j)}
                        aria-label={cellTitle ? cellTitle(i, j, v) : `${r} × ${c}: ${format(v)}`}
                      >
                        {cell}
                      </button>
                    ) : (
                      cell
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
