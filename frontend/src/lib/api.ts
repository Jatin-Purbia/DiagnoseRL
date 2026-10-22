// Typed client for the DiagnoseRL API. All UI features go through these calls.

import type {
  DeclareResponse,
  Evaluation,
  EvaluationResults,
  ExecuteTestResponse,
  Experiment,
  ExperimentDetail,
  ModelVersion,
  Overview,
  Page,
  PoliciesResponse,
  Recommendation,
  Report,
  ScenarioDetail,
  ScenarioSummary,
  Session,
  TestInfo,
} from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);

const ADMIN_KEY_STORAGE = "diagnoserl.adminKey";

/** Admin key lives in sessionStorage (cleared when the tab closes), never localStorage. */
export function getAdminKey(): string {
  try {
    return globalThis.sessionStorage?.getItem(ADMIN_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function setAdminKey(key: string): void {
  try {
    if (key) globalThis.sessionStorage?.setItem(ADMIN_KEY_STORAGE, key);
    else globalThis.sessionStorage?.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    /* storage unavailable (private mode): the key just is not remembered */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  admin?: boolean;
  signal?: AbortSignal;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.admin) headers["X-API-Key"] = getAdminKey();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Cannot reach the API. Is the backend running?");
  }
  if (!res.ok) {
    let code = "http_error";
    let message = `Request failed (${res.status})`;
    let details: Record<string, unknown> = {};
    try {
      const data = await res.json();
      code = data?.error?.code ?? code;
      message = data?.error?.message ?? message;
      details = data?.error?.details ?? {};
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message, details);
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

export const api = {
  overview: () => request<Overview>("/overview"),
  policies: () => request<PoliciesResponse>("/policies"),
  scenarios: () => request<ScenarioSummary[]>("/scenarios"),
  scenario: (name: string) => request<ScenarioDetail>(`/scenarios/${enc(name)}`),

  createSession: (body: { scenario: string; policy: string; seed?: number }) =>
    request<Session>("/sessions", { method: "POST", body }),
  session: (id: string) => request<Session>(`/sessions/${enc(id)}`),
  sessionTests: (id: string) => request<TestInfo[]>(`/sessions/${enc(id)}/tests`),
  recommendation: (id: string) => request<Recommendation>(`/sessions/${enc(id)}/recommendation`),
  executeTest: (id: string, test_id: string, expected_step: number) =>
    request<ExecuteTestResponse>(`/sessions/${enc(id)}/tests`, {
      method: "POST",
      body: { test_id, expected_step },
    }),
  declare: (id: string, fault_id: string) =>
    request<DeclareResponse>(`/sessions/${enc(id)}/declare`, {
      method: "POST",
      body: { fault_id },
    }),
  report: (id: string) => request<Report>(`/sessions/${enc(id)}/report`),

  experiments: () => request<Page<Experiment>>("/experiments?limit=50"),
  experiment: (id: string) => request<ExperimentDetail>(`/experiments/${enc(id)}`),
  startTraining: (body: { name: string; config: Record<string, unknown> }) =>
    request<Experiment>("/experiments/training", { method: "POST", body, admin: true }),
  evaluations: () => request<Page<Evaluation>>("/evaluations?limit=50"),
  evaluationResults: (id: string) => request<EvaluationResults>(`/evaluations/${enc(id)}/results`),
  startEvaluation: (body: { run_names: string[]; n_test: number; skip_robustness: boolean }) =>
    request<Evaluation>("/evaluations", { method: "POST", body, admin: true }),
  figureUrl: (evalId: string, name: string) =>
    `${API_BASE}/api/v1/evaluations/${enc(evalId)}/figures/${enc(name)}`,

  models: () => request<ModelVersion[]>("/models"),
  registerModel: (run_name: string) =>
    request<ModelVersion>("/models/register", {
      method: "POST",
      body: { run_name, checkpoint: "best" },
      admin: true,
    }),
  activateModel: (id: string) =>
    request<ModelVersion>(`/models/${enc(id)}/activate`, { method: "POST", admin: true }),
};
