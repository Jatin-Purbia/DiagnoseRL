import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { compact, modelledSeconds, pct, relativeTime, signed, wallClock } from "@/lib/format";
import { ApiError, getAdminKey, request, setAdminKey } from "@/lib/api/client";
import { session as sessionSchema } from "@/lib/api/schemas";
import { equivalence, normaliseRows, policyRows, topConfusions } from "@/features/comparison/lib";
import { faultDifficulties, faultSignals } from "@/features/faults/lib";
import { trendOf } from "@/features/overview/trend";
import { beliefSteps, currentStage, entropyBits, parseExplanation, testImpact } from "@/features/playground/derive";
import { DEFAULT_FORM, validateTraining } from "@/features/training/config";
import { shouldRetry } from "@/components/shell/Providers";
import { mergeByTimestep } from "@/features/training/TrainingMonitor";
import { binSeries } from "@/components/charts/Histogram";
import {
  afterOneTest,
  makeAnalytics,
  makeResults,
  makeScenarioDetail,
  makeSession,
  REC_PPO,
  REC_TEST,
} from "./fixtures";
import { err, mockApi, ok } from "./utils";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

// ------------------------------------------------------------------- API client
describe("request", () => {
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => {
        throw new Error("expected the request to fail");
      },
      (e: unknown) => e as ApiError,
    );

  it("validates responses against the schema and returns typed data", async () => {
    mockApi({ "GET /api/v1/sessions/x": ok(makeSession()) });
    const s = await request("/api/v1/sessions/x", { schema: sessionSchema });
    expect(s.status).toBe("active");
  });

  it("rejects a response that does not match the schema (backend/frontend drift)", async () => {
    mockApi({ "GET /api/v1/sessions/x": ok({ ...makeSession(), posterior: "nope" }) });
    const e = await failure(request("/api/v1/sessions/x", { schema: sessionSchema }));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe("invalid_response");
    expect(e.details.issues).toBeTruthy();
  });

  it("normalises backend errors", async () => {
    mockApi({ "POST /x": err(409, "no_active_model", "no active model", { a: 1 }) });
    const e = await failure(request("/x", { method: "POST", body: {} }));
    expect([e.status, e.code, e.message, e.details]).toEqual([409, "no_active_model", "no active model", { a: 1 }]);
  });

  it("handles non-JSON error bodies and unreachable backends", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 502 })));
    expect((await failure(request("/x"))).message).toContain("502");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("failed to fetch"); }));
    const e = await failure(request("/x"));
    expect(e.code).toBe("network_error");
    expect(e.friendly).toMatch(/backend/i);
  });

  it("propagates aborts untouched (cancelled requests are not errors)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    await expect(request("/x")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sends the admin key only for admin requests", async () => {
    setAdminKey("secret");
    const api = mockApi({ "GET /a": ok({}), "POST /b": ok({}) });
    await request("/a");
    await request("/b", { method: "POST", body: {}, admin: true, schema: z.object({}) });
    expect(api.calls[0]?.headers["X-API-Key"]).toBeUndefined();
    expect(api.calls[1]?.headers["X-API-Key"]).toBe("secret");
  });

  it("keeps the admin key in sessionStorage only", () => {
    setAdminKey("abc");
    expect(getAdminKey()).toBe("abc");
    expect(localStorage.length).toBe(0);
    setAdminKey("");
    expect(getAdminKey()).toBe("");
  });

  it("gives friendly messages for auth and rate-limit errors", () => {
    expect(new ApiError(401, "unauthorized", "x").friendly).toMatch(/Settings/);
    expect(new ApiError(503, "admin_disabled", "x").friendly).toMatch(/disabled/);
    expect(new ApiError(429, "rate_limited", "x").friendly).toMatch(/Too many/);
  });

  it("retries transient failures but never client errors", () => {
    expect(shouldRetry(0, new ApiError(0, "network_error", "x"))).toBe(true);
    expect(shouldRetry(0, new ApiError(500, "internal_error", "x"))).toBe(true);
    expect(shouldRetry(2, new ApiError(500, "internal_error", "x"))).toBe(false);
    expect(shouldRetry(0, new ApiError(404, "not_found", "x"))).toBe(false);
    expect(shouldRetry(0, new ApiError(200, "invalid_response", "x"))).toBe(false);
  });
});

