/** Plain-language explanations of ML / diagnosis terms, shown as tooltips next to the term. */
export const GLOSSARY = {
  posterior:
    "The probability of each root cause given all test results so far, computed with Bayes' rule from the scenario's prior and test outcome models.",
  prior: "How likely each root cause is before any test has been run.",
  entropy:
    "Uncertainty about the root cause, in bits. 0 means certain; higher means the probability is spread across more candidates.",
  informationGain:
    "How much a test is expected to reduce entropy. The information-gain policy picks the test with the best reduction per unit cost.",
  belief: "The agent's current probability distribution over root causes (the posterior).",
  policy:
    "The rule that picks the next action (run a test, or declare a root cause) from the current state.",
  actionPreference:
    "The policy network's score for each action at this state. It is not a calibrated probability that the diagnosis is correct, and not a causal explanation.",
  reward:
    "Episode score: + for a correct diagnosis, − for a wrong one, minus a penalty for each test's cost and time, and a penalty for running out of steps.",
  accuracy: "Share of investigations that ended with the correct root cause declared. Running out of steps counts as a failure.",
  maskablePpo:
    "Proximal Policy Optimisation with action masking, so already-run or ineligible tests can never be chosen.",
  paired:
    "Policies are compared on identical incidents with identical test outcomes, so differences are not due to easier or harder cases.",
  ci: "95% bootstrap confidence interval. If it excludes zero, the difference is unlikely to be sampling noise.",
  truncated: "The step limit was reached without declaring a root cause.",
  modelled:
    "Durations and costs come from the scenario's test model (simulated units), not from wall-clock time.",
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;
