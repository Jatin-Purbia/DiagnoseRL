# Environment and scenario format

`DiagnoseRLEnv` (`src/diagnoserl/env.py`) is a Gymnasium environment built from a
`DiagnosticModel`, which is compiled from a validated scenario file.

## Scenario files

Bundled scenarios live in `src/diagnoserl/config/scenarios/`:

| name | faults | tests | purpose |
|---|---|---|---|
| `standard` | 12 | 13 | main benchmark |
| `small` | 4 | 5 | exact-solver validation, fast smoke runs |

Use your own with `load_model("path/to/scenario.yaml")` (YAML or JSON).

```yaml
name: my_scenario
max_steps: 8                 # step cap; tests + the final declaration count as steps
faults:
  - {id: db_down, name: Database down, prior: 0.6}        # enabled priors must sum to 1
  - {id: cpu_high, name: CPU saturation, prior: 0.4}
  - {id: spare, name: Unused, prior: 0.0, enabled: false}  # disabled faults are dropped
tests:
  - id: db_probe
    name: Database probe
    category: database
    cost: 1                  # resource units (>= 0)
    duration: 5              # seconds (>= 0)
    outcomes: [PASS, FAIL, DEGRADED]
    requires: []             # tests that must run first (eligibility constraint)
    likelihood:
      default: {PASS: 0.9, FAIL: 0.04, DEGRADED: 0.06}   # faults not listed below
      overrides:
        db_down: {PASS: 0.05, FAIL: 0.9, DEGRADED: 0.05}
```

## Validation (enforced at load time)

* Probabilities are finite, non-negative and every distribution sums to 1.
* All referenced faults, tests and outcomes exist; ids are unique.
* Enabled faults have non-zero priors that sum to 1; at least two are enabled.
* Costs and durations are non-negative; prerequisites are acyclic.
* Unknown keys are rejected.

## Design rules for believable scenarios

* Give every test a *noise floor* in `default` (false alarms) so no outcome is certain.
* Let several faults affect each test, so a single test cannot identify the cause. The test suite
  asserts that no single test in `standard` allows >60% Bayes-optimal accuracy.
* Mix cheap/broad and expensive/informative tests so there is a real cost trade-off.

The shipped probabilities are **hand-authored for the simulation**. They are not measured from real
systems.

## Simulation semantics

* One primary root cause per episode.
* Each test can run once. Outcomes are sampled from `P(o | fault, test)`.
* **Pre-sampled incidents.** An `Incident` holds the hidden fault and the outcome every test
  *would* return. Policies that run the same test on the same incident see the same result, so
  comparisons are paired. Because outcomes are independent given the fault this is equivalent to
  sampling on demand.
* `generate_incidents(model, n, seed)` is deterministic; incident `i` depends only on `(seed, i)`.
* Seeds: training episodes come from the training seed's stream; validation and test sets use
  separate seeds (`val_seed`, `test_seed`) that the training config requires to differ.
* `PublicState` is what a policy may know (outcomes, posterior, spend, legal-action mask). It
  contains no hidden information. `env.hidden_fault` exists for evaluation code only.
