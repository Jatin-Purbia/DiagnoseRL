// One typed function per backend operation. Components never call fetch directly.

import { z } from "zod";
import { API_BASE, request } from "./client";
import * as s from "./schemas";

const enc = encodeURIComponent;
const V1 = "/api/v1";

function qs(params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const str = sp.toString();
  return str ? `?${str}` : "";
}

export interface AnalyticsFilters {
  scenario?: string;
  policy?: string;
  since?: string;
  until?: string;
}

export interface SessionFilters {
  limit?: number;
  offset?: number;
  status?: string;
  scenario?: string;
  policy?: string;
  q?: string;
}

interface TrainingRequest {
  name: string;
  config: Record<string, unknown>;
}

export const api = {
  health: (signal?: AbortSignal) => request("/health/ready", { schema: s.health, signal }),
  overview: (signal?: AbortSignal) => request(`${V1}/overview`, { schema: s.overview, signal }),
  analytics: (f: AnalyticsFilters, signal?: AbortSignal) =>
    request(`${V1}/analytics${qs({ ...f })}`, { schema: s.analytics, signal }),
  policies: (signal?: AbortSignal) => request(`${V1}/policies`, { schema: s.policies, signal }),
  scenarios: (signal?: AbortSignal) =>
    request(`${V1}/scenarios`, { schema: z.array(s.scenarioSummary), signal }),
  scenario: (name: string, signal?: AbortSignal) =>
    request(`${V1}/scenarios/${enc(name)}`, { schema: s.scenarioDetail, signal }),

  sessions: (f: SessionFilters, signal?: AbortSignal) =>
    request(`${V1}/sessions${qs({ ...f })}`, { schema: s.page(s.sessionSummary), signal }),
  createSession: (body: { scenario: string; policy: string; seed?: number }) =>
    request(`${V1}/sessions`, { method: "POST", body, schema: s.session }),
  session: (id: string, signal?: AbortSignal) =>
    request(`${V1}/sessions/${enc(id)}`, { schema: s.session, signal }),
  sessionTests: (id: string, signal?: AbortSignal) =>
    request(`${V1}/sessions/${enc(id)}/tests`, { schema: z.array(s.testInfo), signal }),
  recommendation: (id: string, signal?: AbortSignal) =>
    request(`${V1}/sessions/${enc(id)}/recommendation`, { schema: s.recommendation, signal }),
  executeTest: (id: string, test_id: string, expected_step: number) =>
    request(`${V1}/sessions/${enc(id)}/tests`, {
      method: "POST",
      body: { test_id, expected_step },
      schema: s.executeTestResponse,
    }),
  declare: (id: string, fault_id: string) =>
    request(`${V1}/sessions/${enc(id)}/declare`, {
      method: "POST",
      body: { fault_id },
      schema: s.declareResponse,
    }),
  report: (id: string, signal?: AbortSignal) =>
    request(`${V1}/sessions/${enc(id)}/report`, { schema: s.report, signal }),

  experiments: (signal?: AbortSignal) =>
    request(`${V1}/experiments?limit=100`, { schema: s.page(s.experiment), signal }),
  experiment: (id: string, signal?: AbortSignal) =>
    request(`${V1}/experiments/${enc(id)}`, { schema: s.experimentDetail, signal }),
  startTraining: (body: TrainingRequest) =>
    request(`${V1}/experiments/training`, { method: "POST", body, admin: true, schema: s.experiment }),
  cancelExperiment: (id: string) =>
    request(`${V1}/experiments/${enc(id)}/cancel`, { method: "POST", admin: true, schema: s.experiment }),
  artifactUrl: (expId: string, name: string) =>
    `${API_BASE}${V1}/experiments/${enc(expId)}/artifacts/${enc(name)}`,

  evaluations: (signal?: AbortSignal) =>
    request(`${V1}/evaluations?limit=100`, { schema: s.page(s.evaluation), signal }),
  evaluationResults: (id: string, signal?: AbortSignal) =>
    request(`${V1}/evaluations/${enc(id)}/results`, { schema: s.evaluationResults, signal }),
  startEvaluation: (body: {
    run_names: string[];
    model: "best" | "final";
    n_test: number;
    skip_robustness: boolean;
  }) => request(`${V1}/evaluations`, { method: "POST", body, admin: true, schema: s.evaluation }),
  figureUrl: (evalId: string, name: string) =>
    `${API_BASE}${V1}/evaluations/${enc(evalId)}/figures/${enc(name)}`,

  models: (signal?: AbortSignal) =>
    request(`${V1}/models`, { schema: z.array(s.modelVersion), signal }),
  registerModel: (run_name: string, checkpoint: "best" | "final" = "best") =>
    request(`${V1}/models/register`, {
      method: "POST",
      body: { run_name, checkpoint },
      admin: true,
      schema: s.modelVersion,
    }),
  activateModel: (id: string) =>
    request(`${V1}/models/${enc(id)}/activate`, { method: "POST", admin: true, schema: s.modelVersion }),
  deactivateModel: (id: string) =>
    request(`${V1}/models/${enc(id)}/deactivate`, { method: "POST", admin: true, schema: s.modelVersion }),
};
