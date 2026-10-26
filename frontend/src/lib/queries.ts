"use client";

// Query keys and read hooks. Every request receives react-query's AbortSignal, so navigating away
// or changing a filter cancels the in-flight call.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, type AnalyticsFilters, type SessionFilters } from "@/lib/api";

export const keys = {
  health: ["health"] as const,
  overview: ["overview"] as const,
  analytics: (f: AnalyticsFilters) => ["analytics", f] as const,
  policies: ["policies"] as const,
  scenarios: ["scenarios"] as const,
  scenario: (name: string) => ["scenario", name] as const,
  sessions: (f: SessionFilters) => ["sessions", f] as const,
  session: (id: string) => ["session", id] as const,
  sessionTests: (id: string, steps: number) => ["session", id, "tests", steps] as const,
  recommendation: (id: string, steps: number) => ["session", id, "recommendation", steps] as const,
  report: (id: string) => ["session", id, "report"] as const,
  experiments: ["experiments"] as const,
  experiment: (id: string) => ["experiment", id] as const,
  models: ["models"] as const,
  evaluations: ["evaluations"] as const,
  evaluationResults: (id: string) => ["evaluation", id, "results"] as const,
};

export const useHealth = () =>
  useQuery({
    queryKey: keys.health,
    queryFn: ({ signal }) => api.health(signal),
    refetchInterval: 15_000,
    retry: false,
    staleTime: 5_000,
  });

export const useOverview = () =>
  useQuery({ queryKey: keys.overview, queryFn: ({ signal }) => api.overview(signal) });

export const useAnalytics = (filters: AnalyticsFilters) =>
  useQuery({
    queryKey: keys.analytics(filters),
    queryFn: ({ signal }) => api.analytics(filters, signal),
    placeholderData: keepPreviousData,
  });

export const usePolicies = () =>
  useQuery({ queryKey: keys.policies, queryFn: ({ signal }) => api.policies(signal) });

export const useScenarios = () =>
  useQuery({ queryKey: keys.scenarios, queryFn: ({ signal }) => api.scenarios(signal), staleTime: 60_000 });

export const useScenario = (name: string | undefined) =>
  useQuery({
    queryKey: keys.scenario(name ?? ""),
    queryFn: ({ signal }) => api.scenario(name as string, signal),
    enabled: Boolean(name),
    staleTime: 5 * 60_000,
  });

export const useSessions = (filters: SessionFilters) =>
  useQuery({
    queryKey: keys.sessions(filters),
    queryFn: ({ signal }) => api.sessions(filters, signal),
    placeholderData: keepPreviousData,
  });

export const useExperiments = () =>
  useQuery({
    queryKey: keys.experiments,
    queryFn: ({ signal }) => api.experiments(signal),
    // Keep polling while anything is queued or running; survives page refreshes because the
    // state lives on the server.
    refetchInterval: (q) =>
      q.state.data?.items.some((e) => e.status === "running" || e.status === "queued") ? 3_000 : false,
  });

export const useExperiment = (id: string | null | undefined) =>
  useQuery({
    queryKey: keys.experiment(id ?? ""),
    queryFn: ({ signal }) => api.experiment(id as string, signal),
    enabled: Boolean(id),
    // Poll while the job is queued/running. The state lives on the server, so a page refresh or a
    // dropped connection simply resumes from the latest data.
    refetchInterval: (q) =>
      q.state.data?.status === "running" || q.state.data?.status === "queued" ? 3_000 : false,
  });

export const useModels = () =>
  useQuery({ queryKey: keys.models, queryFn: ({ signal }) => api.models(signal) });

export const useEvaluations = () =>
  useQuery({
    queryKey: keys.evaluations,
    queryFn: ({ signal }) => api.evaluations(signal),
    refetchInterval: (q) =>
      q.state.data?.items.some((e) => e.status === "running" || e.status === "queued") ? 4_000 : false,
  });

export const useEvaluationResults = (id: string | null | undefined) =>
  useQuery({
    queryKey: keys.evaluationResults(id ?? ""),
    queryFn: ({ signal }) => api.evaluationResults(id as string, signal),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });
