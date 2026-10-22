"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { OutcomeBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Select } from "@/components/ui/input";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import type { Report, Session, TestInfo } from "@/lib/api";
import { label, modelledSeconds, num, pct, timeOfDay } from "@/lib/format";
import { entropyBits } from "./derive";

export function ChooseTestDialog({
  open,
  onOpenChange,
  tests,
  onChoose,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tests: TestInfo[];
  onChoose: (testId: string) => void;
  busy: boolean;
}) {
  const available = tests.filter((t) => t.available);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Choose another test" description="Run any currently eligible diagnostic test instead of the recommendation.">
        {available.length === 0 ? (
          <p className="p-5 text-sm text-muted">No tests are currently available.</p>
        ) : (
          <ul className="divide-y divide-border">
            {available.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted">
                    {label(t.category)} · cost {num(t.cost, 0)} · {modelledSeconds(t.duration)}
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    onChoose(t.id);
                    onOpenChange(false);
                  }}
                  aria-label={`Run ${t.name}`}
                >
                  Run
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function DeclareDialog({
  open,
  onOpenChange,
  session,
  onDeclare,
  busy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  session: Session;
  onDeclare: (faultId: string) => void;
  busy: boolean;
}) {
  const ranked = [...session.posterior].sort((a, b) => b.probability - a.probability);
  const [choice, setChoice] = useState<string | null>(null);
  const picked = choice ?? ranked[0]?.id ?? "";
  const pickedFault = ranked.find((f) => f.id === picked);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Declare root cause"
        description="Declaring ends the investigation. A correct diagnosis earns reward; a wrong one is penalised."
      >
        <div className="space-y-4 p-5">
          <Field label="Root cause">
            <Select value={picked} onChange={(e) => setChoice(e.target.value)} aria-label="Root cause to declare">
              {ranked.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} — {pct(f.probability, 1)}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-xs text-muted">
            The Bayesian posterior currently gives “{pickedFault?.name}” a probability of{" "}
            <strong className="text-ink">{pct(pickedFault?.probability, 1)}</strong>, so a wrong declaration is{" "}
            {pct(1 - (pickedFault?.probability ?? 0), 0)} likely.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              loading={busy}
              onClick={() => {
                onDeclare(picked);
                onOpenChange(false);
                setChoice(null);
              }}
            >
              Declare {pickedFault?.name}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TraceDialog({
  open,
  onOpenChange,
  session,
  report,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  session: Session;
  report: Report | undefined;
}) {
  const names = session.posterior.map((p) => p.name);
  const lead = (p: number[]) => {
    const i = p.reduce((m, x, k, a) => (x > (a[m] ?? 0) ? k : m), 0);
    return `${names[i] ?? "?"} ${pct(p[i], 0)}`;
  };
  const download = () => {
    const blob = new Blob(
      [JSON.stringify({ session, report: report ?? null }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `investigation-${session.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Full diagnostic trace"
        description="Every executed test with the belief before and after, as recorded by the backend."
        className="max-w-4xl"
      >
        <div className="p-5">
          {session.executed.length === 0 ? (
            <p className="text-sm text-muted">No tests have been run yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Test</Th>
                  <Th>Outcome</Th>
                  <Th>Cost</Th>
                  <Th>Duration</Th>
                  <Th>Leader before → after</Th>
                  <Th>Entropy</Th>
                  <Th>Time</Th>
                </tr>
              </thead>
              <tbody>
                {session.executed.map((e) => (
                  <Tr key={e.step}>
                    <Td>{e.step}</Td>
                    <Td className="font-medium">{e.test_name}</Td>
                    <Td>
                      <OutcomeBadge outcome={e.outcome} />
                    </Td>
                    <Td>{num(e.cost, 1)}</Td>
                    <Td>{modelledSeconds(e.duration)}</Td>
                    <Td className="text-xs">
                      {lead(e.posterior_before)} → {lead(e.posterior_after)}
                    </Td>
                    <Td className="text-xs">
                      {num(entropyBits(e.posterior_before), 2)} → {num(entropyBits(e.posterior_after), 2)} bits
                    </Td>
                    <Td className="text-xs">{timeOfDay(e.executed_at)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          <div className="mt-4 flex justify-end">
            <Button variant="outline" size="sm" onClick={download}>
              <Download /> Download trace (JSON)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
