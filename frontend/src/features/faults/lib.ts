import type { ScenarioDetail } from "@/lib/api";

interface TestSignal {
  testId: string;
  testName: string;
  /** Total-variation distance between this fault's outcome distribution and the prior-weighted mixture of all other faults (0 = identical, 1 = fully distinguishable). */
  separation: number;
  /** P(outcome | this fault) per outcome of the test (aligned with `scenario.outcomes`). */
  own: number[];
  /** The same for the other faults, prior-weighted. */
  others: number[];
}

/** How well each test separates one fault from the rest, strongest first. */
export function faultSignals(scenario: ScenarioDetail, faultIndex: number): TestSignal[] {
  const priors = scenario.faults.map((f) => f.prior);
  const restMass = priors.reduce((a, p, i) => (i === faultIndex ? a : a + p), 0) || 1;
  return scenario.tests
    .map((t) => {
      const own = t.likelihood[faultIndex] ?? [];
      const others = scenario.outcomes.map((_, o) =>
        t.likelihood.reduce((a, row, g) => (g === faultIndex ? a : a + (priors[g] ?? 0) * (row[o] ?? 0)), 0) / restMass,
      );
      const separation = 0.5 * own.reduce((a, p, o) => a + Math.abs(p - (others[o] ?? 0)), 0);
      return { testId: t.id, testName: t.name, separation, own, others };
    })
    .sort((a, b) => b.separation - a.separation);
}

export type Difficulty = "easy" | "moderate" | "hard";

interface FaultDifficulty {
  faultId: string;
  /** Best single-test separation from the other faults. */
  bestSeparation: number;
  bestTest: string;
  level: Difficulty;
}

/**
 * Estimated diagnostic difficulty: faults whose best test signature is least distinguishable from
 * the other faults are harder. The level is relative within the scenario (terciles of separation),
 * because absolute thresholds would be arbitrary.
 */
export function faultDifficulties(scenario: ScenarioDetail): FaultDifficulty[] {
  const raw = scenario.faults.map((f, i) => {
    const best = faultSignals(scenario, i)[0];
    return { faultId: f.id, bestSeparation: best?.separation ?? 0, bestTest: best?.testName ?? "—" };
  });
  const sorted = [...raw].sort((a, b) => a.bestSeparation - b.bestSeparation);
  const n = sorted.length;
  const level = (id: string): Difficulty => {
    const rank = sorted.findIndex((r) => r.faultId === id); // 0 = least separable
    if (rank < n / 3) return "hard";
    if (rank < (2 * n) / 3) return "moderate";
    return "easy";
  };
  return raw.map((r) => ({ ...r, level: level(r.faultId) }));
}
