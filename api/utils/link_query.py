"""How a link query gets narrowed — the rules the link list and the topic list
must apply identically.

Both live here rather than in ``api/routers/links.py`` because
``GET /api/topics`` has to see exactly the set ``GET /api/links`` will show after
a topic chip is clicked. A count computed under one scope and a list rendered
under another is the failure this module exists to prevent: a chip reading 7 that
opens a list of 4.
"""

import re
from datetime import datetime, timezone

from sqlalchemy import and_, func, or_, select

from api.models.link import Link
from api.utils.tags import normalise_tag, tag_key_sql

#: A hostname, for the ``domain`` filter. Validated rather than escaped: the
#: value goes into a POSIX regex, and an allowlisted charset removes the whole
#: question of regex injection instead of trusting an escaping round-trip.
_HOSTNAME_RE = re.compile(r"^[a-z0-9.-]{1,253}$")


def _as_utc(value: datetime | None) -> datetime | None:
    """Attach UTC to a naive datetime so it compares against a timestamptz column."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def apply_queue_scope(q, queue: str | None):
    """Restrict a link query to one queue tab.

    ``"archive"`` is not a queue but a status — the tab shows done links from
    every queue. Anything else names a real queue and implies active only; no
    queue at all means every active link.
    """
    if queue == "archive":
        return q.where(Link.status == "done")
    if queue:
        return q.where(Link.queue == queue, Link.status == "active")
    return q.where(Link.status == "active")


def _tag_exists_clause(key: str):
    """``EXISTS (SELECT 1 FROM unnest(ai_tags) t WHERE normalise(t) = key)``.

    Matched on the normalised key, not the raw value, so the "postgres" the topic
    list counted is the "PostgreSQL" this returns. That is also why a plain GIN
    index on ``ai_tags`` cannot serve the predicate — see the note in list_links
    about why there isn't one.

    render_derived() is what emits the ``AS alias(column)`` list. Without it
    Postgres names the output column after the table alias and referencing
    ``.c.filter_tag`` fails with "column anon_1.filter_tag does not exist".
    """
    unnested = func.unnest(Link.ai_tags).table_valued("filter_tag").render_derived()
    return (
        select(1)
        .select_from(unnested)
        .where(tag_key_sql(unnested.c.filter_tag) == key)
        .exists()
    )


def apply_link_filters(
    q,
    *,
    tag: str | list[str] | None = None,
    tag_logic: str = "any",
    content_type: str | None = None,
    domain: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
):
    """AND the discovery filters onto a link query.

    Shared by ``GET /api/links`` and ``GET /api/links/search`` so a filter cannot
    mean one thing when browsing and another when searching. Every filter is
    additive; the caller has already applied the ``user_id`` scope.

    ``tag`` takes one key or many (repeated ``?tag=`` params). ``tag_logic``
    decides how several combine: ``"any"`` is a union — the reader browsing two
    interests at once — and ``"all"`` is an intersection, for pinpointing the
    link that sits under both. Neither is a superset of the other, which is why
    the UI exposes the choice instead of picking one.

    Returns ``(query, impossible)``. ``impossible`` is True when an argument can
    match nothing (a tag that normalises to empty, a malformed domain) — the
    caller returns an empty list rather than silently dropping the filter and
    handing back the unfiltered library, which would look like a match. One
    unusable key fails the whole request under either logic, ``"any"``
    included: quietly dropping it would answer a different question than the one
    asked, and under ``"any"`` the extra rows would look like real matches.
    """
    if tag is not None:
        raw = [tag] if isinstance(tag, str) else list(tag)
        keys = []
        for value in raw:
            key = normalise_tag(value)
            if not key:
                return q, True
            if key not in keys:  # ?tag=Rust&tag=rust is one key, not an AND of two
                keys.append(key)
        if keys:
            clauses = [_tag_exists_clause(k) for k in keys]
            combine = and_ if tag_logic == "all" else or_
            q = q.where(clauses[0] if len(clauses) == 1 else combine(*clauses))

    if content_type is not None:
        # Deliberately not checked against an allowlist. The writer's list
        # (agent/prompt.CONTENT_TYPES) and the editor's
        # (api.schemas.link.VALID_CONTENT_TYPES) already disagree — "documentation"
        # can be stored by the AI but not set by a PATCH — so validating here
        # would make a real stored value unfilterable.
        q = q.where(Link.content_type == content_type)

    if domain is not None:
        host = domain.strip().lower().removeprefix("www.")
        if not _HOSTNAME_RE.match(host):
            return q, True
        # canonical_url keeps its scheme and netloc (api.utils.metadata), so the
        # host is matched positionally. Dots are escaped or "github.com" would
        # also match "githubacom"; the trailing class stops it from matching
        # "github.com.evil.test".
        pattern = host.replace(".", r"\.")
        q = q.where(Link.canonical_url.op("~*")(f"^https?://(www\\.)?{pattern}(/|:|$)"))

    if since is not None:
        q = q.where(Link.saved_at >= _as_utc(since))
    if until is not None:
        q = q.where(Link.saved_at <= _as_utc(until))

    return q, False
