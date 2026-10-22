import type { EvaluationResults, PolicySummary } from "@/lib/api";

export const BASELINE_ORDER = ["fixed_order", "random", "info_gain", "cost_aware_bayes"] as const;

export interface PolicyRow {
  key: string;
  label: string;
  accuracy: number;
  mean_tests: number;
  mean_duration: number;
  mean_cost: number;
  mean_reward: number;
  no_diagnosis_rate: number;
  /** Std across training seeds (RL only). */
  std?: { accuracy: number; mean_reward: number } | undefined;
  /** 95% CI over incidents (baselines). */
  reward_ci?: [number, number] | undefined;
  note?: string;
}

/** One row per strategy: baselines, PPO (mean over seeds) and the exact optimum when available. */
export function policyRows(r: EvaluationResults, labelOf: (k: string) => string): PolicyRow[] {
  const rows: PolicyRow[] = BASELINE_ORDER.filter((k) => k in r.baselines).map((k) => {
    const b = r.baselines[k]!;
    return {
      key: k,
      label: labelOf(k),
      accuracy: b.summary.accuracy,
      mean_tests: b.summary.mean_tests,
      mean_duration: b.summary.mean_duration,
      mean_cost: b.summary.mean_cost,
      mean_reward: b.summary.mean_reward,
      no_diagnosis_rate: b.summary.no_diagnosis_rate,
      reward_ci: b.reward_ci,
    };
  });
  if (r.rl) {
    const a = r.rl.aggregate;
    const m = (k: string) => a[k]?.mean ?? Number.NaN;
    rows.push({
      key: "ppo",
      label: labelOf("ppo"),
      accuracy: m("accuracy"),
      mean_tests: m("mean_tests"),
      mean_duration: m("mean_duration"),
      mean_cost: m("mean_cost"),
      mean_reward: m("mean_reward"),
      no_diagnosis_rate: m("no_diagnosis_rate"),
      std: { accuracy: a.accuracy?.std ?? 0, mean_reward: a.mean_reward?.std ?? 0 },
      note: `mean ± std over ${Object.keys(r.rl.per_seed).length} seed(s)`,
    });
  }
  const exact = r.reference?.exact;
  if (exact) {
    const s = exact.summary;
    rows.push({
      key: "exact",
      label: labelOf("exact"),
      accuracy: s.accuracy,
      mean_tests: s.mean_tests,
      mean_duration: s.mean_duration,
      mean_cost: s.mean_cost,
      mean_reward: s.mean_reward,
      no_diagnosis_rate: s.no_diagnosis_rate,
      note: "dynamic-programming optimum",
    });
  }
  return rows;
}

export interface XY {
  x: number;
  y: number;
}

/**
 * Non-dominated points: no other point has both lower-or-equal cost and higher-or-equal accuracy
 * (with at least one strict). Returned sorted by cost, ready to draw as a frontier line.
 */
export function paretoFront<T extends XY>(points: T[]): T[] {
  const front = points.filter(
    (p) => !points.some((q) => q !== p && q.x <= p.x && q.y >= p.y && (q.x < p.x || q.y > p.y)),
  );
  return front.sort((a, b) => a.x - b.x);
}

export interface Equivalence {
  equivalent: boolean;
  differences: string[];
}

/** Are two evaluations configured the same way, so that their numbers can be compared fairly? */
export function equivalence(a: EvaluationResults, b: EvaluationResults): Equivalence {
  const diffs: string[] = [];
  const ma = a.metadata;
  const mb = b.metadata;
  if (!ma || !mb) {
    diffs.push("one evaluation predates configuration metadata, so equivalence cannot be verified");
  } else {
    if (ma.scenario !== mb.scenario) diffs.push(`scenario (${ma.scenario} vs ${mb.scenario})`);
    if (ma.test_seed !== mb.test_seed) diffs.push(`evaluation seed (${ma.test_seed} vs ${mb.test_seed})`);
    if (ma.include_posterior !== mb.include_posterior) diffs.push("observation includes the posterior in only one");
    const ka = Object.keys(ma.reward).sort();
    const same = ka.length === Object.keys(mb.reward).length && ka.every((k) => ma.reward[k] === mb.reward[k]);
    if (!same) diffs.push("reward configuration");
  }
  if (a.n_test_episodes !== b.n_test_episodes) diffs.push(`test episodes (${a.n_test_episodes} vs ${b.n_test_episodes})`);
  return { equivalent: diffs.length === 0, differences: diffs };
}

export interface Confusion {
  truth: string;
  predicted: string;
  count: number;
  rate: number;
}

/** Most frequent mistakes: off-diagonal cells (including "no diagnosis") ordered by how often they occur. */
export function topConfusions(matrix: number[][], faultIds: string[], limit = 5): Confusion[] {
  const out: Confusion[] = [];
  matrix.forEach((row, i) => {
    const total = row.reduce((a, b) => a + b, 0);
    row.forEach((count, j) => {
      if (count > 0 && i !== j) {
        out.push({
          truth: faultIds[i] ?? `fault ${i}`,
          predicted: j >= faultIds.length ? "no diagnosis" : (faultIds[j] ?? `fault ${j}`),
          count,
          rate: total ? count / total : 0,
        });
      }
    });
  });
  return out.sort((a, b) => b.count - a.count).slice(0, limit);
}

export function normaliseRows(matrix: number[][]): number[][] {
  return matrix.map((row) => {
    const t = row.reduce((a, b) => a + b, 0);
    return row.map((v) => (t ? v / t : 0));
  });
}

/** Summary for the confusion-matrix selector: baselines plus each PPO seed. */
export function summaryChoices(r: EvaluationResults, labelOf: (k: string) => string): { key: string; label: string; summary: PolicySummary }[] {
  const choices: { key: string; label: string; summary: PolicySummary }[] = BASELINE_ORDER.filter(
    (k) => k in r.baselines,
  ).map((k) => ({
    key: k,
    label: labelOf(k),
    summary: r.baselines[k]!.summary,
  }));
  for (const [seed, summary] of Object.entries(r.rl?.per_seed_full ?? {})) {
    choices.push({ key: `ppo:${seed}`, label: `${labelOf("ppo")} (${seed})`, summary });
  }
  if (r.reference?.exact) choices.push({ key: "exact", label: labelOf("exact"), summary: r.reference.exact.summary });
  return choices;
}
