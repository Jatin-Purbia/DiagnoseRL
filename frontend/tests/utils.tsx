import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import type { ReactElement, ReactNode } from "react";
import { vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { navStore } from "./navigation";

type Handler = (
  body: unknown,
  url: URL,
) => { status?: number; json: unknown } | Promise<{ status?: number; json: unknown }>;

export interface MockApi {
  calls: { key: string; body: unknown; headers: Record<string, string> }[];
  fetchMock: ReturnType<typeof vi.fn>;
  /** Replace or add routes while a test is running. */
  set: (routes: Record<string, Handler>) => void;
}

/**
 * Install a fake `fetch`. Keys are "METHOD /path" (query string ignored). Unknown routes return a
 * 404 in the backend's error shape, so a missing mock is visible rather than silently empty.
 */
export function mockApi(initial: Record<string, Handler>): MockApi {
  const routes = { ...initial };
  const calls: MockApi["calls"] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const handler = routes[key];
    if (!handler) {
      return new Response(JSON.stringify({ error: { code: "not_found", message: `no mock for ${key}`, details: {} } }), {
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
  return { calls, fetchMock, set: (r) => Object.assign(routes, r) };
}

export const ok = (json: unknown) => () => ({ json });
export const err = (status: number, code: string, message: string, details: Record<string, unknown> = {}) => () => ({
  status,
  json: { error: { code, message, details } },
});

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 }, mutations: { retry: false } },
  });
}

export function Wrapper({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const qc = client ?? makeClient();
  return (
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MotionConfig reducedMotion="always">{children}</MotionConfig>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(ui: ReactElement, opts: { client?: QueryClient; search?: string; path?: string } & RenderOptions = {}) {
  const { client, search, path, ...rest } = opts;
  navStore.reset(search ?? "", path ?? "/");
  const qc = client ?? makeClient();
  return { client: qc, ...render(ui, { wrapper: ({ children }) => <Wrapper client={qc}>{children}</Wrapper>, ...rest }) };
}
