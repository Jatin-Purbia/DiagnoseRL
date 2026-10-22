# DiagnoseRL

DiagnoseRL learns **which diagnostic test to run next, and when to stop and name the root cause**,
when tests are noisy, cost resources and take time. It treats troubleshooting as a sequential
decision problem under uncertainty, trains a reinforcement-learning agent (MaskablePPO) in a
simulated application, and compares it with fixed-order, random, information-gain, cost-aware
Bayesian and exact (dynamic-programming) strategies.

> **Status: research prototype on a simulator.** All probabilities are hand-authored. Results show
> how policies behave in the simulation; they say nothing yet about real systems. See
> [Known limitations](#known-limitations).

## Problem statement

When a system fails, engineers pick the next check (a health probe, a log query, a runbook step).
Each check costs time and money and gives only a partly informative answer. Runbooks follow a fixed
order that ignores what has already been learned; experienced responders use intuition.

DiagnoseRL formalises this:

* A **hidden root cause** is drawn from a prior (12 faults in the standard scenario).
* **Tests** (13 in the standard scenario) have a cost, a duration and a noisy outcome model
  `P(result | fault, test)`; no single test reveals the cause.
* The agent can run an unused test or **declare** a fault. Correct declarations earn reward, wrong
  ones are penalised, every test costs a little, and running out of steps without declaring is penalised.
* After every result a **Bayesian posterior** over faults is updated; policies decide whether more
  evidence is worth its cost.

Details: [docs/rl-formulation.md](docs/rl-formulation.md), [docs/environment.md](docs/environment.md).

## Key features

* Validated, configurable scenarios (YAML/JSON) and a Gymnasium environment with action masking,
  prerequisite constraints, deterministic seeding and paired, pre-sampled evaluation incidents.
* Numerically stable Bayesian belief engine (log space, impossible-evidence detection, entropy,
  expected information gain), verified against hand-computed and independently derived values.
* Five reference strategies, including an **exact DP solver** for small scenarios, cross-checked
  against an independent brute-force recursion and against simulated returns.
* MaskablePPO training with fixed validation incidents, checkpointing, TensorBoard and MLflow;
  same seed gives bit-identical weights.
* Evaluation pipeline with held-out test incidents, validation-tuned baselines, paired bootstrap
  confidence intervals, per-fault metrics, confusion matrices and robustness sweeps.
* FastAPI backend (sessions, model registry, durable training/evaluation jobs, audit log), PostgreSQL
  via SQLAlchemy/Alembic, and a dark Next.js dashboard with a live diagnostic playground.
* Tooling for real data: incident schema, parameter estimation with smoothing, selection-bias
  diagnostics, replay evaluation that separates observed from model-based results, and a read-only,
  human-approved advisor-mode scaffold ([docs/historical-data.md](docs/historical-data.md)).

## Architecture

```
Browser → Next.js frontend → FastAPI backend → diagnostic engine
                                 │                (environment, Bayesian belief, policies)
                      PostgreSQL ┴ artifact dir ← worker (training, evaluation) → MLflow / TensorBoard
```

See [docs/architecture.md](docs/architecture.md).

## Repository layout

```text
src/diagnoserl/
  config/        scenario schema, loader, bundled scenarios (standard, small), transforms
  bayes.py       posterior, entropy, information gain
  incident.py    hidden fault + pre-sampled outcomes for every test
  env.py         DiagnoseRLEnv (Gymnasium)
  baselines/     fixed order, random, information gain, cost-aware Bayes, exact solver
  agents/        RL policy wrapper
  training/      MaskablePPO training, configs, validation callback
  evaluation/    runner, metrics, statistics, comparison, robustness, plots, CLI
  api/           FastAPI app, ORM, services, routers, worker
  historical/    real-data schema, estimation, replay, advisor mode
configs/         training configs (smoke, full, ablation)
alembic/         database migrations
frontend/        Next.js dashboard
docs/            architecture, formulation, environment, API, training, evaluation, results, deployment,
                 historical data, limitations
tests/           168 Python tests (frontend tests live in frontend/tests)
```

## Installation

Requirements: Python 3.11+, Node 22 (frontend), Docker (optional).

```bash
python -m venv .venv
.venv\Scripts\activate                       # macOS/Linux: source .venv/bin/activate

pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-dev.txt -r requirements-api.txt
pip install --no-deps -e .
```

`torch 2.8.0` is pinned on purpose: 2.14.1 failed to load on a Windows machine whose Python came
from Anaconda (an old `msvcp140.dll` shadows the system runtime). See [docs/training.md](docs/training.md).

## Run

```bash
# 1. Docker Compose: database, migrations, API, worker, frontend
cp .env.example .env            # set POSTGRES_PASSWORD and DIAGNOSERL_ADMIN_API_KEY
docker compose up --build       # frontend :3000, API :8000 (docs at /docs)

# 2. or locally (SQLite)
uvicorn diagnoserl.api.main:app_factory --factory --reload
python -m diagnoserl.api.worker
cd frontend && npm ci && npm run dev
```

Full details and configuration: [docs/deployment.md](docs/deployment.md), [docs/api.md](docs/api.md).

## Train

```bash
python -m diagnoserl.training.train --config configs/smoke.yaml        # ~15 s pipeline check
python -m diagnoserl.training.train --config configs/full.yaml --seed 0 --run-name full_seed0
# repeat for --seed 1 and 2; configs/ablation_no_posterior.yaml removes the posterior from the observation
```

Outputs go to `artifacts/runs/<run>/` (git-ignored). See [docs/training.md](docs/training.md).

## Evaluate

```bash
python -m diagnoserl.evaluation.run \
    --runs artifacts/runs/full_seed0 artifacts/runs/full_seed1 artifacts/runs/full_seed2 \
    --out artifacts/eval/standard
```

Writes `results.json`, `report.md` and figures. Protocol: [docs/evaluation.md](docs/evaluation.md).

## Test

```bash
ruff check . && ruff format --check src tests
mypy src                       # strict
pytest -q                      # 168 tests
python -m diagnoserl.training.train --config configs/smoke.yaml
cd frontend && npm run lint && npm run typecheck && npm test && npm run build
```

## Benchmark results

Simulator results on the `standard` scenario (12 faults, 13 tests): 2,000 held-out test incidents,
baseline parameters tuned on separate validation incidents, PPO = 3 training seeds × 2M timesteps.
Reward is per incident (higher is better). Full tables, statistics, robustness sweeps and the
research-question answers are in [docs/results.md](docs/results.md); raw data is in
[docs/figures/](docs/figures/).

| policy | accuracy | tests | cost | mean reward (95% CI) |
|---|---|---|---|---|
| fixed order (8 tests) | 0.578 | 8.00 | 11.00 | −0.42 [−0.85, 0.01] |
| random | 0.438 | 5.08 | 7.69 | −2.72 [−2.98, −2.48] |
| information gain | 0.732 | 6.16 | 7.04 | 3.40 [3.00, 3.78] |
| cost-aware Bayes (2-step lookahead) | 0.740 | 6.10 | 7.16 | 3.52 [3.13, 3.91] |
| **PPO** (mean ± std, 3 seeds) | 0.687 ± 0.011 | 5.58 ± 0.26 | 6.76 ± 0.33 | 2.54 ± 0.16 |

What the evidence supports:

* **PPO clearly beats runbook and random troubleshooting** (paired bootstrap: +2.97 and +5.27 reward,
  intervals far from 0).
* **PPO does not beat the Bayesian baselines on the 12-fault scenario**: −0.85 vs information gain
  and −0.98 vs cost-aware Bayes (both intervals exclude 0), about 25–30% less reward. It learns
  adaptive stopping but stops somewhat early.
* **On the small 4-fault scenario PPO is near-optimal**: 6.74 ± 0.08 against an exact
  dynamic-programming optimum of 6.95 (about 96% of optimal on identical incidents) and statistically
  indistinguishable from information gain.
* Removing the Bayesian posterior from PPO's observation made no detectable difference (2.43 ± 0.24
  vs 2.54 ± 0.16, 3 seeds).
