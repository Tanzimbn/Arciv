"""Storage-byte accounting (NFR-PUB-03).

``users.storage_bytes`` is a running total maintained by hand-written deltas at
every mutation site. Two things break it silently:
  1. ``link_bytes`` being non-deterministic, so a before/after delta at one site
     doesn't cancel and the total drifts until the cap fires on an innocent user;
  2. a field being renamed on the model while the tuples here keep the old name —
     ``getattr(link, name, None)`` returns None and the bytes stop being counted.
Both are covered without touching a database.
"""
import json
import types

import pytest

from api.models.link import Link
from api.utils.storage import (
    _ARRAY_FIELDS,
    _TEXT_FIELDS,
    EMBEDDING_BYTES,
    link_bytes,
)


def make_link(**kwargs):
    """A duck-typed stand-in: link_bytes only ever does getattr."""
    base = {name: None for name in (*_TEXT_FIELDS, *_ARRAY_FIELDS)}
    base["ai_raw_response"] = None
    base["embedding"] = None
    base.update(kwargs)
    return types.SimpleNamespace(**base)


@pytest.mark.parametrize("name", [*_TEXT_FIELDS, *_ARRAY_FIELDS, "ai_raw_response", "embedding"])
def test_every_accounted_field_exists_on_the_model(name):
    """A rename on Link must break this test, not silently stop counting bytes."""
    assert hasattr(Link, name), f"storage.py accounts for Link.{name}, which no longer exists"


def test_empty_link_costs_nothing():
    assert link_bytes(make_link()) == 0


def test_text_fields_counted_as_utf8_bytes():
    link = make_link(title="hello")
    assert link_bytes(link) == 5
    # Multi-byte characters must count as bytes, not characters, or the cap
    # under-counts non-Latin content by up to 3x.
    assert link_bytes(make_link(title="日本語")) == 9


def test_array_fields_sum_their_members():
    link = make_link(ai_tags=["ab", "cde"], ai_insights=["x"])
    assert link_bytes(link) == 2 + 3 + 1


def test_embedding_is_a_fixed_cost():
    assert EMBEDDING_BYTES == 384 * 4
    assert link_bytes(make_link(embedding=[0.0] * 384)) == EMBEDDING_BYTES
    # A zero-vector is falsy-ish per element but not None — must still be counted.
    assert link_bytes(make_link(embedding=[])) == EMBEDDING_BYTES


def test_raw_ai_response_counted_as_serialised_json():
    payload = {"summary": "s", "tags": ["t"]}
    link = make_link(ai_raw_response=payload)
    assert link_bytes(link) == len(json.dumps(payload).encode())
    # Deterministic: same dict, same byte count, every call.
    assert link_bytes(link) == link_bytes(make_link(ai_raw_response=dict(payload)))


def test_link_bytes_is_deterministic_so_deltas_cancel():
    """The delta pattern at each mutation site is `after - before`. If link_bytes
    weren't stable for unchanged content, every edit would leak or refund bytes."""
    fields = dict(
        url="https://example.com/a?b=1",
        canonical_url="https://example.com/a",
        title="Title",
        description="Desc",
        favicon_url="https://example.com/favicon.ico",
        ai_summary="Summary text",
        notes="my notes",
        ai_tags=["one", "two"],
        ai_insights=["insight"],
        ai_raw_response={"nested": {"a": [1, 2, 3]}},
        embedding=[0.1] * 384,
    )
    first = link_bytes(make_link(**fields))
    for _ in range(5):
        assert link_bytes(make_link(**fields)) == first


def test_editing_one_field_moves_the_total_by_exactly_that_field():
    before = make_link(title="Title", notes="ab")
    after = make_link(title="Title", notes="abcd")
    assert link_bytes(after) - link_bytes(before) == 2


def test_unserialisable_raw_response_does_not_explode():
    """ai_raw_response comes from a provider; json.dumps uses default=str so a
    stray datetime can't turn accounting into a 500 on the create path."""
    from datetime import datetime, timezone

    link = make_link(ai_raw_response={"at": datetime(2026, 1, 1, tzinfo=timezone.utc)})
    assert link_bytes(link) > 0
