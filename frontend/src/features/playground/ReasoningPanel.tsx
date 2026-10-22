"use client";

import { Brain } from "lucide-react";
import { useMemo } from "react";
import { BeliefEvolutionChart } from "@/components/domain/BeliefEvolutionChart";
import { EntropyIndicator } from "@/components/domain/EntropyIndicator";
import { FaultProbabilityChart } from "@/components/domain/FaultProbabilityChart";
import { TestImpact } from "@/components/domain/TestImpact";
import { Term } from "@/components/domain/Term";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Session } from "@/lib/api";
import { cn } from "@/lib/utils";
import { beliefSteps, entropyBits } from "./derive";

/** Posterior over root causes at the selected step: bars, history, and what each test changed. */
export function ReasoningPanel({
  session,
  viewStep,
  onViewStep,
}: {
  session: Session;
  viewStep: number;
  onViewStep: (step: number) => void;
}) {
  const steps = useMemo(() => beliefSteps(session), [session]);
  const names = session.posterior.map((p) => p.name);
  const idx = Math.min(viewStep, steps.length - 1);
  const current = steps[idx]!;
  const previous = idx > 0 ? steps[idx - 1] : undefined;
  const isLatest = idx === steps.length - 1;
  const executed = idx > 0 ? session.executed[idx - 1] : undefined;

  const bars = session.posterior.map((p, i) => ({ id: p.id, name: p.name, probability: current.posterior[i] ?? 0 }));

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Term k="posterior">Root-cause probabilities</Term>
            <Badge tone={isLatest ? "primary" : "secondary"}>
              {idx === 0 ? "Prior" : `After step ${idx}`}
              {!isLatest && " · history"}
            </Badge>
          </span>
        }
        description={
          executed ? `After “${executed.test_name}” returned ${executed.outcome}` : "Belief before any test has run"
        }
        icon={<Brain />}
      />
      <CardContent>
        <Tabs defaultValue="belief">
          <TabsList>
            <TabsTrigger value="belief">Beliefs</TabsTrigger>
            <TabsTrigger value="evolution">Evolution</TabsTrigger>
            <TabsTrigger value="impact" disabled={!executed}>
              Test impact
            </TabsTrigger>
          </TabsList>

          <TabsContent value="belief" className="space-y-4">
            <FaultProbabilityChart faults={bars} {...(previous ? { previous: previous.posterior } : {})} />
            <EntropyIndicator bits={entropyBits(current.posterior)} nFaults={names.length} />
          </TabsContent>

          <TabsContent value="evolution" className="space-y-3">
            <BeliefEvolutionChart steps={steps} faultNames={names} selectedStep={idx} onSelect={onViewStep} />
            <div role="group" aria-label="Inspect a step" className="flex flex-wrap gap-1.5">
              {steps.map((s) => (
                <button
                  key={s.step}
                  type="button"
                  onClick={() => onViewStep(s.step)}
                  aria-pressed={s.step === idx}
                  title={s.label}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs transition-colors",
                    s.step === idx ? "border-primary bg-primary/10 text-primary" : "border-border text-muted hover:text-ink",
                  )}
                >
                  {s.step === 0 ? "Prior" : `#${s.step}`}
                </button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="impact" className="space-y-2">
            {executed ? (
              <>
                <p className="text-xs text-muted">
                  How “{executed.test_name}” ({executed.outcome}) moved each root cause, in percentage points.
                </p>
                <TestImpact before={executed.posterior_before} after={executed.posterior_after} faultNames={names} />
              </>
            ) : null}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
