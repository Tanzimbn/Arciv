"""Local text embeddings for semantic search.

Uses fastembed (ONNX) so embeddings run in-container with no API key — the same
model embeds both saved links (worker) and search queries (API), so the vectors
compare. The model is loaded lazily on first use (keeps API/worker startup fast)
and cached process-wide. Gated by settings.EMBEDDINGS_ENABLED.

The embedding dimension is fixed at the DB layer (Vector(384) in migration 0012);
keep settings.EMBEDDING_MODEL on a 384-dim model unless you also migrate.
"""

import asyncio
import logging
import threading

import httpx

from api.config import settings

logger = logging.getLogger(__name__)

_model = None
_lock = threading.Lock()

# Lazy shared async client for remote (EMBED_SERVICE_URL) mode. Generous timeout:
# a cold embed service pays the model load on its first request.
_http: httpx.AsyncClient | None = None


def _get_http() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(timeout=30.0)
    return _http


async def _embed_remote(text: str) -> list[float] | None:
    """POST the text to the dedicated embedding service and return its vector.
    Best-effort: on any failure return None (search → 503 → UI substring
    fallback; worker → skipped, hourly backfill cron retries)."""
    try:
        resp = await _get_http().post(
            f"{settings.EMBED_SERVICE_URL.rstrip('/')}/embed", json={"text": text}
        )
        resp.raise_for_status()
        return resp.json().get("embedding")
    except Exception:
        logger.warning("Remote embed service call failed", exc_info=True)
        return None

# Per-process ceiling on concurrent embeds. Created lazily inside the running
# loop (import time has none) and cached; api and worker each build their own,
# which is exactly the global cap on a single-box deploy. Only used in local
# mode — remote mode (EMBED_SERVICE_URL) offloads to the embed service, whose
# own semaphore bounds concurrency there instead.
_semaphore: asyncio.Semaphore | None = None


def _get_model():
    """
    Helper function that returns the shared FastEmbed embedding model instance. It lazily initializes the model on the first call and reuses the same model for all future embedding requests.
    """
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from fastembed import TextEmbedding

                _model = TextEmbedding(model_name=settings.EMBEDDING_MODEL)
    return _model


def warm_model() -> None:
    """Eagerly load the model so the first embed doesn't pay download+load
    latency mid-request. Safe to call when embeddings are disabled (no-op).
    Also a no-op in remote mode (EMBED_SERVICE_URL set) — the model lives in the
    embed service, not this process, which is the whole point of the split."""
    if settings.EMBEDDINGS_ENABLED and not settings.EMBED_SERVICE_URL:
        _get_model()


def _get_semaphore() -> asyncio.Semaphore:
    """
    Single-threaded event loop: check-then-set needs no lock (no await between).
    """
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(max(1, settings.EMBEDDING_MAX_CONCURRENCY))
    return _semaphore


def _embed_sync(text: str) -> list[float]:
    model = _get_model()
    # fastembed's embed() yields numpy arrays; one text in → one vector out.
    vec = next(iter(model.embed([text])))
    return vec.tolist()


async def embed_text(text: str | None) -> list[float] | None:
    """Return a 384-dim embedding for ``text``, or None if embeddings are
    disabled or the text is empty. Runs the sync CPU model off the event loop,
    bounded by a per-process concurrency semaphore so a burst can't saturate
    every core and starve request handling."""
    if not settings.EMBEDDINGS_ENABLED:
        return None
    text = (text or "").strip()
    if not text:
        return None
    # Remote mode: offload to the dedicated embed service (model not loaded here).
    if settings.EMBED_SERVICE_URL:
        return await _embed_remote(text)
    async with _get_semaphore():
        return await asyncio.to_thread(_embed_sync, text)
