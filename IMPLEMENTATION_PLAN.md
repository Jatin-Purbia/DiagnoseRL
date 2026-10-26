# DiagnoseRL — Implementation Plan and Status

Status legend: `[x]` done and verified · `[~]` done with caveats · `[ ]` not done

Last updated: 2026-10-22.

## Gap analysis (at project start)

The repository contained only `README.md` and `.gitignore`: no code, dependencies or tests. Everything
below was built from scratch.

Main risks identified up front, and how they were handled:

| Risk | Mitigation | Outcome |
|---|---|---|
| Unfair comparison (policies pick different tests, so stochastic outcomes differ) | Pre-sample every test outcome per incident; all policies replay the same incidents | implemented, tested |
| Invalid naive-Bayes update with correlated tests | Simulator is conditionally independent by construction; assumption documented | documented limitation |
| RL may not beat a good Bayesian baseline | Cost-aware Bayes policy + exact DP solver as references; report honestly | **PPO does lose on the 12-fault scenario** (see `docs/results.md`) |
| Timeout / terminal reward inconsistency | Truncation adds `-penalty_timeout` to the last test's reward, no correctness reward | implemented, tested, documented |
| `.gitignore` excludes `models/`, `data/` | Source packages avoid those names | done |
| Scope (full-stack platform) | Research core first, then web layers | all phases built |

## Milestones

| Phase | Status | Verification |
|---|---|---|
| 1 Foundation | `[x]` | package layout, pinned deps, validated scenario schema, structured logging, ruff + `mypy --strict` |
| 2 Simulation + Bayesian engine | `[x]` | Gymnasium `check_env`, hand-computed posteriors, mutual-information cross-check, no-leakage test |
| 3 Baselines (5 strategies) | `[x]` | exact solver == independent brute force and == simulated return; exact ≥ all others |
| 4 Reinforcement learning | `[x]` | train → save → reload → masked inference; same seed ⇒ bit-identical weights |
| 5 Research evaluation | `[x]` | held-out test set, validation-tuned baselines, paired bootstrap, robustness, ablation, RQ1–RQ5 in `docs/results.md` |
| 6 Backend + persistence | `[~]` | 70+ API/worker/registry/concurrency tests on SQLite; migration upgrade/check/downgrade; **not run against PostgreSQL** |
| 7 Frontend | `[~]` | 25 component/workflow tests, lint, typecheck, production build; **not viewed in a browser, no screenshots** |
| 8 Hardening + deployment | `[~]` | Dockerfiles, compose file (validated), CI workflow, security controls tested; **Docker images never built and CI never executed** (Docker daemon was not running; no GitHub run) |

## Verification log (2026-10-22)

* `ruff check .` and `ruff format --check`: clean. `mypy --strict src`: clean (58 files).
* `pytest`: all Python tests passing (config, Bayes, env, baselines, metrics, stats, training,
  experiment pipeline, API, models, worker, concurrency, stopping).
* Frontend: `eslint`, `tsc --noEmit`, `vitest` (25 tests), `next build` all pass.
* Real-server smoke test: uvicorn + the trained 2M-step PPO model, register → activate → session →
  recommendations → declare → report, all over HTTP (hidden fault never exposed).
* Real experiments run: 3 × 2M-step PPO seeds (standard), 3 × 500k-step PPO seeds (small), 3 × 2M-step
  no-posterior ablation seeds; evaluated on held-out incidents. Raw results in `docs/figures/`.

## Findings and decisions

* `torch 2.14.1` fails to load (WinError 1114) when the base Python is Anaconda (old MSVC runtime);
  pinned `torch 2.8.0` (oldest version accepted by stable-baselines3 2.9).
* Training-only `reward_scale` keeps PPO value targets O(1); evaluation uses raw rewards.
* SB3's default entropy coefficient (0.01) collapses to "one test, then declare"; 0.05 with learning
  rate 5e-4 trains stably. Tuned on validation only, one seed.
* Result summary: PPO ≫ runbook/random; PPO < information gain and cost-aware Bayes on the standard
  scenario (≈ −0.9 reward, CIs exclude 0); PPO ≈ 96% of optimal on the small scenario; posterior in the
  observation made no detectable difference; a nominal PPO does not adapt to a changed wrong-diagnosis
  penalty.

## Not done / known gaps

* Docker images and `docker compose up` were not run (daemon unavailable in this session). Compose
  file validation passes; the Dockerfiles are untested.
* PostgreSQL was not used in tests; row-level locking (`SELECT … FOR UPDATE`) is only exercised on
  SQLite, where it is a no-op. Concurrency safety rests on unique constraints and the version column,
  which are tested on SQLite.
* The GitHub Actions workflow has never run.
* No screenshots; the UI was not inspected in a real browser.
* No end-user authentication (admin API key only), no TLS: must sit behind a proxy.
* Nothing has been validated on real incident data (none available).
* RL tuning was light; 3 seeds; one scenario.
* No git commit has been made.
