"""Dedicated embedding microservice.

Loads the fastembed ONNX model ONCE and serves vectors over HTTP so the api and
worker processes don't each carry their own ~400MB copy. This is deliberately
self-contained — it does NOT import api.config or agent.* (those pull
SQLAlchemy/asyncpg and require DATABASE_URL/SECRET_KEY/ENCRYPTION_KEY, none of
which a minimal embed box should need). It mirrors the model-load + concurrency
pattern of agent/embedding.py; keep the two in sync if that logic changes.

Contract (agent/embedding.py::_embed_remote is the client):
    POST /embed  {"text": str}  -> {"embedding": [float] | null}
    GET  /health                -> {"status": "ok"}
"""
import asyncio
import os
import threading

from fastapi import FastAPI
from pydantic import BaseModel

# Keep the default model in sync with EMBEDDING_MODEL in api/config.py — the
# vector dimension (384) is baked into DB migration 0012.
MODEL_NAME = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
MAX_CONCURRENCY = max(1, int(os.getenv("EMBEDDING_MAX_CONCURRENCY", "2")))

app = FastAPI(title="Arciv embedding service")

_model = None
_lock = threading.Lock()
_semaphore: asyncio.Semaphore | None = None


def _get_model():
    """Lazily load and cache the ONNX model process-wide."""
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from fastembed import TextEmbedding

                _model = TextEmbedding(model_name=MODEL_NAME)
    return _model


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
    return _semaphore


def _embed_sync(text: str) -> list[float]:
    model = _get_model()
    vec = next(iter(model.embed([text])))
    return vec.tolist()


class EmbedRequest(BaseModel):
    text: str


@app.on_event("startup")
async def _warm() -> None:
    # Load the model at boot so the first request doesn't pay load latency.
    await asyncio.to_thread(_get_model)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/embed")
async def embed(req: EmbedRequest) -> dict:
    text = (req.text or "").strip()
    if not text:
        return {"embedding": None}
    async with _get_semaphore():
        vec = await asyncio.to_thread(_embed_sync, text)
    return {"embedding": vec}
