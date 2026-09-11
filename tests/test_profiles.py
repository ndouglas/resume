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


def _selected_ids(name):
    sel = _sel(name)
    return {b.id for e in sel.employers for r in e.roles for b in r.bullets}


@pytest.mark.parametrize("name", ["commercial-senior-swe", "govtech-platform"])
def test_tuned_profiles_carry_the_throughline(name):
    ids = _selected_ids(name)
    # identity: safe to change
    assert "cie-platform-founded" in ids or "cie-platform-founded-testing" in ids
    assert "cms-tl-content-release" in ids
    assert "cms-sse-quality-program" in ids
    # proof: finds what is silently wrong
    assert "cie-silent-defect" in ids
    assert "cms-sse-release-safety" in ids or "cms-sse-flaky" in ids
    # outcome: owner of record
    assert "cie-ownership" in ids
    assert "ain-arc" in ids
    assert "devon-sync-ownership" in ids


def test_commercial_hides_federal_only_bullets():
    ids = _selected_ids("commercial-senior-swe")
    assert "cms-tl-ato" not in ids


def test_govtech_shows_ato():
    ids = _selected_ids("govtech-platform")
    assert "cms-tl-ato" in ids


@pytest.mark.parametrize("path", sorted((ROOT / "profiles").glob("*.yaml")), ids=lambda p: p.stem)
def test_include_ids_are_selected(path):
    content = load_content(ROOT / "content")
    profile = load_profile(path, content)
    sel = select(content, profile)
    selected = {b.id for e in sel.employers for r in e.roles for b in r.bullets}
    selected |= {p.id for p in sel.projects} | {n.id for n in sel.project_notes}
    for i in profile.include:
        assert i in selected, f"{path.name}: include id '{i}' was not selected"
