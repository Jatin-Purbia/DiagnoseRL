# Using real incident data

The simulator's probabilities are hand-written. To use DiagnoseRL on a real system you need to
estimate them from that system's history. `diagnoserl.historical` provides the schema, the importer,
the estimator, a replay evaluation and an advisor-mode scaffold. **Nothing here has been validated on
real incidents**; the bundled example file is synthetic and labelled as such.

## Record schema

One JSON object per line (`.jsonl`) or a JSON array (`.json`):

```json
{
  "incident_id": "INC-1042",
  "timestamp": "2025-03-14T09:21:00Z",
  "confirmed_root_cause": "db_pool_exhaustion",
  "symptoms": ["http 503", "latency alert"],
  "tests": [
    {"test_id": "db_health_probe", "status": "observed", "outcome": "DEGRADED",
     "duration_seconds": 6.2, "cost": 1.0},
    {"test_id": "service_log_inspection", "status": "missing"}
  ],
  "resolution": {"fixed_by": "restart pool", "minutes_to_resolve": 34}
}
```

Three situations are kept distinct:

| situation | representation | used for probability estimates? |
|---|---|---|
| test ran, outcome known | `status: observed` + `outcome` (a `PASS` is real evidence) | yes |
| test ran, result lost / unusable | `status: missing` (no outcome allowed) | **no**: never treated as negative |
| test was not run | the test is absent from `tests` | no; but it is informative about engineer behaviour |

## Estimation

```python
from diagnoserl.historical import load_incidents, estimate_scenario, EstimationConfig

incidents = load_incidents("incidents.jsonl")
scenario, report = estimate_scenario(incidents, EstimationConfig(max_steps=8), name="my_system")
model = scenario.compile()        # ready for the environment, baselines and training
print(report.warnings)
```

* **Prior**: Laplace-smoothed frequency of confirmed root causes.
* **`P(outcome | fault, test)`**: counts over *observed* results, shrunk towards the test's pooled
  distribution with strength `smoothing` (default 3). Sparse cells therefore fall back to the pooled
  behaviour, and no probability is ever exactly zero (so no "impossible evidence").
* **Duration / cost**: mean of recorded values, with flagged defaults where none were recorded.
* **Checks** (`InsufficientDataError` / report warnings): minimum total incidents (20), at least two
  root causes, faults with fewer than 5 incidents, (test, fault) cells with fewer than 5
  observations, tests with a single observed outcome (dropped).

Generate a synthetic example (not real data):
`python -m diagnoserl.historical.make_example --out examples/incidents_example.jsonl`.

## Why selection bias matters

Engineers do not run tests at random. They run the test they expect to be informative given what
they already suspect. Consequences:

1. **Biased conditional probabilities.** The data estimate `P(outcome | fault, test was chosen)`.
   If a test is mostly run when engineers already suspect fault *f*, its outcomes for *f* reflect
   those suspected cases, and its outcomes for other faults come from rare, unusual cases. A policy
   that chooses tests differently faces a different mix of cases.
2. **Missingness is not random.** A test absent from an incident means "nobody thought it was
   worth running", which is a statement about the engineers' belief, not about the system.
3. **The test choice leaks the fault.** If a test is run at very different rates across faults, the
   decision to run it already carries information that the estimator ignores.

`EstimationReport.selection_bias` shows each test's run-rate per fault, and `biased_tests` lists the
tests whose rates differ by ≥ 3× across faults (configurable). Treat those estimates with suspicion;
the remedy is data collected under (partly) randomised or exhaustive testing, not more smoothing.

## Evaluating a policy on history

`replay_policy` steps a policy through recorded incidents using **only recorded outcomes**. When the
policy asks for a test that was never run in that incident, the outcome is unknown and the episode
cannot be scored. The result therefore reports:

* `coverage`: the share of incidents where the policy stayed within recorded tests;
* accuracy / reward / tests **on that subset only**, which is a *biased subset* (cases where the
  policy agrees with what engineers did). It is **not** an unbiased estimate of how the policy would
  have done on all incidents, and it is not a counterfactual.

Evaluating beyond the recorded tests requires simulating outcomes from the *estimated model*. That
is model-based evaluation: it inherits every assumption and bias above and must be reported as such,
separately from the directly observed replay.

## Advisor mode (read-only, human-approved)

`AdvisorSession` suggests the next test or diagnosis and updates its belief only from outcomes
returned by registered adapters. `AdapterRegistry` enforces:

* adapters must be **explicitly registered**, declare `read_only = True`, and list the network
  `destinations` they contact, all of which must be on the operator's **allowlist**;
* every execution needs a **named human approval** (`approved_by`), runs under a **timeout**, and is
  appended to an **audit log**;
* tests are never defined as shell commands, and there is **no remediation** capability.

Only a simulated adapter is provided. Real adapters (health probes, log queries) are future work and
need their own review, credentials handling and resource limits.