// ----------------------------------------------------------------------- format
describe("format", () => {
  it("renders missing values as an em dash", () => {
    expect(pct(null)).toBe("—");
    expect(modelledSeconds(undefined)).toBe("—");
    expect(signed(Number.NaN)).toBe("—");
  });
  it("formats numbers", () => {
    expect(pct(0.7512)).toBe("75.1%");
    expect(signed(-1.234)).toBe("−1.23");
    expect(signed(2)).toBe("+2.00");
    expect(modelledSeconds(75)).toBe("1m 15s");
    expect(modelledSeconds(42)).toBe("42s");
    expect(wallClock(3725)).toBe("1h 2m");
    expect(wallClock(95)).toBe("1m 35s");
    expect(compact(1_500_000)).toBe("1.5M");
  });
  it("describes relative time", () => {
    const now = Date.parse("2026-10-22T12:00:00Z");
    expect(relativeTime("2026-10-22T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-10-22T11:30:00Z", now)).toBe("30 min ago");
    expect(relativeTime("2026-10-20T12:00:00Z", now)).toBe("2 d ago");
  });
});

// ------------------------------------------------------------------------ trend
describe("trendOf", () => {
  const rows = (accs: number[], sessions = 5) =>
    makeAnalytics({
      timeseries: accs.map((a, i) => ({
        date: `2026-10-${10 + i}`, sessions, correct: 0, accuracy: a, mean_tests: 5, mean_duration: 20, mean_cost: 6, mean_reward: 1,
      })),
    }).timeseries;

  it("is null without enough history, so no trend is invented", () => {
    expect(trendOf(rows([0.5, 0.6, 0.7]), "accuracy")).toBeNull();
    expect(trendOf([], "accuracy")).toBeNull();
  });
  it("compares the latest days with the earlier ones", () => {
    expect(trendOf(rows([0.5, 0.5, 0.7, 0.7]), "accuracy")).toBeCloseTo(0.2);
    expect(trendOf(rows([0.8, 0.8, 0.6, 0.6]), "accuracy")).toBeCloseTo(-0.2);
  });
  it("weights days by their session count", () => {
    const series = rows([0.5, 0.5, 0.9, 0.9]);
    series[3]!.sessions = 1; // a single-session day should barely move the recent average
    series[2]!.sessions = 9;
    expect(trendOf(series, "accuracy")).toBeCloseTo(0.4);
  });
});

