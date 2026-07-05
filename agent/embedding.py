"""Local text embeddings for semantic search.

Uses fastembed (ONNX) so embeddings run in-container with no API key — the same
model embeds both saved links (worker) and search queries (API), so the vectors
compare. The model is loaded lazily on first use (keeps API/worker startup fast)
and cached process-wide. Gated by settings.EMBEDDINGS_ENABLED.

The embedding dimension is fixed at the DB layer (Vector(384) in migration 0012);
keep settings.EMBEDDING_MODEL on a 384-dim model unless you also migrate.
"""
import asyncio
import threading

from api.config import settings

_model = None
_lock = threading.Lock()


def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from fastembed import TextEmbedding

                _model = TextEmbedding(model_name=settings.EMBEDDING_MODEL)
    return _model


def _embed_sync(text: str) -> list[float]:
    model = _get_model()
    # fastembed's embed() yields numpy arrays; one text in → one vector out.
    vec = next(iter(model.embed([text])))
    return vec.tolist()


async def embed_text(text: str | None) -> list[float] | None:
    """Return a 384-dim embedding for ``text``, or None if embeddings are
    disabled or the text is empty. Runs the sync CPU model off the event loop."""
    if not settings.EMBEDDINGS_ENABLED:
        return None
    text = (text or "").strip()
    if not text:
        return None
    return await asyncio.to_thread(_embed_sync, text)
