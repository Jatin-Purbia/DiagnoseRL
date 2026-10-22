import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, getAdminKey, request, setAdminKey } from "@/lib/api";
import { mockApi } from "./helpers";

/** Await a promise that must reject; returns the ApiError. */
const failure = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected the request to fail");
    },
    (e: unknown) => e as ApiError,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("request", () => {
  it("returns parsed JSON for successful responses", async () => {
    mockApi({ "GET /policies": () => ({ json: { policies: ["a"], ppo_available_for_scenarios: [] } }) });
    await expect(request("/policies")).resolves.toEqual({ policies: ["a"], ppo_available_for_scenarios: [] });
  });

  it("turns API error bodies into ApiError with code, message and details", async () => {
    mockApi({
      "POST /sessions": () => ({
        status: 409,
        json: { error: { code: "no_active_model", message: "no active model", details: { x: 1 } } },
      }),
    });
    const err = await failure(request("/sessions", { method: "POST", body: {} }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe("no_active_model");
    expect(err.message).toBe("no active model");
    expect(err.details).toEqual({ x: 1 });
  });

  it("handles non-JSON error bodies", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>oops</html>", { status: 502 })));
    const err = await failure(request("/overview"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.message).toContain("502");
  });

  it("reports an unreachable backend clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("failed to fetch"); }));
    const err = await failure(request("/overview"));
    expect(err.code).toBe("network_error");
    expect(err.message).toMatch(/backend/i);
  });

  it("sends the admin key only for admin requests", async () => {
    setAdminKey("secret");
    const { fetchMock } = mockApi({
      "GET /overview": () => ({ json: {} }),
      "POST /models/register": () => ({ json: {} }),
    });
    await request("/overview");
    await request("/models/register", { method: "POST", body: {}, admin: true });
    const [pub, adm] = fetchMock.mock.calls.map((c) => (c[1]?.headers ?? {}) as Record<string, string>);
    expect(pub?.["X-API-Key"]).toBeUndefined();
    expect(adm?.["X-API-Key"]).toBe("secret");
  });
});

describe("admin key storage", () => {
  it("lives in sessionStorage, never localStorage", () => {
    setAdminKey("abc");
    expect(getAdminKey()).toBe("abc");
    expect(sessionStorage.getItem("diagnoserl.adminKey")).toBe("abc");
    expect(localStorage.length).toBe(0);
    setAdminKey("");
    expect(getAdminKey()).toBe("");
  });
});
