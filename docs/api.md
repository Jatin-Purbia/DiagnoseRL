# API reference

Base URL: `http://localhost:8000`. Interactive documentation (OpenAPI) is served at `/docs` and
`/openapi.json`. All endpoints below are under `/api/v1` except health checks.

Errors always have the same shape:

```json
{ "error": { "code": "not_found", "message": "session … not found", "details": {} } }
```

| status | meaning |
|---|---|
| 400 | bad request (unknown test / fault / policy, invalid config) |
| 401 | missing or invalid `X-API-Key` for an admin endpoint |
| 404 | resource not found |
| 409 | state conflict (test already run, session finished, stale step, concurrent change, …) |
| 413 | request body too large |
| 422 | request validation failed |
| 429 | rate limit on expensive operations |
| 503 | admin endpoints disabled (no API key configured) |
| 504 | request timed out |

## Health

| method | path | |
|---|---|---|
| GET | `/health/live` | process is up |
| GET | `/health/ready` | database reachable and artifact directory present (503 otherwise) |

## Diagnostics

| method | path | |
|---|---|---|
| POST | `/sessions` | `{scenario, policy, seed?}` → new session (public view) |
| GET | `/sessions?limit&offset&status` | paginated list |
| GET | `/sessions/{id}` | session state, posterior, executed tests, available tests |
| GET | `/sessions/{id}/tests` | test catalogue with `executed` / `available` flags |
| POST | `/sessions/{id}/tests` | `{test_id, expected_step?}` run a simulated test |
| GET | `/sessions/{id}/recommendation` | policy's next action + explanation |
| POST | `/sessions/{id}/declare` | `{fault_id}` ends the investigation |
| GET | `/sessions/{id}/report` | final report (409 while the session is active) |
| GET | `/policies` | available policies; scenarios with an active RL model |
| GET | `/overview` | dashboard aggregates |

Policies: `cost_aware_bayes`, `info_gain`, `fixed_order`, `random`, `ppo` (needs an active model for
the scenario).

**Idempotency.** Send `expected_step` (the number of steps you believe were already taken) with
`POST /sessions/{id}/tests`. A retry of an already-applied step returns the recorded result with
`"replayed": true` instead of applying it twice; a different test at a consumed step is a `409
stale_step`. Declaring the same fault twice returns the original declaration; a different fault is a
`409 already_declared`.

**Explanations.** Information-gain and cost-aware recommendations report the quantities the policy
computed (expected entropy reduction, expected utility). PPO reports its masked action distribution
with an explicit note that these are action preferences, not calibrated probabilities or a causal
explanation.

## Scenarios

| method | path | |
|---|---|---|
| GET | `/scenarios` | summaries |
| GET | `/scenarios/{name}` | faults, priors, tests, outcome distributions `P(result \| fault, test)` |

## Models (registry)

| method | path | |
|---|---|---|
| GET | `/models`, `/models/{id}` | read |
| POST | `/models/register` | admin: `{run_name, checkpoint}` register a finished training run |
| POST | `/models/{id}/activate` | admin: validate and activate (audit-logged); one active model per scenario |
| POST | `/models/{id}/deactivate` | admin |

## Experiments and evaluations

| method | path | |
|---|---|---|
| POST | `/experiments/training` | admin, rate-limited: `{name, config}` queue a training run (202) |
| GET | `/experiments`, `/experiments/{id}` | list / status, progress, validation curve, artifacts |
| POST | `/experiments/{id}/cancel` | admin: only queued experiments |
| GET | `/experiments/{id}/artifacts[/{name}]` | `config.json`, `metrics.jsonl`, `summary.json` |
| POST | `/evaluations` | admin, rate-limited: queue an evaluation of trained runs (202) |
| GET | `/evaluations`, `/evaluations/{id}` | list / status |
| GET | `/evaluations/{id}/results` | full results (409 until succeeded) |
| GET | `/evaluations/{id}/figures/{name}.png` | generated figures |

Training configs are validated against `TrainConfig`. The server forces its own `output_dir`, accepts
only bundled scenario names (no file paths), and enforces limits (≤ 5,000,000 timesteps, ≤ 16
environments).

## Security notes

* Admin endpoints require `X-API-Key` (constant-time comparison); if no key is configured they are
  disabled, never open.
* CORS allows only the configured origins; request bodies are size-limited; requests time out.
* Expensive endpoints are rate-limited per client (in-memory, single process; put a shared limiter at
  the edge for multi-replica deployments).
* There is no end-user authentication: sessions are simulated and unauthenticated. Do not expose the
  service publicly without an authenticating reverse proxy.
