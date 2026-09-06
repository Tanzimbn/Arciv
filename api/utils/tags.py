"""Tag normalisation, shared by the topic list and the ``?tag=`` filter.

Tags arrive raw from the LLM (``agent/prompt.parse_ai_response`` takes
``data["tags"]`` verbatim) and are also hand-editable in the link drawer, so the
same topic reaches the database as ``Postgres``, ``postgres``, ``PostgreSQL``
and ``postgres_db``. Grouping on the raw value would split one topic into four
collections, which is the whole feature failing.

Normalisation happens on **read**, never on write: stored tags keep the casing
the user (or the model) chose, because rewriting them would silently overwrite a
deliberate hand edit and would need an irreversible backfill.

``normalise_tag`` and ``tag_key_sql`` must stay exact twins — one groups, the
other resolves the filter, and a divergence means clicking a topic returns a
different set than the count promised. ``tests/test_tag_normalisation.py``
pins the Python side; ``tests/integration/test_topics.py`` asserts the two agree
inside Postgres. Character classes are written out longhand rather than as
``\\s`` because Python's ``\\s`` is unicode-aware while Postgres' is
locale-dependent, and that difference is exactly the kind of drift that would
break the pairing.
"""

import re

from sqlalchemy import func

#: Whitespace and underscores both read as word separators in a tag.
_SEPARATORS = re.compile(r"[ \t\n\r\f\v_]+")
_REPEATED_DASHES = re.compile(r"-{2,}")

#: Postgres twin of the pattern above.
_SEPARATORS_SQL = r"[ \t\n\r\f\v_]+"
_REPEATED_DASHES_SQL = "-{2,}"


def normalise_tag(tag: str) -> str:
    """Collapse a tag to its grouping key: lowercase, hyphen-separated.

    ``"  React Native "`` and ``"react_native"`` both become ``"react-native"``.
    Returns ``""`` for a tag that is only separators — callers drop those.
    """
    key = _SEPARATORS.sub("-", tag.strip().lower())
    key = _REPEATED_DASHES.sub("-", key)
    return key.strip("-")


def tag_key_sql(column):
    """``normalise_tag`` as a SQL expression over ``column``.

    Used both to ``GROUP BY`` in the topic list and to resolve ``?tag=`` in the
    link list, so the two cannot drift apart.
    """
    lowered = func.lower(func.btrim(column))
    hyphenated = func.regexp_replace(lowered, _SEPARATORS_SQL, "-", "g")
    collapsed = func.regexp_replace(hyphenated, _REPEATED_DASHES_SQL, "-", "g")
    return func.btrim(collapsed, "-")
