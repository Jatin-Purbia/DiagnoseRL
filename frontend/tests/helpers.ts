import { vi } from "vitest";
import type { ExecutedTest, Session, TestInfo } from "@/lib/types";

type Handler = (body: unknown, url: URL) => { status?: number; json: unknown } | Promise<{ status?: number; json: unknown }>;

/** Install a fake `fetch`. Keys are "METHOD /path" relative to /api/v1 (query string ignored). */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { key: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const key = `${init?.method ?? "GET"} ${path}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body });
    const handler = routes[key];
    if (!handler) {
      return new Response(JSON.stringify({ error: { code: "not_found", message: `no route ${key}` } }), {
        status: 404,
      });
    }
    const res = await handler(body, url);
    return new Response(JSON.stringify(res.json), {
      status: res.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

export const FAULTS = [
  { id: "db_down", name: "Database unavailable" },
  { id: "cpu_high", name: "CPU saturation" },
  { id: "disk_full", name: "Disk full" },
];

export function makeSession(over: Partial<Session> = {}): Session {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    scenario: "small",
    policy: "cost_aware_bayes",
    model_version_id: null,
    status: "active",
    steps: 0,
    max_steps: 6,
    cost: 0,
    elapsed: 0,
    total_reward: 0,
    fault_ids: FAULTS.map((f) => f.id),
    posterior: FAULTS.map((f, i) => ({ id: f.id, name: f.name, probability: [0.5, 0.3, 0.2][i] ?? 0 })),
    entropy_bits: 1.49,
    confidence: 0.5,
    executed: [],
    available_tests: ["db_probe", "cpu_check"],
    created_at: "2026-10-22T00:00:00Z",
    completed_at: null,
    ...over,
  };
}

export const TESTS: TestInfo[] = [
  { id: "db_probe", name: "Database probe", category: "database", cost: 1, duration: 5, outcomes: ["PASS", "FAIL"], requires: [], executed: false, available: true },
  { id: "cpu_check", name: "CPU check", category: "host", cost: 1, duration: 3, outcomes: ["PASS", "FAIL"], requires: [], executed: false, available: true },
];

export function makeExecuted(over: Partial<ExecutedTest> = {}): ExecutedTest {
  return {
    step: 1,
    test_id: "db_probe",
    test_name: "Database probe",
    outcome: "FAIL",
    cost: 1,
    duration: 5,
    posterior_before: [0.5, 0.3, 0.2],
    posterior_after: [0.9, 0.06, 0.04],
    recommendation: null,
    followed_recommendation: true,
    ...over,
  };
}
