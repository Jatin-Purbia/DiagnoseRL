/** Chart colours resolve through CSS variables, so charts follow the light/dark theme automatically. */
export const C = {
  primary: "var(--primary)",
  secondary: "var(--secondary)",
  success: "var(--success)",
  warning: "var(--warning)",
  critical: "var(--critical)",
  muted: "var(--muted)",
  grid: "var(--border)",
  ink: "var(--ink)",
  violet: "#a78bfa",
  pink: "#f472b6",
} as const;

/** Categorical series colours (never relies on colour alone: charts also label series). */
export const SERIES = [C.primary, C.secondary, C.warning, C.violet, C.critical, C.success, C.pink];

export const POLICY_COLORS: Record<string, string> = {
  ppo: C.primary,
  cost_aware_bayes: C.success,
  info_gain: C.secondary,
  fixed_order: C.muted,
  random: C.warning,
  exact: C.violet,
};

const POLICY_LABELS: Record<string, string> = {
  ppo: "MaskablePPO",
  cost_aware_bayes: "Cost-aware Bayes",
  info_gain: "Information gain",
  fixed_order: "Fixed order",
  random: "Random",
  exact: "Exact optimum",
};

/** Compact labels for crowded axes. */
const POLICY_SHORT: Record<string, string> = {
  ppo: "PPO",
  cost_aware_bayes: "Cost-aware",
  info_gain: "Info gain",
  fixed_order: "Fixed",
  random: "Random",
  exact: "Exact",
};
export const policyShort = (p: string): string => POLICY_SHORT[p] ?? policyLabel(p);

export const policyLabel = (p: string): string => POLICY_LABELS[p] ?? p.replace(/_/g, " ");

export const AXIS = { stroke: "var(--muted)", fontSize: 11, tickLine: false } as const;

export const TOOLTIP_STYLE = {
  contentStyle: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    fontSize: 12,
    boxShadow: "var(--shadow)",
    color: "var(--ink)",
  },
  labelStyle: { color: "var(--ink)", fontWeight: 600 },
  itemStyle: { color: "var(--ink)" },
  cursor: { stroke: "var(--border)", fill: "var(--elevated)", fillOpacity: 0.5 },
} as const;
