"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, ApiError, type Recommendation, type Session } from "@/lib/api";
import { keys } from "@/lib/queries";

export type Mode = "manual" | "agent";
export const SPEEDS = [0.5, 1, 2, 4] as const;
/** On-screen pause between agent steps at 1x. Purely visual: modelled durations/costs/rewards are untouched. */
export const BASE_STEP_DELAY_MS = 1100;

export interface StartConfig {
  scenario: string;
  policy: string;
  seed: number;
}

const START_KEY = (id: string) => `diagnoserl.investigation.${id}`;

function saveStart(id: string, cfg: StartConfig) {
  try {
    sessionStorage.setItem(START_KEY(id), JSON.stringify(cfg));
  } catch {
    /* storage unavailable: Reset will pick a new seed */
  }
}

function loadStart(id: string): StartConfig | null {
  try {
    const raw = sessionStorage.getItem(START_KEY(id));
    return raw ? (JSON.parse(raw) as StartConfig) : null;
  } catch {
    return null;
  }
}

export const randomSeed = () => Math.floor(Math.random() * 1_000_000_000);

/**
 * Owns one investigation: the session (kept in the URL so refresh/share works), its derived
 * queries, the manual/agent controls and the visual-only speed.
 */
export function useInvestigation() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const qc = useQueryClient();
  const sessionId = params.get("session");

  const [mode, setMode] = useState<Mode>("manual");
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);

  const sessionQ = useQuery({
    queryKey: keys.session(sessionId ?? ""),
    queryFn: ({ signal }) => api.session(sessionId as string, signal),
    enabled: Boolean(sessionId),
    staleTime: 30_000,
  });
  const session = sessionQ.data;
  const active = session?.status === "active";
  const steps = session?.steps ?? 0;

  const testsQ = useQuery({
    queryKey: keys.sessionTests(sessionId ?? "", steps),
    queryFn: ({ signal }) => api.sessionTests(sessionId as string, signal),
    enabled: Boolean(session),
  });
  const recQ = useQuery({
    queryKey: keys.recommendation(sessionId ?? "", steps),
    queryFn: ({ signal }) => api.recommendation(sessionId as string, signal),
    enabled: Boolean(session) && active,
    staleTime: Infinity,
    retry: false,
  });
  const reportQ = useQuery({
    queryKey: keys.report(sessionId ?? ""),
    queryFn: ({ signal }) => api.report(sessionId as string, signal),
    enabled: Boolean(session) && !active,
  });

  const open = useCallback(
    (id: string | null) => {
      router.replace(id ? `${pathname}?session=${id}` : pathname);
    },
    [router, pathname],
  );

  const setSession = useCallback(
    (s: Session) => qc.setQueryData(keys.session(s.id), s),
    [qc],
  );

  const start = useMutation({
    mutationFn: (cfg: StartConfig) => api.createSession(cfg),
    onSuccess: (s, cfg) => {
      setSession(s);
      saveStart(s.id, cfg);
      setPlaying(false);
      open(s.id);
      toast.success("Investigation started", { description: `Incident ${s.id.slice(0, 8)} · ${s.scenario}` });
    },
  });

  const runTest = useMutation({
    mutationFn: (testId: string) => api.executeTest(sessionId as string, testId, steps),
    onSuccess: (res) => {
      setSession(res.session);
      if (res.session.status === "truncated") {
        setPlaying(false);
        toast.warning("Step limit reached", { description: "The investigation ended without a diagnosis." });
      }
    },
    onError: async (err) => {
      setPlaying(false);
      if (err instanceof ApiError && err.status === 409 && sessionId) {
        // The session moved on elsewhere (another tab / a retry): resync instead of failing silently.
        await qc.invalidateQueries({ queryKey: keys.session(sessionId) });
      }
    },
  });

  const declare = useMutation({
    mutationFn: (faultId: string) => api.declare(sessionId as string, faultId),
    onSuccess: (res) => {
      setSession(res.session);
      setPlaying(false);
      toast[res.declaration.correct ? "success" : "error"](
        res.declaration.correct ? "Correct diagnosis" : "Incorrect diagnosis",
        { description: `Declared ${res.declaration.fault_id.replace(/_/g, " ")}; actual: ${res.true_fault.replace(/_/g, " ")}` },
      );
    },
  });

  const busy = runTest.isPending || declare.isPending || start.isPending;

  /** Perform the policy's recommended action (a test or the declaration). */
  const followRecommendation = useCallback(
    (rec: Recommendation | undefined = recQ.data) => {
      if (!rec || busy || !active) return;
      if (rec.action.type === "test") runTest.mutate(rec.action.id);
      else declare.mutate(rec.action.id);
    },
    [recQ.data, busy, active, runTest, declare],
  );

  // Agent mode: advance on a visual timer. The delay changes with `speed`; the modelled
  // duration, cost and reward of each action never do.
  const followRef = useRef(followRecommendation);
  followRef.current = followRecommendation;
  useEffect(() => {
    if (mode !== "agent" || !playing || !active || busy || !recQ.data) return;
    const t = setTimeout(() => followRef.current(), BASE_STEP_DELAY_MS / speed);
    return () => clearTimeout(t);
  }, [mode, playing, active, busy, recQ.data, speed, steps]);

  // Leaving agent mode (or finishing) always pauses.
  useEffect(() => {
    if (mode !== "agent" || !active) setPlaying(false);
  }, [mode, active]);

  /** Start a fresh investigation of the same incident (same scenario, policy and seed). */
  const reset = useCallback(() => {
    if (!session) return;
    const cfg = (sessionId ? loadStart(sessionId) : null) ?? {
      scenario: session.scenario,
      policy: session.policy,
      seed: randomSeed(),
    };
    start.mutate(cfg);
  }, [session, sessionId, start]);

  const startConfig = useMemo(() => (sessionId ? loadStart(sessionId) : null), [sessionId]);

  return {
    sessionId,
    session,
    sessionQ,
    tests: testsQ.data,
    recommendation: recQ,
    report: reportQ,
    active,
    busy,
    start,
    runTest,
    declare,
    followRecommendation,
    reset,
    open,
    mode,
    setMode,
    playing,
    setPlaying,
    speed,
    setSpeed,
    startConfig,
  };
}
