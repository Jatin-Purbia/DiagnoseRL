# RL formulation

## Problem

A hidden root cause `f` is drawn from a prior `P(f)` over `F` faults. The agent may run
diagnostic tests (each at most once) and finally declares a fault. Test outcomes are noisy.
Running tests costs resources and time; a wrong or missing diagnosis is penalised.

This is a **partially observable MDP**: the state `(f, evidence)` is only partly observed.
Because the evidence determines the Bayesian posterior over `f`, the posterior is a sufficient
statistic of the history (together with which tests ran and the step count), so a policy can be
a function of `(posterior, executed tests, spend, steps)`.

## Bayesian belief

Outcomes are assumed **conditionally independent given the fault** (naive-Bayes). With evidence
`E = {(t_i, o_i)}`:

```
P(f | E)  ∝  P(f) · Π_i P(o_i | f, t_i)
```

Computed in log space with log-sum-exp; zero-probability outcomes are `-inf`; if every fault is
ruled out, `ImpossibleEvidenceError` is raised (`src/diagnoserl/bayes.py`).

Predictive outcome distribution and expected information gain (bits):

```
P(o | E, t) = Σ_f P(f | E) P(o | f, t)
IG(t)       = H(P(f | E)) − Σ_o P(o | E, t) · H(P(f | E, (t, o)))
```

**If tests were correlated given the fault, this update would be invalid** (it would double-count
evidence). The simulator samples each test's outcome independently given the fault, so the model is
exactly right for the simulator; real systems need a joint observation model.

## Actions

`T + F` discrete actions: `0..T-1` run test `t`; `T..T+F-1` declare fault `f`.
Masked: tests already run, and tests whose prerequisites (`requires`) have not run.
Declarations are always legal (until the episode ends).

## Observation

Concatenation, all in `[0, 1]`, `float32`:

| part | size | meaning |
|---|---|---|
| outcome one-hot | `T·O` | outcome of each executed test (zeros if not run) |
| executed mask | `T` | which tests have run |
| spend | 3 | cost / total cost, elapsed / total time, remaining steps / `max_steps` |
| posterior | `F` | `P(f | evidence)` (omit with `include_posterior: false`) |

The hidden fault never appears in the observation or in `info` until the episode has ended.

## Reward

```
test t:            −(λ_cost · cost_t / max_cost + λ_time · duration_t / max_duration)
correct declare:   +R_correct                     (terminated)
wrong declare:     −P_wrong                       (terminated)
step cap reached:  −P_timeout  added to the last test's reward   (truncated)
```

Costs and durations are normalised by the largest test value, so the weights are comparable across
scenarios. Defaults: `R_correct = P_wrong = P_timeout = 10`, `λ_cost = λ_time = 0.5`.

**Timeout semantics.** If the step counter reaches `max_steps` on a *test* action, the episode is
truncated: the reward of that step is the test penalty **plus** `−P_timeout`, no correctness reward
is given, and the episode is counted as "no diagnosis" (never as a success). Declaring on the last
allowed step is a normal terminated episode.

## Termination

* `terminated = True` after a declaration; `info["correct"]` records correctness.
* `truncated = True` when the step cap is hit without a declaration.
* After either, `step()` raises until `reset()`.

## Objective

Maximise expected undiscounted return (`gamma = 1` for evaluation; training also uses 1.0). This
equals accuracy-weighted reward minus the weighted cost and time of the tests used.

## Training-only reward scaling

`reward_scale` (default 10) divides rewards seen by PPO to keep value targets O(1). It does not
change the environment, the optimal policy, or any evaluation (monitoring and validation use raw
rewards).

## Exact reference

For small scenarios `ExactSolver` computes the optimal policy by dynamic programming over evidence
tuples (see `src/diagnoserl/baselines/exact.py`). It is validated against an independent brute-force
recursion in the tests and against the simulator's average return. State count is `(O+1)^T`, so it
only scales to small scenarios (the shipped `small` scenario has 1,024 states).
