// Low-level HTTP client: base URL, admin key, error normalisation, cancellation, schema validation.

import type { z } from "zod";

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

const ADMIN_KEY_STORAGE = "diagnoserl.adminKey";

/** The admin key lives in sessionStorage (cleared when the tab closes), never localStorage. */
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
    globalThis.dispatchEvent?.(new Event("diagnoserl:admin-key"));
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

  /** Human-friendly summary suitable for a toast. */
  get friendly(): string {
    if (this.code === "network_error") return "Cannot reach the API. Is the backend running?";
    if (this.status === 401) return "Admin API key missing or invalid. Set it in Settings.";
    if (this.status === 503 && this.code === "admin_disabled")
      return "Admin actions are disabled on the server (no API key configured).";
    if (this.status === 429) return "Too many requests. Wait a moment and try again.";
    return this.message;
  }
}

export interface RequestOptions<S extends z.ZodTypeAny> {
  method?: "GET" | "POST";
  body?: unknown;
  admin?: boolean;
  signal?: AbortSignal;
  schema?: S;
}

export async function request<S extends z.ZodTypeAny = z.ZodUnknown>(
  path: string,
  opts: RequestOptions<S> = {},
): Promise<z.infer<S>> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.admin) headers["X-API-Key"] = getAdminKey();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", `Cannot reach the API at ${API_BASE}.`);
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

  const json: unknown = await res.json();
  if (!opts.schema) return json as z.infer<S>;
  const parsed = opts.schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      res.status,
      "invalid_response",
      `Unexpected response from ${path} (the backend and frontend may be out of sync).`,
      { issues: parsed.error.issues.slice(0, 5) },
    );
  }
  return parsed.data;
}
