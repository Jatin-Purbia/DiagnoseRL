# Architecture

DiagnoseRL is a **modular monolith**: one backend codebase with clear internal boundaries, a
separate worker process for long jobs, and a Next.js frontend. Nothing needs to be split into
microservices yet; the boundaries below make that possible later.

```
                    ┌───────────────────────────────┐
  Browser ─────────►│ Next.js frontend (port 3000)  │
                    └───────────────┬───────────────┘
                                    │ HTTP/JSON  (/api/v1)
                    ┌───────────────▼───────────────┐
                    │ FastAPI backend (port 8000)   │
                    │  routers → services → engine  │
                    └───┬───────────────────┬───────┘
                        │ SQLAlchemy        │ filesystem
              ┌─────────▼────────┐   ┌──────▼────────────────────┐
              │ PostgreSQL       │   │ artifact dir (/artifacts) │
              │ sessions, jobs,  │   │ checkpoints, metrics,     │
              │ models, audit    │   │ figures, evaluation JSON  │
              └─────────▲────────┘   └──────▲────────────────────┘
                        │ claims jobs       │ writes
                    ┌───┴───────────────────┴───┐
                    │ Worker process            │──► MLflow (optional) / TensorBoard
                    │ training + evaluation     │
                    └───────────────────────────┘
```

## Layers (backend)

| layer | package | responsibility | depends on |
|---|---|---|---|
| Domain | `diagnoserl.config`, `bayes`, `incident` | scenario schema/validation, Bayesian belief, incidents | numpy, pydantic |
| Simulation | `diagnoserl.env` | Gymnasium `DiagnoseRLEnv`, rewards, masking | domain |
| Policies | `diagnoserl.baselines`, `agents` | baselines, exact solver, RL policy wrapper | simulation |
| ML | `diagnoserl.training` | MaskablePPO training, validation, checkpoints | policies |
| Evaluation | `diagnoserl.evaluation` | metrics, comparisons, statistics, plots, robustness | policies |
| Application | `diagnoserl.api.services` | sessions, model registry, jobs, analytics | all of the above, ORM |
| Persistence | `diagnoserl.api.orm`, `database`, `alembic/` | tables, migrations | SQLAlchemy |
| HTTP | `diagnoserl.api.routers`, `schemas`, `errors`, `security` | endpoints, validation, auth, limits | services |
| Worker | `diagnoserl.api.worker` | executes queued training / evaluation jobs | services |

Rules that keep the layers honest:

* **The simulator is usable alone.** Nothing under `config`, `bayes`, `env`, `baselines`, `agents`,
  `training` or `evaluation` imports the web stack.
* **Business logic lives in services**, not route handlers (handlers validate, call a service,
  commit, return).
* **Policy randomness is separate from simulation randomness.** Incidents are pre-sampled from
  their own seeded streams; policies get their own seeds.
* **The hidden fault never reaches a policy.** Policies see `PublicState` / the observation only.
  The API never returns the true fault while a session is active.

## Diagnostic session flow

1. `POST /sessions` samples an incident (hidden fault + all test outcomes) and stores it
   server-side. The response contains only public information.
2. `GET /sessions/{id}/recommendation` replays the session's evidence into a fresh
   `DiagnoseRLEnv`, builds the requested policy and returns its next action and explanation.
3. `POST /sessions/{id}/tests` locks the session row, checks legality, applies the pre-sampled
   outcome, updates the posterior, records the posterior before/after and the recommendation that
   was shown, and commits. Retrying with the same `expected_step` is idempotent.
4. `POST /sessions/{id}/declare` ends the session (`declared`). Using the last allowed step on a
   test without declaring ends it as `truncated`, matching the environment's timeout semantics.
5. `GET /sessions/{id}/report` returns the full trace (only after the session has ended).

Session state machine: `active → declared | truncated`. Mutations use `SELECT … FOR UPDATE`
(PostgreSQL) plus an optimistic `version` column; unique constraints on `(session_id, step)` and
`(session_id, test_id)` guarantee a step can only be applied once. Conflicts become HTTP 409.

## Jobs

Training and evaluation are rows in the database (`queued → running → succeeded | failed`). The API
only enqueues; the worker claims a job with an atomic `UPDATE … WHERE status = 'queued'`. Jobs left
`running` by a crashed worker are marked `failed` on the next start. Progress is read from the
run's `metrics.jsonl`.

## Data model

`diagnostic_sessions`, `executed_tests`, `posterior_snapshots`, `fault_declarations`,
`training_experiments`, `model_versions`, `evaluation_runs`, `evaluation_metrics`, `audit_events`.
Large files (checkpoints, figures) live on disk under the artifact directory and are referenced by
validated relative paths plus a SHA-256 hash.

## Model registry and safety

* Registration records the checkpoint's hash and validation metrics.
* Activation (admin, audit-logged) re-verifies the hash, checks that the checkpoint's observation
  and action spaces match the scenario, and requires recorded validation metrics.
* At inference time the hash is checked again before loading.
* SB3 checkpoints are pickle-based, so only checkpoints produced by this system's own worker
  (stored under the artifact directory) are ever loaded. Arbitrary uploads are not supported.

See `docs/limitations.md` for what this system does and does not establish.
