"""Unit tests for screenplay full-text search helpers."""

from services.search_helpers import build_tsquery, make_snippet, normalize_search_terms


def test_normalize_search_terms_dedupes_and_trims():
    terms = normalize_search_terms(["  Peggy  ", "peggy", "Arnold", "a"])
    assert terms == ["Peggy", "Arnold"]


def test_build_tsquery_any_mode():
    q = build_tsquery(["Peggy", "Philadelphia salon"], match_mode="any")
    assert q == "Peggy | Philadelphia & salon"


def test_build_tsquery_all_mode():
    q = build_tsquery(["Make them see"], match_mode="all")
    assert q == "Make & them & see"


def test_format_search_hits_grouped():
    from services.search_helpers import format_search_hits_grouped

    class Hit:
        def __init__(self, eid, etype, idx, snippet):
            self.element_id = eid
            self.element_type = etype
            self.element_index = idx
            self.snippet = snippet

    hits = [
        Hit("a1", "dialogue", 10, "Hello Peggy"),
        Hit("a2", "action", 11, "She turns"),
    ]
    scene_meta = {
        "a1": {"scene_id": "s1", "scene_heading": "INT. SALON - NIGHT"},
        "a2": {"scene_id": "s1", "scene_heading": "INT. SALON - NIGHT"},
    }
    out = format_search_hits_grouped(
        hits, scene_meta, terms=["Peggy"], mode="any", type_filter=["dialogue"]
    )
    assert "INT. SALON - NIGHT" in out
    assert "Found 2 match" in out
    assert "a1" in out


def test_make_snippet_centers_on_match():
    content = "A" * 50 + "PEGGY speaks softly" + "B" * 50
    snippet = make_snippet(content, ["PEGGY"], max_len=40)
    assert "PEGGY" in snippet
    assert snippet.startswith("…") or snippet.endswith("…") or "…" in snippet
