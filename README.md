# DiagnoseRL

DiagnoseRL uses reinforcement learning to identify software faults by selecting
diagnostic tests and deciding when to declare a root cause. The agent is trained
in a simulated application and learns to balance diagnosis accuracy against the
time and cost of running tests.

Its troubleshooting efficiency is evaluated against fixed-order, random, and
information-gain strategies.

## Motivation

When a system fails, engineers choose which check to run next: a health probe,
a log query, a runbook step. Each check costs time and sometimes money, and each
result is only partly informative. Experienced responders do this by intuition;
runbooks do it in a fixed order that ignores what has already been learned.

DiagnoseRL treats troubleshooting as a **sequential decision problem under
uncertainty**:

- The true root cause is hidden.
- Tests are noisy, costly, and slow.
- At any point the agent can gather more evidence or commit to a diagnosis.
- Committing too early risks a wrong answer; waiting too long wastes time.

The goal is a policy that reaches the right diagnosis with the least total
effort, and a fair benchmark to show whether it beats simpler strategies.

## Problem formulation

### Hidden state
Each episode samples one root cause `f` from a set of `N` faults (for example
database down, stale cache, bad deploy, network partition, disk full), drawn from
a prior `P(f)`. The agent never observes `f` directly.

### Diagnostic tests
There are `M` tests. Each test `t` has:

- a **cost** `c_t` (money or resources),
- a **duration** `d_t` (time to run),
- an **outcome model** `P(result | f, t)`, which makes results noisy. A test that
  always revealed the fault would make the problem trivial.

Each test can be run at most once per episode (results are treated as
deterministic once observed).

### Observation
The agent sees:

- the result of every test run so far (not run / pass / fail),
- elapsed time and accumulated cost,
- optionally, a belief vector `b(f) = P(f | evidence)` computed with Bayes' rule.

### Actions
- **Run test `t`** (`M` actions; already-run tests are masked out).
- **Declare fault `f`** (`N` actions; ends the episode).

"Continue investigating" is simply running another test, so it is not a separate
action.

### Reward
```
reward = + R_correct                    if the declared fault is right
         - P_wrong                      if the declared fault is wrong
         - λ_cost * c_t - λ_time * d_t  for each test run
         - P_timeout                    if the step limit is hit without a declaration
```
The weights `R_correct`, `P_wrong`, `λ_cost`, `λ_time`, and `P_timeout` define the
trade-off. Raising the test penalties favors fast, cheap, riskier diagnoses;
raising `P_wrong` favors thorough ones. Episodes are capped at a maximum number of
steps, and reaching the cap counts as "no root cause identified".

### Objective
Maximize expected return, which is equivalent to maximizing diagnostic accuracy
minus the weighted cost and time of the tests used.

## Strategies compared

All policies run on identical fault sequences and seeds.

- **Fixed-order**: runs tests in a predetermined order, then declares the most
  likely fault.
- **Random**: selects an unused test at random and declares at a random stopping
  point.
- **Information gain**: maintains a Bayesian posterior over faults, greedily
  picks the test with the highest expected entropy reduction per unit cost, and
  declares once the posterior exceeds a confidence threshold. This is the
  strongest hand-built baseline and shows whether learning adds anything.
- **Reinforcement learning**: a policy (PPO or DQN with action masking) trained
  on simulated episodes. It can in principle learn effects the greedy baseline
  misses, such as test dependencies, non-uniform costs, and when stopping early is
  worth the risk.

If the information-gain baseline matches the RL agent, that is a valid result:
the simpler, more explainable method wins.

## Evaluation

Metrics, reported per policy over a fixed set of evaluation episodes:

- Root-cause identification accuracy.
- Number of tests executed.
- Diagnostic time.
- Testing cost.
- Rate of episodes with no root cause identified.
- Mean episode reward (combined efficiency score).

Results are summarized as a comparison table and an accuracy-versus-cost curve.
The question being answered: can the learned agent reduce troubleshooting effort
while maintaining or improving accuracy?

## Path to real-world use

A policy trained on a hand-written simulator does not transfer to a real system
on its own. The intended path to practical use is to learn the fault/test model
from real data:

1. **Config-driven environment.** Faults, tests, costs, and outcome
   probabilities are loaded from configuration, not hard-coded.
2. **Estimate from history.** Fit `P(result | fault, test)` and the fault prior
   from past incidents, postmortems, and tickets.
3. **Map real checks to tests.** Health probes, log queries, and runbook steps
   become tests with measured cost and duration.
4. **Train per system.** Build the simulator from those tables and train or
   fine-tune the policy.
5. **Replay evaluation.** Test on held-out past incidents: would the agent have
   reached the root cause faster than the humans did?
6. **Advisor mode first.** Suggest the next test and show the current belief and
   reasoning; a human decides. Only safe, read-only checks are candidates for
   automation.

Candidate domains include SRE and incident triage, IT helpdesk troubleshooting,
network operations, and industrial diagnostics.

## Project structure

```text
DiagnoseRL/
├── environment/      # Simulated application, fault/test config, diagnostic state
├── agents/           # Reinforcement-learning policies
├── baselines/        # Fixed-order, random, and information-gain policies
├── training/         # Training loops and experiment configuration
├── evaluation/       # Metrics, comparisons, and result generation
├── tests/            # Unit and integration tests
└── README.md
```

## Roadmap

1. Project skeleton and dependencies.
2. Config-driven environment with unit tests.
3. Baseline policies and the evaluation harness (produces numbers before any RL).
4. RL training with multiple seeds.
5. Comparison plots and real run commands in this README.
6. Learn the fault/test model from real incident data and pilot in advisor mode.

## Getting started

This project is under active development. Once the training entry point is
available, a typical local workflow will be:

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
```

Run training, baseline evaluation, and result generation using the commands
provided by the corresponding modules or experiment scripts.

## Reproducibility

For comparable experiments, record the random seed, environment configuration,
available diagnostic tests, reward weights, training steps, and evaluation
episodes. Generated model checkpoints, datasets, logs, and experiment outputs
are intentionally excluded from version control; see
[`.gitignore`](.gitignore) for the complete list.

## License

No license has been specified yet.
