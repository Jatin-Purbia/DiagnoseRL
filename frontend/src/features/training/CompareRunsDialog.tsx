"use client";

import { useQueries } from "@tanstack/react-query";
import { LineSeriesChart } from "@/components/charts/LineSeriesChart";
import { SERIES } from "@/components/charts/theme";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { api, type Experiment } from "@/lib/api";
import { compact, num, pct } from "@/lib/format";
import { keys } from "@/lib/queries";
import { mergeByTimestep } from "./TrainingMonitor";

/** Overlay the validation curves of the selected runs; the table compares their final values. */
export function CompareRunsDialog({
  runs,
  open,
  onOpenChange,
}: {
  runs: Experiment[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const results = useQueries({
    queries: runs.map((r) => ({
      queryKey: keys.experiment(r.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.experiment(r.id, signal),
      enabled: open,
    })),
  });
  const loading = results.some((r) => r.isPending);
  const details = results.map((r) => r.data);
  const series = runs.map((r, i) => ({ key: `r${i}`, label: r.run_name, color: SERIES[i % SERIES.length] as string }));
  const accSeries = runs.map((r, i) => ({ key: `a${i}`, label: r.run_name, color: SERIES[i % SERIES.length] as string }));

  const rewardRows = mergeByTimestep(
    ...details.map((d, i) => (d?.validation_curve ?? []).map((v) => ({ timesteps: v.timesteps, [`r${i}`]: v.mean_reward }))),
  );
  const accRows = mergeByTimestep(
    ...details.map((d, i) => (d?.validation_curve ?? []).map((v) => ({ timesteps: v.timesteps, [`a${i}`]: v.accuracy }))),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Compare runs"
        description="Validation metrics on the same fixed validation incidents. Runs must share a scenario and reward settings for the comparison to be fair."
        className="max-w-4xl"
      >
        <div className="space-y-5 p-5">
          {runs.length < 2 ? (
            <p className="text-sm text-muted">Select at least two runs in the list to compare them.</p>
          ) : loading ? (
            <SkeletonBlock label="Loading runs" />
          ) : (
            <>
              <LineSeriesChart
                label="Validation reward of the selected runs"
                xKey="timesteps"
                xLabel="timesteps"
                xFormatter={compact}
                data={rewardRows}
                series={series}
                yFormatter={(v) => v.toFixed(1)}
              />
              <LineSeriesChart
                label="Validation accuracy of the selected runs"
                xKey="timesteps"
                xLabel="timesteps"
                xFormatter={compact}
                data={accRows}
                series={accSeries}
                yFormatter={(v) => `${Math.round(v * 100)}%`}
                domain={[0, 1]}
                height={200}
              />
              <Table>
                <thead>
                  <tr>
                    <Th>Run</Th>
                    <Th>Scenario</Th>
                    <Th>Seed</Th>
                    <Th>Final val. reward</Th>
                    <Th>Final val. accuracy</Th>
                    <Th>Best val. reward</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r, i) => {
                    const curve = details[i]?.validation_curve ?? [];
                    const last = curve[curve.length - 1];
                    const best = curve.length ? Math.max(...curve.map((v) => v.mean_reward)) : undefined;
                    return (
                      <Tr key={r.id}>
                        <Td className="font-medium">{r.run_name}</Td>
                        <Td>{String(r.config.scenario ?? "—")}</Td>
                        <Td>{r.seed}</Td>
                        <Td>{num(last?.mean_reward)}</Td>
                        <Td>{pct(last?.accuracy)}</Td>
                        <Td>{num(best)}</Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
              {new Set(runs.map((r) => String(r.config.scenario))).size > 1 && (
                <p role="alert" className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  These runs use different scenarios, so their rewards are not directly comparable.
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
