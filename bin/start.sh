#!/bin/sh
# Combined API + worker startup for single-container deployments
# (e.g. Render's free Web Service tier, which doesn't include a free
# Background Worker). For real production, run the API and worker as
# separate services using docker-compose.prod.yml instead.

set -e

# Apply any pending Alembic migrations before serving traffic. The
# docker-compose files do this in their command override, but a bare
# `docker run` (e.g. Render's free Web Service) bypasses compose, so we
# do it here. Idempotent — does nothing if the schema is already current.
alembic upgrade head

# Start the ARQ worker in the background. It shares the container's
# Python install, env vars, and network namespace with uvicorn.
arq worker.worker.WorkerSettings &
WORKER_PID=$!

# Forward SIGTERM/SIGINT to the worker so it shuts down cleanly when
# Render stops the container.
trap "kill -TERM $WORKER_PID 2>/dev/null; wait $WORKER_PID" TERM INT

# Run uvicorn in the foreground as PID 1 so Render's health checks
# and shutdown signals reach it directly.
exec uvicorn api.main:app --host 0.0.0.0 --port 8000