* Under noisier tests, costlier tests and shifted priors the ordering is unchanged, but a nominally
  trained PPO cannot adapt when the wrong-diagnosis penalty changes (the gap to the Bayesian policy
  grows from 0.6 to 2.7), because it was not retrained.

These are simulator results from one hand-authored scenario, three seeds and light tuning; they are
not evidence about real systems.

## Known limitations

See [docs/limitations.md](docs/limitations.md). In short: simulation only with hand-written
probabilities; naive-Bayes independence of test outcomes; one root cause per episode; categorical
outcomes; a fixed-size policy network tied to its scenario; limited RL tuning and a small number of
seeds; exact solver only for small scenarios; no end-user authentication in the web layer.

## Future development

* Estimate scenarios from real incidents and measure how simulator-trained policies transfer
  (start with advisor mode and replay evaluation, [docs/historical-data.md](docs/historical-data.md)).
* Correlated test outcomes (joint observation model) and multiple simultaneous faults.
* Set-based policy architectures that generalise across test catalogues.
* Stronger RL (reward shaping, curriculum, belief-state supervision) to close the gap to the Bayesian
  baselines, or a hybrid that uses the Bayesian policy as a teacher.
* Real, allowlisted read-only diagnostic adapters with human approval.

## License

No license has been specified yet.
