# Deployment

## Docker Compose (recommended)

```bash
cp .env.example .env          # set POSTGRES_PASSWORD and DIAGNOSERL_ADMIN_API_KEY
docker compose up --build     # add  --profile mlflow  for the MLflow UI
```

Compose refuses to start if either secret is missing; there are no default credentials.

| service | port | notes |
|---|---|---|
| frontend | 3000 | Next.js standalone server |
| api | 8000 | FastAPI; docs at `/docs`; health at `/health/live`, `/health/ready` |
| worker | – | runs queued training / evaluation jobs |
| db | – | PostgreSQL 16, volume `pgdata` |
| migrate | – | one-shot `alembic upgrade head` before api/worker start |
| mlflow | 5000 | optional (`--profile mlflow`), SQLite store on the artifacts volume |

Volumes: `pgdata` (database), `artifacts` (checkpoints, metrics, figures; shared by api, worker,
mlflow). Logs: `docker compose logs -f api worker` (JSON lines). Shutdown is graceful: the API gets
20 s, the worker 60 s; a job interrupted anyway is marked `failed` on the next worker start.

The browser-visible API URL is baked into the frontend at build time (`PUBLIC_API_URL`, default
`http://localhost:8000`). If you change the frontend origin, also change
`DIAGNOSERL_CORS_ORIGINS` in `docker-compose.yml`.

## Local development without Docker

```bash
python -m venv .venv && .venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-dev.txt -r requirements-api.txt
pip install --no-deps -e .

# backend (SQLite, tables created automatically in dev)
set DIAGNOSERL_ADMIN_API_KEY=dev-key                       # macOS/Linux: export …
uvicorn diagnoserl.api.main:app_factory --factory --reload
python -m diagnoserl.api.worker                            # second terminal

# frontend
cd frontend && npm ci && npm run dev                       # http://localhost:3000
```

For PostgreSQL set `DIAGNOSERL_DATABASE_URL=postgresql+psycopg://user:pass@host:5432/db` and run
`alembic upgrade head` (the API only creates tables itself when `DIAGNOSERL_ENVIRONMENT=dev`).

## Configuration (`DIAGNOSERL_*`)

| variable | default | |
|---|---|---|
| `ENVIRONMENT` | `dev` | `prod` disables automatic table creation |
| `DATABASE_URL` | `sqlite:///artifacts/diagnoserl.db` | SQLAlchemy URL |
| `ARTIFACT_DIR` | `artifacts` | checkpoints, metrics, figures |
| `ADMIN_API_KEY` | unset | unset disables admin endpoints |
| `CORS_ORIGINS` | `["http://localhost:3000"]` | JSON list |
| `MAX_BODY_BYTES` | 1,000,000 | |
| `REQUEST_TIMEOUT_SECONDS` | 30 | |
| `EXPENSIVE_RATE_LIMIT_PER_MINUTE` | 6 | training / evaluation requests per client |

## CI

`.github/workflows/ci.yml` runs on every push/PR: ruff, `mypy --strict`, pytest, migration check
(`alembic upgrade head` + `alembic check`), a smoke training run (seconds), frontend lint /
typecheck / tests / build, compose validation and Docker image builds. Full RL experiments are
deliberately **not** part of CI.

## Operational notes

* Back up the `pgdata` volume and the `artifacts` volume together (model rows reference files).
* The rate limiter is per process. Behind several API replicas, enforce limits at the proxy.
* TLS, end-user authentication and secrets management are out of scope for this repository; place it
  behind a reverse proxy that provides them.
