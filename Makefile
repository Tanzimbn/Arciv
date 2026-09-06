# Arciv — local development shortcuts.
#
# Nothing here is required: every target is a thin wrapper over the docker
# compose / pytest commands documented in README.md. They exist so a fresh
# clone has one obvious path through setup.
#
# Run `make` with no arguments for the list.

.DEFAULT_GOAL := help
.PHONY: help setup up down restart logs ps health venv test test-unit \
        test-services test-services-down lint frontend clean-test

# Tests run on the host (not in a container) and need the dev dependencies.
# 3.12 matches the Dockerfile and CI — asyncpg and pydantic-core have no 3.13
# wheels at the pinned versions.
VENV    ?= venv
PYTHON  ?= python3.12
PY      := $(VENV)/bin/python
TEST_DATABASE_URL ?= postgresql://arciv:arciv@localhost:55432/arciv_test
TEST_REDIS_URL    ?= redis://localhost:56379/15

help:  ## Show this help
	@echo "Arciv — local development"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "First time:  make setup && make up"

# --- Running the stack ----------------------------------------------------- #

setup:  ## Create .env with generated secrets (safe to re-run)
	@./scripts/bootstrap-env.sh

up:  ## Start the full stack (db, redis, embed, mailhog, api, worker)
	@test -f .env || { echo "No .env — run 'make setup' first."; exit 1; }
	docker compose up -d
	@echo
	@echo "  App      http://localhost:8000"
	@echo "  Email    http://localhost:8025   (verification links land here)"
	@echo
	@echo "First run builds two images and downloads the embedding model."
	@echo "Follow it with:  make logs"

down:  ## Stop the stack (data volumes are kept)
	docker compose down

restart:  ## Restart api + worker (picks up .env changes)
	docker compose restart api worker

logs:  ## Tail logs from every service
	docker compose logs -f

ps:  ## Show service status
	docker compose ps

health:  ## Probe the API health endpoint (db + redis + last feed poll)
	@curl -fsS http://localhost:8000/health && echo || \
		echo "API not answering on :8000 — try 'make ps' and 'make logs'."

# --- Tests ----------------------------------------------------------------- #

venv:  ## Create the test virtualenv and install dependencies
	$(PYTHON) -m venv $(VENV)
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r requirements.txt -r requirements-dev.txt

test-services:  ## Start the throwaway Postgres + Redis used by integration tests
	docker compose -f docker-compose.test.yml up -d --wait

test-services-down:  ## Stop and delete the throwaway test services
	docker compose -f docker-compose.test.yml down -v

test: test-services  ## Run the full suite (unit + integration)
	@test -x $(PY) || { echo "No $(VENV) — run 'make venv' first."; exit 1; }
	TEST_DATABASE_URL=$(TEST_DATABASE_URL) \
	TEST_REDIS_URL=$(TEST_REDIS_URL) \
	ARCIV_REQUIRE_SERVICES=1 \
	$(PY) -m pytest

test-unit:  ## Run only the unit layer (no services needed)
	@test -x $(PY) || { echo "No $(VENV) — run 'make venv' first."; exit 1; }
	$(PY) -m pytest -m "not integration"

lint:  ## Run ruff over the Python source
	@test -x $(PY) || { echo "No $(VENV) — run 'make venv' first."; exit 1; }
	$(PY) -m ruff check .

# --- Frontend -------------------------------------------------------------- #

frontend:  ## Run the Vite dev server on :5173 (proxies /api to :8000)
	cd frontend && npm install && npm run dev
