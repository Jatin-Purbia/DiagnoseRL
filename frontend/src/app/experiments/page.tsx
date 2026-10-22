"use client";

import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  statusTone,
  Table,
  td,
  th,
} from "@/components/ui";
import { API_BASE, ApiError, api } from "@/lib/api";
import { label, num, when } from "@/lib/format";
import { useAsync } from "@/lib/hooks";

function adminMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 401) return "Admin API key missing or invalid. Set it in the sidebar.";
  if (e instanceof ApiError && e.status === 503) return "Admin operations are disabled on the server.";
  return e instanceof Error ? e.message : String(e);
}

export default function ExperimentsPage() {
  const experiments = useAsync(() => api.experiments(), []);
  const models = useAsync(() => api.models(), []);
  const evaluations = useAsync(() => api.evaluations(), []);
  const [runName, setRunName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      models.reload();
    } catch (e) {
      setActionError(adminMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const modelByExp = new Map((models.data ?? []).filter((m) => m.experiment_id).map((m) => [m.experiment_id, m]));

  return (
    <>
      <PageHeader
        title="Experiment history"
        description="Every training run with its configuration, seed, resulting model version and artifacts; plus the model registry and evaluation runs."
      />
      <div className="space-y-4">
        <ErrorBanner error={actionError} />

        <Card title="Training experiments">
          <ErrorBanner error={experiments.error} onRetry={experiments.reload} />
          {experiments.loading && !experiments.data && <LoadingBlock />}
          {experiments.data && experiments.data.items.length === 0 && (
            <EmptyState title="No experiments recorded">Queue training from the Training page.</EmptyState>
          )}
          {experiments.data && experiments.data.items.length > 0 && (
            <Table>
              <thead>
                <tr>
                  {["Run", "Status", "Seed", "Config", "Model version", "Created", "Artifacts"].map((h) => (
                    <th key={h} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {experiments.data.items.map((e) => {
                  const m = modelByExp.get(e.id);
                  const cfg = e.config as Record<string, unknown>;
                  return (
                    <tr key={e.id} className="border-t border-line">
                      <td className={td}>
                        <div className="font-medium">{e.run_name}</div>
                        <div className="text-[11px] text-muted">{e.id.slice(0, 8)}</div>
                      </td>
                      <td className={td}><Badge tone={statusTone(e.status)}>{e.status}</Badge></td>
                      <td className={td}>{e.seed}</td>
                      <td className={td}>
                        <span className="text-xs text-muted">
                          {String(cfg.scenario)} · {Number(cfg.total_timesteps).toLocaleString()} steps · lr {String(cfg.learning_rate)} · ent {String(cfg.ent_coef)}
                        </span>
                      </td>
                      <td className={td}>
                        {m ? (
                          <>
                            {m.name}
                            {m.is_active && <> <Badge tone="accent">active</Badge></>}
                            <div className="text-[11px] text-muted">val reward {num(m.metrics.validation?.mean_reward)}</div>
                          </>
                        ) : "—"}
                      </td>
                      <td className={td}>{when(e.created_at)}</td>
                      <td className={td}>
                        {["config.json", "metrics.jsonl", "summary.json"].map((a) => (
                          <a key={a} className="mr-2 text-xs text-accent underline" href={`${API_BASE}/api/v1/experiments/${e.id}/artifacts/${a}`}>
                            {a.split(".")[0]}
                          </a>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card
          title="Model registry"
          subtitle="Activation validates the checkpoint (hash, compatibility, recorded validation metrics) and is audit-logged"
        >
          <form
            className="mb-4 flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (runName.trim()) void act("register", () => api.registerModel(runName.trim()));
            }}
          >
            <Field label="Register an existing training run (best checkpoint)">
              <Input value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="e.g. full_seed0" />
            </Field>
            <Button type="submit" variant="secondary" loading={busy === "register"}>
              Register
            </Button>
          </form>
          <ErrorBanner error={models.error} onRetry={models.reload} />
          {models.data && models.data.length === 0 && <EmptyState title="No registered models" />}
          {models.data && models.data.length > 0 && (
            <Table>
              <thead>
                <tr>
                  {["Model", "Scenario", "Seed", "Val reward", "Val accuracy", "State", ""].map((h) => (
                    <th key={h} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {models.data.map((m) => (
                  <tr key={m.id} className="border-t border-line">
                    <td className={td}>
                      <div className="font-medium">{m.name}</div>
                      <div className="text-[11px] text-muted">sha256 {m.sha256.slice(0, 12)}…</div>
                    </td>
                    <td className={td}>{m.scenario}</td>
                    <td className={td}>{m.seed}</td>
                    <td className={td}>{num(m.metrics.validation?.mean_reward)}</td>
                    <td className={td}>{num(m.metrics.validation?.accuracy, 3)}</td>
                    <td className={td}><Badge tone={m.is_active ? "accent" : "neutral"}>{m.is_active ? "active" : "inactive"}</Badge></td>
                    <td className={td}>
                      {!m.is_active && (
                        <Button
                          variant="secondary"
                          className="!px-2 !py-0.5 text-xs"
                          loading={busy === m.id}
                          onClick={() => void act(m.id, () => api.activateModel(m.id))}
                        >
                          Activate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Evaluation runs">
          <ErrorBanner error={evaluations.error} onRetry={evaluations.reload} />
          {evaluations.data && evaluations.data.items.length === 0 && (
            <EmptyState title="No evaluations">Queue one from the Comparison page.</EmptyState>
          )}
          {evaluations.data && evaluations.data.items.length > 0 && (
            <Table>
              <thead>
                <tr>
                  {["Evaluation", "Status", "Runs", "Episodes", "Finished"].map((h) => (
                    <th key={h} className={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {evaluations.data.items.map((e) => (
                  <tr key={e.id} className="border-t border-line">
                    <td className={td}>{e.id.slice(0, 8)}</td>
                    <td className={td}>
                      <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                      {e.error && <div className="text-[11px] text-bad">{e.error.slice(0, 80)}</div>}
                    </td>
                    <td className={td}>{label(String((e.params.run_names as string[] | undefined)?.join(", ") ?? ""))}</td>
                    <td className={td}>{String(e.params.n_test ?? "")}</td>
                    <td className={td}>{when(e.finished_at)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
