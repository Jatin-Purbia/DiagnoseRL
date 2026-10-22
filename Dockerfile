# Backend image: API, migrations and the background worker (same image, different command).
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# CPU-only torch first (avoids the multi-GB CUDA download), then the pinned requirements.
COPY requirements.txt requirements-api.txt ./
RUN pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip install -r requirements-api.txt

COPY pyproject.toml README.md alembic.ini ./
COPY src ./src
COPY alembic ./alembic
COPY configs ./configs
RUN pip install --no-deps -e .

# Run as an unprivileged user; artifacts live on a mounted volume.
RUN useradd --create-home --uid 10001 diagnoserl \
    && mkdir -p /artifacts \
    && chown -R diagnoserl:diagnoserl /app /artifacts
USER diagnoserl

ENV DIAGNOSERL_ENVIRONMENT=prod \
    DIAGNOSERL_ARTIFACT_DIR=/artifacts

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health/live', timeout=3).status == 200 else 1)"

CMD ["uvicorn", "diagnoserl.api.main:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000"]
