"use client";

import { useState } from "react";
import { HBars } from "@/components/charts";
import {
  Badge,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  LoadingBlock,
  PageHeader,
  Select,
  Table,
  td,
  th,
} from "@/components/ui";
import { api } from "@/lib/api";
import { label, num, pct } from "@/lib/format";
import { useAsync } from "@/lib/hooks";

export default function FaultExplorerPage() {
  const scenarios = useAsync(() => api.scenarios(), []);
  const [name, setName] = useState("standard");
  const scenario = useAsync(() => api.scenario(name), [name]);
  const [testId, setTestId] = useState<string | null>(null);

  const s = scenario.data;
  const test = s?.tests.find((t) => t.id === testId) ?? s?.tests[0];

  return (
    <>
      <PageHeader
        title="Fault explorer"
        description="Inspect the simulated environment: root causes and their priors, the diagnostic test catalogue, and how likely each result is under each fault."
      />
      <div className="space-y-4">
        <Field label="Scenario">
          <Select
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTestId(null);
            }}
            className="max-w-xs"
          >
            {(scenarios.data ?? [{ name } as { name: string }]).map((sc) => (
              <option key={sc.name} value={sc.name}>
                {sc.name}
              </option>
            ))}
          </Select>
        </Field>
        <ErrorBanner error={scenario.error} onRetry={scenario.reload} />
        {scenario.loading && !s && <LoadingBlock />}

        {s && (
          <>
            <Card title="How the environment works">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                <li>
                  One root cause is drawn from the <strong className="text-ink">prior</strong> and hidden.
                </li>
                <li>
                  Each diagnostic test can be run once. Its result is random, drawn from{" "}
                  <strong className="text-ink">P(result | fault, test)</strong> (the matrix below), so
                  results are noisy and rarely conclusive on their own.
                </li>
                <li>
                  Tests cost resources and time. Declaring a fault ends the investigation: correct
                  declarations earn reward, wrong ones are penalised, and every test costs a little.
                </li>
                <li>
                  After each result the agent updates a Bayesian posterior over faults and decides
                  whether another test is worth its cost. At most {s.max_steps} steps are allowed.
                </li>
              </ol>
              <p className="mt-2 text-xs text-muted">
                Probabilities are hand-authored for this simulation, not measured from real systems.
              </p>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Fault priors" subtitle={`${s.n_faults} root causes`}>
                <HBars
                  ariaLabel="Prior probability of each fault"
                  max={Math.max(...s.faults.map((f) => f.prior)) * 1.15}
                  data={[...s.faults]
                    .sort((a, b) => b.prior - a.prior)
                    .map((f) => ({ name: f.name, value: f.prior }))}
                />
              </Card>

              <Card title="Diagnostic test catalogue" subtitle="Select a test to see its outcome model">
                <Table>
                  <thead>
                    <tr>
                      <th className={th}>Test</th>
                      <th className={th}>Category</th>
                      <th className={th}>Cost</th>
                      <th className={th}>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.tests.map((t) => (
                      <tr
                        key={t.id}
                        className={`cursor-pointer border-t border-line hover:bg-panel-2 ${
                          t.id === test?.id ? "bg-accent/10" : ""
                        }`}
                        onClick={() => setTestId(t.id)}
                      >
                        <td className={td}>
                          <button
                            className="text-left font-medium"
                            aria-pressed={t.id === test?.id}
                            onClick={() => setTestId(t.id)}
                          >
                            {t.name}
                          </button>
                          {t.requires.length > 0 && (
                            <div className="text-[11px] text-muted">needs {t.requires.map(label).join(", ")}</div>
                          )}
                        </td>
                        <td className={td}>
                          <Badge>{t.category}</Badge>
                        </td>
                        <td className={td}>{t.cost}</td>
                        <td className={td}>{t.duration}s</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </div>

            {test ? (
              <Card
                title={`Outcome model: ${test.name}`}
                subtitle="Each row is a fault; cells are P(result | fault). Darker means more likely."
              >
                <Table>
                  <thead>
                    <tr>
                      <th className={th}>Fault</th>
                      {test.outcomes.map((o) => (
                        <th key={o} className={th}>
                          {o}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.faults.map((f, fi) => (
                      <tr key={f.id} className="border-t border-line">
                        <td className={td}>{f.name}</td>
                        {test.outcomes.map((o) => {
                          const oi = s.outcomes.indexOf(o);
                          const p = test.likelihood[fi]?.[oi] ?? 0;
                          return (
                            <td
                              key={o}
                              className={td}
                              style={{ background: `rgba(79, 209, 197, ${(p * 0.55).toFixed(3)})` }}
                              title={`P(${o} | ${f.name}) = ${num(p, 3)}`}
                            >
                              {pct(p, 0)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            ) : (
              <EmptyState title="No tests in this scenario" />
            )}
          </>
        )}
      </div>
    </>
  );
}
