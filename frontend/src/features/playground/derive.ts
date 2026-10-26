// Pure helpers that turn backend session data into what the playground displays.
// Everything numeric here is derived from posteriors the backend's Bayesian engine produced.

import type { ExecutedTest, Recommendation, Session } from "@/lib/api";

interface BeliefStep {
  step: number;
  label: string;
  posterior: number[];
}

/** Posterior after each step. Step 0 is the prior (the belief before any test). */
export function beliefSteps(session: Session): BeliefStep[] {
  const prior = session.executed[0]?.posterior_before ?? session.posterior.map((p) => p.probability);
  return [
    { step: 0, label: "Prior", posterior: prior },
    ...session.executed.map((e) => ({ step: e.step, label: e.test_name, posterior: e.posterior_after })),
  ];
}

export function entropyBits(p: number[]): number {
  let h = 0;
  for (const x of p) if (x > 0) h -= x * Math.log2(x);
  return h;
}

interface Impact {
  /** The fault whose probability moved the most, and by how many percentage points. */
  fault: string;
  deltaPoints: number;
  /** Change in uncertainty (negative = the test taught us something). */
  entropyDelta: number;
  /** Leading hypothesis after the test. */
  leader: string;
  leaderProbability: number;
}

export function testImpact(e: ExecutedTest, faultNames: string[]): Impact {
  let best = 0;
  let move = 0;
  e.posterior_after.forEach((p, i) => {
    const d = p - (e.posterior_before[i] ?? 0);
    if (Math.abs(d) > Math.abs(move)) {
      move = d;
      best = i;
    }
  });
  const lead = e.posterior_after.reduce((m, p, i, a) => (p > (a[m] ?? 0) ? i : m), 0);
  return {
    fault: faultNames[best] ?? `fault ${best}`,
    deltaPoints: move * 100,
    entropyDelta: entropyBits(e.posterior_after) - entropyBits(e.posterior_before),
    leader: faultNames[lead] ?? `fault ${lead}`,
    leaderProbability: e.posterior_after[lead] ?? 0,
  };
}

export type Stage = 0 | 1 | 2 | 3 | 4;

export const STAGES = [
  { key: "incident", label: "Incident detected" },
  { key: "evidence", label: "Evidence collection" },
  { key: "execution", label: "Test execution" },
  { key: "belief", label: "Belief update" },
  { key: "diagnosis", label: "Diagnosis" },
] as const;

/** Which step of the investigation workflow is currently happening. */
export function currentStage(input: {
  session: Session | undefined;
  runningTest: boolean;
  declaring: boolean;
  loadingRecommendation: boolean;
}): Stage {
  const { session } = input;
  if (!session) return 0;
  if (session.status !== "active" || input.declaring) return 4;
  if (input.runningTest) return 2;
  if (session.steps > 0 && input.loadingRecommendation) return 3;
  return session.steps === 0 && input.loadingRecommendation ? 0 : 1;
}

interface ActionPreference {
  action: string;
  probability: number;
}

interface PolicyExplanation {
  method: string | null;
  /** Network output; only present for the RL policy. Never a calibrated diagnosis confidence. */
  preferences: ActionPreference[];
  note: string | null;
  /** Policy-specific scalar quantities (information gain, expected utility, ...). */
  metrics: { key: string; label: string; value: number | string }[];
}

const METRIC_LABELS: Record<string, string> = {
  expected_entropy_reduction_bits: "Expected entropy reduction (bits)",
  weighted_cost: "Weighted test cost",
  gain_per_cost: "Information gain per cost",
  current_entropy_bits: "Current entropy (bits)",
  utility_declare_now: "Expected utility if declared now",
  utility_best_test: "Expected utility of best test",
  value_of_testing: "Value of testing",
  confidence: "Posterior confidence in leader",
};

export function parseExplanation(rec: Recommendation): PolicyExplanation {
  const ex = rec.explanation as Record<string, unknown>;
  const prefs = Array.isArray(ex.top_actions) ? (ex.top_actions as ActionPreference[]) : [];
  const metrics = Object.entries(ex)
    .filter(([k, v]) => k in METRIC_LABELS && (typeof v === "number" || typeof v === "string"))
    .map(([k, v]) => ({ key: k, label: METRIC_LABELS[k] as string, value: v as number | string }));
  return {
    method: typeof ex.method === "string" ? ex.method : null,
    preferences: prefs,
    note: typeof ex.note === "string" ? ex.note : null,
    metrics,
  };
}

/** Human label for an RL action id such as "db_health_probe" or "declare:db_unavailable". */
export function actionLabel(action: string, testNames: Map<string, string>, faultNames: Map<string, string>): string {
  if (action.startsWith("declare:")) {
    const id = action.slice("declare:".length);
    return `Declare ${faultNames.get(id) ?? id}`;
  }
  return testNames.get(action) ?? action.replace(/_/g, " ");
}
