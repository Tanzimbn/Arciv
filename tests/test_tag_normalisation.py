"""``normalise_tag`` — the grouping key behind topics and ``?tag=``.

This function decides whether ``Postgres`` and ``postgres_db`` land in one
collection or four, and its SQL twin (``tag_key_sql``) resolves the filter that
a topic chip navigates to. Both halves must agree; this file pins the Python
half, ``tests/integration/test_topics.py`` asserts the pair agrees inside a real
Postgres.
"""

from api.utils.tags import normalise_tag


def test_casing_is_folded():
    assert normalise_tag("PostgreSQL") == "postgresql"
    assert normalise_tag("Rust") == normalise_tag("RUST") == "rust"


def test_spaces_and_underscores_both_become_hyphens():
    for raw in ("react native", "React Native", "react_native", "REACT_NATIVE"):
        assert normalise_tag(raw) == "react-native"


def test_surrounding_whitespace_is_stripped():
    assert normalise_tag("  vector search  ") == "vector-search"
    assert normalise_tag("\tvector\tsearch\n") == "vector-search"


def test_runs_of_separators_collapse_to_one_hyphen():
    assert normalise_tag("machine   learning") == "machine-learning"
    assert normalise_tag("machine _ learning") == "machine-learning"
    assert normalise_tag("machine--learning") == "machine-learning"
    assert normalise_tag("a \t\n\r\f\v_ b") == "a-b"


def test_leading_and_trailing_hyphens_are_dropped():
    assert normalise_tag("-rust-") == "rust"
    assert normalise_tag("__rust__") == "rust"
    assert normalise_tag("-- rust --") == "rust"


def test_separator_only_tags_normalise_to_empty():
    # Callers drop these: the topic list HAVINGs them out, the filter treats an
    # empty key as "matches nothing" rather than "no filter".
    for raw in ("", "   ", "_", "-", "---", " __ ", "\t\n"):
        assert normalise_tag(raw) == ""


def test_internal_punctuation_is_left_alone():
    # Only whitespace and underscores are separators. Dots, slashes and plus
    # signs are part of real tag names ("c++", "node.js", "ci/cd").
    assert normalise_tag("Node.js") == "node.js"
    assert normalise_tag("C++") == "c++"
    assert normalise_tag("CI/CD") == "ci/cd"


def test_non_ascii_tags_survive_and_fold():
    assert normalise_tag("Café Culture") == "café-culture"
    assert normalise_tag("ПРИВЕТ") == "привет"
    assert normalise_tag("日本語 タグ") == "日本語-タグ"


def test_normalisation_is_idempotent():
    # The topic key is handed back to the client and returned as ``?tag=``, so
    # normalising an already-normalised key must be a no-op or the round trip
    # would resolve to a different set than the count promised.
    for raw in ("PostgreSQL", "  React_Native ", "-- ci/cd --", "a \t b"):
        once = normalise_tag(raw)
        assert normalise_tag(once) == once
