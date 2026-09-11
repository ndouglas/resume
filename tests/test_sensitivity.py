from pathlib import Path
import pytest
from tunable.sensitivity import violations
from tunable.loader import load_content, load_profile
from tunable.select import select, all_text

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.parametrize("text", [
    "saved $4,557/mo",
    "saved $ 55K per year",
    "affecting 200 veterans per week",
    "26,000 patients",
    "1,000 users",
    "a 2.5-year defect",
    "a 75-minute outage",
    "a 4 hour outage",
    "the PHI leak",
    "a PII leak",
    "exploring TLA+ for distributed systems",
    "formal verification of the pipeline",
    "proved in Lean 4",
])
def test_flags_sensitive_text(text):
    assert violations(text), text


@pytest.mark.parametrize("text", [
    "reduced costs by 70%",
    "handling ~1.8M requests/day",
    "a long-standing defect",
    "significant idle capacity",
    "verify PHI/PII compliance",
    "12-person CMS team",
    "14+ years",
    "Drupal 8→9 upgrade",
    "verified across CPU architectures",
    "lean startup",
])
def test_allows_ordinary_text(text):
    assert violations(text) == [], text


def test_violation_names_rule_and_match():
    v = violations("cost $12")
    assert v == ["dollar amount: $12"]


@pytest.mark.parametrize("path", sorted((ROOT / "profiles").glob("*.yaml")), ids=lambda p: p.stem)
def test_every_profile_is_clean(path):
    content = load_content(ROOT / "content")
    profile = load_profile(path, content)
    found = []
    for s in all_text(select(content, profile)):
        found += violations(s)
    assert found == []
