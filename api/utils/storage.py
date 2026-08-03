"""Per-user storage accounting.

We keep a running byte total on ``users.storage_bytes`` rather than SUM-ing over
links on every request, so the create-time cap check is O(1). The total is a
deliberate approximation — Python string lengths + JSON text, not on-disk TOAST
size — which is fine for an abuse guard (it is not billing).

Every site that changes a link's persisted content applies a delta via
``adjust_user_storage`` so the total stays honest:
  - link create / delete            (api/routers/links.py)
  - notes / tag edits               (api/routers/links.py update_link)
  - insights generation             (api/routers/links.py generate_insights)
  - AI classify (summary/tags/raw)  (worker/ai_classify.py)
  - embedding                       (worker/embed.py)

The big fields (ai_raw_response JSONB, the 1.5KB embedding) are written
asynchronously by the worker after create, which is why the worker must also
adjust the total — a create-only delta would badly undercount.
"""
import json

from sqlalchemy import func, update

from api.models.user import User

# Fixed on-disk footprint of one pgvector(384) value: 384 float32s.
EMBEDDING_BYTES = 384 * 4  # 1536

_TEXT_FIELDS = (
    "url",
    "canonical_url",
    "title",
    "description",
    "favicon_url",
    "ai_summary",
    "ai_error",
    "notes",
)
_ARRAY_FIELDS = ("ai_tags", "ai_insights")


def link_bytes(link) -> int:
    """Approximate persisted bytes for one Link row.

    Deterministic so that before/after deltas at a mutation site cancel exactly.
    """
    total = 0
    for name in _TEXT_FIELDS:
        val = getattr(link, name, None)
        if val:
            total += len(val.encode("utf-8"))
    for name in _ARRAY_FIELDS:
        arr = getattr(link, name, None)
        if arr:
            total += sum(len(s.encode("utf-8")) for s in arr)
    raw = getattr(link, "ai_raw_response", None)
    if raw:
        total += len(json.dumps(raw, default=str).encode("utf-8"))
    if getattr(link, "embedding", None) is not None:
        total += EMBEDDING_BYTES
    return total


async def adjust_user_storage(db, user_id, delta: int) -> None:
    """Apply ``delta`` bytes to a user's running total, floored at 0.

    Does not commit — the caller's existing commit persists it in the same
    transaction as the link change it accounts for. No-op for a zero delta.
    """
    if not delta:
        return
    await db.execute(
        update(User)
        .where(User.id == user_id)
        .values(storage_bytes=func.greatest(0, User.storage_bytes + delta))
    )
