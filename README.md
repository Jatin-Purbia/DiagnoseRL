# DiagnoseRL

Reinforcement learning for cost-aware software fault diagnosis (simulation only). More detail and
benchmark results are in [docs/](docs/) (start with [docs/results.md](docs/results.md)).

## Requirements

Python 3.11+, Node 22, and optionally Docker.

## Run with Docker

```bash
cp .env.example .env        # set POSTGRES_PASSWORD and DIAGNOSERL_ADMIN_API_KEY
docker compose up --build
```

Frontend: http://localhost:3000 · API docs: http://localhost:8000/docs

## Run locally

```bash
# 1. install
python -m venv .venv
.venv\Scripts\activate                      # macOS/Linux: source .venv/bin/activate
pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-dev.txt -r requirements-api.txt
pip install --no-deps -e .

# 2. backend (terminal 1)
set DIAGNOSERL_ADMIN_API_KEY=dev-key        # macOS/Linux: export DIAGNOSERL_ADMIN_API_KEY=dev-key
uvicorn diagnoserl.api.main:app_factory --factory --reload

# 3. worker for training/evaluation jobs (terminal 2, same env var)
python -m diagnoserl.api.worker

# 4. frontend (terminal 3)
cd frontend
npm ci
npm run dev                                 # http://localhost:3000
```

In the UI, enter the same admin key in the sidebar to start training or activate a model.
The worker (step 3) is only needed for training/evaluation jobs.

## Trained agents

The agents behind [docs/results.md](docs/results.md) are committed under `artifacts/runs/`:
`full_seed0..2` (scenario `standard`, 2M steps) and `small_seed0..2` (scenario `small`, 500k steps).
Each folder holds `best_model.zip` (checkpoint chosen on validation), `final_model.zip`, `config.json`,
`metrics.jsonl` and `summary.json`. They can be evaluated directly, without retraining:

```bash
python -m diagnoserl.evaluation.run     --runs artifacts/runs/full_seed0 artifacts/runs/full_seed1 artifacts/runs/full_seed2     --out artifacts/eval/standard
```

## Reproduce the results

```bash
# quick check (~15 s)
python -m diagnoserl.training.train --config configs/smoke.yaml

# standard scenario: 3 seeds x 2M steps (about 45 min per seed on a laptop CPU)
python -m diagnoserl.training.train --config configs/full.yaml --seed 0 --run-name full_seed0
python -m diagnoserl.training.train --config configs/full.yaml --seed 1 --run-name full_seed1
python -m diagnoserl.training.train --config configs/full.yaml --seed 2 --run-name full_seed2

# small scenario (compared against the exact optimum)
python -m diagnoserl.training.train --config configs/small_full.yaml --seed 0 --run-name small_seed0

# evaluate on 2,000 held-out incidents (writes results.json, report.md, figures/)
python -m diagnoserl.evaluation.run     --runs artifacts/runs/full_seed0 artifacts/runs/full_seed1 artifacts/runs/full_seed2     --out artifacts/eval/standard
```

Training and test incidents use separate seeds, so evaluation is on incidents the agent never saw.
Results are written to `artifacts/eval/` and match the tables in `docs/results.md` for the same seeds.

## Test

```bash
pytest -q
cd frontend && npm test
```
