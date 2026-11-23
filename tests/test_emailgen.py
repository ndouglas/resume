import re
from pathlib import Path
from tunable.emailgen import address, load_words

WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"]


def test_shape():
    assert re.fullmatch(r"[a-z]+\.[a-z]+\d{4}@tenesm\.us", address("p", "tenesm.us", WORDS))


def test_deterministic_per_profile():
    assert address("commercial", "tenesm.us", WORDS) == address("commercial", "tenesm.us", WORDS)
    assert address("commercial", "tenesm.us", WORDS) != address("govtech", "tenesm.us", WORDS)


def test_two_distinct_words():
    local = address("p", "x.org", WORDS).split("@")[0]
    first, second = local.rstrip("0123456789").split(".")
    assert first != second


def test_load_words(tmp_path: Path):
    p = tmp_path / "w.txt"
    p.write_text("one two\nthree\n\n")
    assert load_words(p) == ["one", "two", "three"]