// ------------------------------------------------------------ playground derive
describe("playground derive", () => {
  const faultNames = ["Database unavailable", "CPU saturation", "Disk full"];

  it("builds belief steps from the prior and every test", () => {
    const steps = beliefSteps(afterOneTest());
    expect(steps.map((s) => s.step)).toEqual([0, 1]);
    expect(steps[0]?.posterior).toEqual([0.5, 0.3, 0.2]);
    expect(steps[1]?.posterior[0]).toBeCloseTo(0.9);
    // with no tests yet the prior is the current posterior
    expect(beliefSteps(makeSession())[0]?.posterior).toEqual([0.5, 0.3, 0.2]);
  });

  it("computes entropy in bits", () => {
    expect(entropyBits([0.5, 0.5])).toBeCloseTo(1);
    expect(entropyBits([1, 0, 0])).toBe(0);
    expect(entropyBits([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(2);
  });

  it("summarises a test's impact", () => {
    const impact = testImpact(afterOneTest().executed[0]!, faultNames);
    expect(impact.fault).toBe("Database unavailable");
    expect(impact.deltaPoints).toBeCloseTo(40);
    expect(impact.entropyDelta).toBeLessThan(0); // the test reduced uncertainty
    expect(impact.leader).toBe("Database unavailable");
  });

  it("derives the workflow stage", () => {
    const idle = { runningTest: false, declaring: false, loadingRecommendation: false };
    expect(currentStage({ session: undefined, ...idle })).toBe(0);
    expect(currentStage({ session: makeSession(), ...idle })).toBe(1);
    expect(currentStage({ session: makeSession(), ...idle, loadingRecommendation: true })).toBe(0);
    expect(currentStage({ session: afterOneTest(), ...idle, runningTest: true })).toBe(2);
    expect(currentStage({ session: afterOneTest(), ...idle, loadingRecommendation: true })).toBe(3);
    expect(currentStage({ session: afterOneTest({ status: "declared" }), ...idle })).toBe(4);
  });

  it("keeps RL action preferences separate from policy metrics", () => {
    const ppo = parseExplanation(REC_PPO);
    expect(ppo.preferences[0]).toEqual({ action: "db_probe", probability: 0.62 });
    expect(ppo.note).toMatch(/not calibrated/);
    const bayes = parseExplanation(REC_TEST);
    expect(bayes.preferences).toEqual([]);
    expect(bayes.metrics.map((m) => m.key)).toContain("utility_declare_now");
  });
});

// --------------------------------------------------------------- training config
describe("validateTraining", () => {
  it("accepts the defaults and builds the server request", () => {
    const r = validateTraining(DEFAULT_FORM);
    expect(r.errors).toEqual({});
    expect(r.request?.config).toMatchObject({ scenario: "small", total_timesteps: 50000, seed: 0, reward: { penalty_wrong: 10 } });
  });
  it("rejects bad values with specific messages", () => {
    const bad = { ...DEFAULT_FORM, learning_rate: "-1", total_timesteps: "10", seed: "1.5", gamma: "abc", name: "  " };
    const { errors, request } = validateTraining(bad);
    expect(request).toBeUndefined();
    expect(errors.learning_rate).toMatch(/greater than 0/);
    expect(errors.total_timesteps).toMatch(/at least 1024/);
    expect(errors.seed).toMatch(/whole number/);
    expect(errors.gamma).toBeTruthy();
    expect(errors.name).toBeTruthy();
  });
  it("enforces the server limits", () => {
    expect(validateTraining({ ...DEFAULT_FORM, total_timesteps: "5000001" }).errors.total_timesteps).toMatch(/at most/);
    expect(validateTraining({ ...DEFAULT_FORM, n_envs: "17" }).errors.n_envs).toMatch(/at most 16/);
  });
  it("requires the batch size to divide the rollout and the seed to avoid reserved values", () => {
    expect(validateTraining({ ...DEFAULT_FORM, batch_size: "100" }).errors.batch_size).toMatch(/divide/);
    expect(validateTraining({ ...DEFAULT_FORM, seed: "10001" }).errors.seed).toMatch(/reserved/);
  });
});

// ------------------------------------------------------------------- comparison
describe("comparison lib", () => {
  it("builds rows for baselines, PPO and the exact optimum", () => {
    const r = makeResults();
    const rows = policyRows(r, (k) => k);
    expect(rows.map((x) => x.key)).toEqual(["fixed_order", "random", "info_gain", "cost_aware_bayes", "ppo"]);
    const ppo = rows.find((x) => x.key === "ppo")!;
    expect(ppo.mean_reward).toBeCloseTo(2.54);
    expect(ppo.std?.mean_reward).toBeCloseTo(0.16);
    const withExact = policyRows(makeResults({ reference: { exact: { optimal_value: 7, summary: r.baselines.info_gain!.summary } } }), (k) => k);
    expect(withExact.at(-1)?.key).toBe("exact");
  });

  it("flags evaluations that are not configured equivalently", () => {
    const a = makeResults();
    expect(equivalence(a, makeResults()).equivalent).toBe(true);
    const other = makeResults({
      n_test_episodes: 500,
      metadata: { ...a.metadata!, test_seed: 1, reward: { ...a.metadata!.reward, penalty_wrong: 40 } },
    });
    const eq = equivalence(a, other);
    expect(eq.equivalent).toBe(false);
    expect(eq.differences.join(" ")).toMatch(/evaluation seed/);
    expect(eq.differences.join(" ")).toMatch(/reward configuration/);
    expect(eq.differences.join(" ")).toMatch(/test episodes/);
  });

  it("cannot verify equivalence without metadata", () => {
    const old = makeResults();
    delete (old as { metadata?: unknown }).metadata;
    expect(equivalence(old, makeResults()).equivalent).toBe(false);
  });

  it("lists the most common mistakes, including 'no diagnosis'", () => {
    const m = [
      [8, 1, 1],
      [0, 5, 4],
    ];
    const top = topConfusions(m, ["a", "b"]);
    expect(top[0]).toMatchObject({ truth: "b", predicted: "no diagnosis", count: 4 });
    expect(top).toHaveLength(3); // (a→b), (a→none), (b→none)
    expect(normaliseRows(m)[1]).toEqual([0, 5 / 9, 4 / 9]);
    expect(normaliseRows([[0, 0]])).toEqual([[0, 0]]);
  });
});

// -------------------------------------------------------------------- faults lib
describe("fault signatures", () => {
  const sc = makeScenarioDetail();

  it("ranks tests by how well they separate a fault from the rest", () => {
    const sig = faultSignals(sc, 0); // db_down is clearly signalled by db_probe
    expect(sig[0]?.testId).toBe("db_probe");
    expect(sig[0]!.separation).toBeGreaterThan(0.7);
    expect(sig[1]!.separation).toBeLessThan(sig[0]!.separation);
  });

  it("separation is 0 when a fault behaves exactly like the others", () => {
    const same = makeScenarioDetail();
    same.tests = [{ ...same.tests[0]!, likelihood: [[0.5, 0.5], [0.5, 0.5], [0.5, 0.5]] }];
    expect(faultSignals(same, 1)[0]?.separation).toBeCloseTo(0);
  });

  it("assigns relative difficulty: the most separable fault is easiest", () => {
    const d = faultDifficulties(sc);
    const byId = Object.fromEntries(d.map((x) => [x.faultId, x]));
    expect(byId.db_down?.level).toBe("easy");
    expect(byId.disk_full?.level).toBe("hard"); // disk_full looks like cpu_high for db_probe
    expect(new Set(d.map((x) => x.level)).size).toBeGreaterThan(1);
  });
});

// ------------------------------------------------------------------ chart helpers
describe("chart helpers", () => {
  it("merges series that share a timestep axis", () => {
    const rows = mergeByTimestep(
      [{ timesteps: 10, a: 1 }, { timesteps: 30, a: 3 }],
      [{ timesteps: 20, b: 2 }, { timesteps: 30, b: 9 }],
    );
    expect(rows).toEqual([
      { timesteps: 10, a: 1 },
      { timesteps: 20, b: 2 },
      { timesteps: 30, a: 3, b: 9 },
    ]);
  });

  it("bins samples into normalised shares that each sum to one", () => {
    const rows = binSeries(
      [
        { key: "a", label: "A", color: "#000", values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
        { key: "b", label: "B", color: "#111", values: [10, 10, 10, 10] },
      ],
      5,
    );
    expect(rows).toHaveLength(5);
    expect(rows.reduce((a, r) => a + (r.a as number), 0)).toBeCloseTo(1);
    expect(rows.reduce((a, r) => a + (r.b as number), 0)).toBeCloseTo(1);
    expect(binSeries([], 5)).toEqual([]);
  });
});
