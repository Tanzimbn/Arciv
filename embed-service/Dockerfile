# Minimal embedding microservice — model + runtime only, NO sqlalchemy/asyncpg/
# pydantic-settings. Keeps resident RAM to the ONNX model (~400MB) + runtime so
# it fits a low-RAM host, and lets the api + worker run model-free.
FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    "fastembed>=0.3.0" fastapi==0.111.0 "uvicorn[standard]==0.30.1"

# Bake the model into the image so cold starts (Render free wipes ephemeral disk
# on spin-down) only LOAD it — never re-download. Keep in sync with the
# EMBEDDING_MODEL default in app.py.
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('BAAI/bge-small-en-v1.5')"

COPY embed-service/ ./

# Honour Render/PaaS-injected $PORT; fall back to 8001 for local/compose.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8001}"]
