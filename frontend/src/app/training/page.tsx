"use client";

import { useState } from "react";
import { Lines } from "@/components/charts";
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
  ProgressBar,
  Select,
  statusTone,
} from "@/components/ui";
import { API_BASE, ApiError, api } from "@/lib/api";
import { num, pct, when } from "@/lib/format";
import { useAsync, usePolling } from "@/lib/hooks";

function StartTraining({ onStarted }: { onStarted: (id: string) => void }) {
  const scenarios = useAsync(() => api.scenarios(), []);
  const [form, setForm] = useState({
    name: "experiment",
    scenario: "small",
    total_timesteps: "50000",
    seed: "0",
    ent_coef: "0.05",
    learning_rate: "0.0005",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const exp = await api.startTraining({
        name: form.name,
        config: {
          scenario: form.scenario,
          total_timesteps: Number(form.total_timesteps),
          seed: Number(form.seed),
          ent_coef: Number(form.ent_coef),
          learning_rate: Number(form.learning_rate),
        },
      });
      onStarted(exp.id);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 503)) {
        setError(
          e.status === 401
            ? "Admin API key missing or invalid. Set it in the sidebar."
            : "Admin operations are disabled on the server (no API key configured).",
        );
      } else if (e instanceof ApiError && e.status === 429) {
        setError("Too many training requests. Wait a minute and try again.");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Start a training experiment" subtitle="Queued, then executed by the worker process">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Name">
          <Input value={form.name} onChange={set("name")} required maxLength={100} />
        </Field>
        <Field label="Scenario">
          <Select value={form.scenario} onChange={set("scenario")}>
            {(scenarios.data ?? [{ name: "small" } as { name: string }]).map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Timesteps" hint="Server limit: 5,000,000">
          <Input inputMode="numeric" value={form.total_timesteps} onChange={set("total_timesteps")} />
        </Field>
        <Field label="Seed">
          <Input inputMode="numeric" value={form.seed} onChange={set("seed")} />
        </Field>
        <Field label="Entropy coefficient">
          <Input inputMode="decimal" value={form.ent_coef} onChange={set("ent_coef")} />
        </Field>
        <Field label="Learning rate">
          <Input inputMode="decimal" value={form.learning_rate} onChange={set("learning_rate")} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorBanner error={error} />
          <Button type="submit" loading={busy} className="mt-3">
            Queue training
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function TrainingPage() {
  const list = useAsync(() => api.experiments(), []);
  const models = useAsync(() => api.models(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const items = list.data?.items ?? [];
  const activeId = selected ?? items[0]?.id ?? null;
  const detail = useAsync(
    () => (activeId ? api.experiment(activeId) : Promise.resolve(null)),
    [activeId],
  );

  const anyLive = items.some((e) => e.status === "running" || e.status === "queued");
  usePolling(
    () => {
      list.reload();
      detail.reload();
    },
    3000,
    anyLive,
  );

  const exp = detail.data;
  const curve = exp?.validation_curve ?? [];
  const checkpoints = (models.data ?? []).filter((m) => exp && m.experiment_id === exp.id);

  return (
    <>
      <PageHeader
        title="RL training"
        description="Queue MaskablePPO training runs and follow validation performance as they progress. Validation uses fixed incidents that are never used for training."
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <StartTraining
            onStarted={(id) => {
              setSelected(id);
              list.reload();
            }}
          />
          <Card title="Experiments">
            <ErrorBanner error={list.error} onRetry={list.reload} />
            {list.loading && !list.data && <LoadingBlock />}
            {list.data && items.length === 0 && (
              <EmptyState title="No training experiments">
                Start one above, or train from the command line and register the run on the
                Experiments page.
              </EmptyState>
            )}
            <ul className="space-y-2">
              {items.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => setSelected(e.id)}
                    aria-pressed={e.id === activeId}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                      e.id === activeId ? "border-accent bg-accent/10" : "border-line hover:bg-panel-2"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{e.run_name}</span>
                      <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                    </div>
                    <div className="mt-1.5">
                      <ProgressBar value={e.progress_timesteps} max={e.total_timesteps} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted">
                      {e.progress_timesteps.toLocaleString()} / {e.total_timesteps.toLocaleString()} steps ·{" "}
                      {when(e.created_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-4">
          {!activeId && <EmptyState title="Select an experiment to see its learning curves" />}
          {activeId && detail.loading && !exp && <LoadingBlock />}
          <ErrorBanner error={detail.error} onRetry={detail.reload} />
          {exp && (
            <>
              <Card
                title={exp.run_name}
                action={<Badge tone={statusTone(exp.status)}>{exp.status}</Badge>}
                subtitle={`Seed ${exp.seed} · started ${when(exp.started_at)}`}
              >
                <ProgressBar value={exp.progress_timesteps} max={exp.total_timesteps} />
                <p className="mt-1.5 text-xs text-muted">
                  {exp.progress_timesteps.toLocaleString()} of {exp.total_timesteps.toLocaleString()}{" "}
                  timesteps
                </p>
                {exp.error && (
                  <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-bad/10 p-2 text-xs text-bad">
                    {exp.error}
                  </pre>
                )}
              </Card>

              <Card title="Validation reward" subtitle="Mean episode reward on the fixed validation incidents">
                {curve.length === 0 ? (
                  <EmptyState title="No validation points yet" />
                ) : (
                  <Lines
                    data={curve.map((p) => ({ ...p }))}
                    xKey="timesteps"
                    xLabel="training timesteps"
                    lines={[{ key: "mean_reward", label: "mean reward" }]}
                    ariaLabel="Validation mean reward versus training timesteps"
                  />
                )}
              </Card>

              <Card title="Validation accuracy and tests">
                {curve.length === 0 ? (
                  <EmptyState title="No validation points yet" />
                ) : (
                  <Lines
                    data={curve.map((p) => ({ ...p }))}
                    xKey="timesteps"
                    xLabel="training timesteps"
                    lines={[
                      { key: "accuracy", label: "accuracy" },
                      { key: "mean_tests", label: "mean tests" },
                    ]}
                    ariaLabel="Validation accuracy and mean tests versus training timesteps"
                  />
                )}
                {curve.length > 0 && (
                  <p className="mt-2 text-xs text-muted">
                    Latest: accuracy {pct(curve[curve.length - 1]?.accuracy)}, reward{" "}
                    {num(curve[curve.length - 1]?.mean_reward)}
                  </p>
                )}
              </Card>

              <Card title="Checkpoints and artifacts">
                {checkpoints.length === 0 && exp.artifacts.length === 0 ? (
                  <p className="text-sm text-muted">Nothing available yet.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {checkpoints.map((m) => (
                      <li key={m.id} className="flex items-center justify-between">
                        <span>{m.name}</span>
                        <Badge tone={m.is_active ? "accent" : "neutral"}>
                          {m.is_active ? "active model" : "registered"}
                        </Badge>
                      </li>
                    ))}
                    {exp.artifacts.map((a) => (
                      <li key={a}>
                        <a
                          className="text-accent underline"
                          href={`${API_BASE}/api/v1/experiments/${exp.id}/artifacts/${a}`}
                        >
                          {a}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
