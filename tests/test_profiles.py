from pathlib import Path

import pytest

from tunable.loader import load_content, load_profile
from tunable.select import select

ROOT = Path(__file__).resolve().parent.parent


def _sel(name):
    content = load_content(ROOT / "content")
    return select(content, load_profile(ROOT / "profiles" / f"{name}.yaml", content))


def test_commercial_profile_hides_clearance_and_research():
    sel = _sel("commercial-senior-swe")
    assert sel.clearance is None
    assert "distillation" not in [p.id for p in sel.projects]
    assert sel.project_notes == ()
    assert "languages" not in sel.sections


def test_govtech_profile_shows_clearance():
    sel = _sel("govtech-platform")
    assert sel.clearance is not None


@pytest.mark.parametrize("name", ["commercial-senior-swe", "govtech-platform"])
@pytest.mark.parametrize("role_id", [
    "cie",
    "cms-tl", "cms-sse",
])
def test_tuned_profiles_have_leadership_in_each_agile_six_role(name, role_id):
    sel = _sel(name)
    roles = {sr.role.id: sr for sr in sel.employers[0].roles}
    assert any("leadership" in b.tags for b in roles[role_id].bullets)
