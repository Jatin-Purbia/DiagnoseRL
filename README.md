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

## Train and evaluate (command line)

```bash
python -m diagnoserl.training.train --config configs/smoke.yaml        # ~15 s check
python -m diagnoserl.training.train --config configs/full.yaml --seed 0 --run-name full_seed0
python -m diagnoserl.evaluation.run --runs artifacts/runs/full_seed0 --out artifacts/eval/standard
```

## Test

```bash
pytest -q
cd frontend && npm test
```
