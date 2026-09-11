import re
from pathlib import Path
from tunable.loader import load_content, load_profile, load_config

ROOT = Path(__file__).resolve().parent.parent


def test_real_content_loads():
    content = load_content(ROOT / "content")
    assert {"cie", "cms-tl", "cms-sse", "ain", "devon"} <= content.role_ids()
    assert "commercial" in content.summaries


def test_every_profile_loads():
    content = load_content(ROOT / "content")
    paths = sorted((ROOT / "profiles").glob("*.yaml"))
    assert paths, "no profiles found"
    for p in paths:
        profile = load_profile(p, content)
        assert profile.name == p.stem, f"{p.name}: name must match filename"


def test_config_loads():
    cfg = load_config(ROOT / "resume.yaml")
    assert (ROOT / "profiles" / f"{cfg.default_profile}.yaml").exists()


def test_words_list_is_usable():
    words = [w for w in (ROOT / "content" / "words.txt").read_text().split() if w]
    assert len(words) >= 50
    assert all(w.isalpha() and w.islower() for w in words)


def test_core_tag_keeps_education_in_every_tuned_profile():
    from tunable.select import select
    content = load_content(ROOT / "content")
    for p in sorted((ROOT / "profiles").glob("*.yaml")):
        profile = load_profile(p, content)
        if profile.tags is None:
            continue
        assert "core" in profile.tags, f"{p.name} must list the core tag"
        sel = select(content, profile)
        if "education" in profile.sections:
            assert sel.education, f"{p.name} dropped education"


def test_summary_variants_exist_and_are_assigned():
    content = load_content(ROOT / "content")
    assert set(content.summaries) == {"commercial", "govtech", "short"}
    for text in content.summaries.values():
        assert "TLA" not in text and "formal verification" not in text.lower()
    govtech = load_profile(ROOT / "profiles" / "govtech-platform.yaml", content)
    assert govtech.summary == "govtech"
    commercial = load_profile(ROOT / "profiles" / "commercial-senior-swe.yaml", content)
    assert commercial.summary == "commercial"


def test_projects_reframed():
    content = load_content(ROOT / "content")
    ids = {p.id for p in content.projects}
    assert {"goldentooth", "hornvale", "wiz6", "bitwit", "blackpool", "longtable", "greenstone", "clork", "whispers", "distillation"} <= ids
    gold = next(p for p in content.projects if p.id == "goldentooth")
    assert "TLA" not in gold.text and "TLA+" not in gold.stack
    note = content.project_notes[0]
    assert "OpenTofu" not in note.text and "Couchbase" not in note.text


def test_skills_groups_in_evidence_order():
    content = load_content(ROOT / "content")
    assert [g.name for g in content.skills] == [
        "Languages", "AWS", "Infrastructure as Code", "Delivery",
        "Observability", "Testing", "Platforms", "Domain",
    ]
    all_items = {i.text for g in content.skills for i in g.items}
    assert "TLA+" not in all_items


def _bullets(content, role_id):
    for e in content.employers:
        for r in e.roles:
            if r.id == role_id:
                return {b.id: b for b in r.bullets}
    raise KeyError(role_id)


def test_cie_bullets():
    from tunable.select import select
    content = load_content(ROOT / "content")
    b = _bullets(content, "cie")
    assert len(b) >= 15
    assert any("leadership" in x.tags for x in b.values())
    assert "two-person" not in " ".join(x.text for x in b.values())
    assert b["cie-platform-founded"].alt == b["cie-platform-founded-testing"].alt == "cie-platform"
    for p in sorted((ROOT / "profiles").glob("*.yaml")):
        sel = select(content, load_profile(p, content))
        ids = [x.id for e in sel.employers for r in e.roles for x in r.bullets]
        assert not ({"cie-platform-founded", "cie-platform-founded-testing"} <= set(ids)), p.name


def test_cms_bullets():
    content = load_content(ROOT / "content")
    tl = _bullets(content, "cms-tl")
    sse = _bullets(content, "cms-sse")
    assert len(tl) >= 6 and len(sse) >= 12
    assert any("leadership" in x.tags for x in tl.values())
    assert any("leadership" in x.tags for x in sse.values())
    joined = " ".join(x.text for x in list(tl.values()) + list(sse.values()))
    assert "performed the upgrade" not in joined
    assert "Lagoon" not in joined


def test_earlier_roles_make_the_arc_explicit():
    content = load_content(ROOT / "content")
    ain = _bullets(content, "ain")
    assert "ain-arc" in ain and ain["ain-arc"].weight == 5
    assert all(b.evidence.startswith("from memory; discuss in interview") for b in ain.values())
    devon = _bullets(content, "devon")
    assert len(devon) == 3


def test_no_broken_hyphenation():
    content = load_content(ROOT / "content")
    texts = [b.text for e in content.employers for r in e.roles for b in r.bullets]
    texts += [p.text for p in content.projects] + [n.text for n in content.project_notes]
    texts += list(content.summaries.values())
    for t in texts:
        assert not re.search(r"\w- \w", t), t


def test_experience_bullets_within_word_budget():
    content = load_content(ROOT / "content")
    for e in content.employers:
        for r in e.roles:
            for b in r.bullets:
                assert len(b.text.split()) <= 34, b.id


def test_experience_bullets_end_with_period():
    content = load_content(ROOT / "content")
    for e in content.employers:
        for r in e.roles:
            for b in r.bullets:
                assert b.text.endswith("."), b.id
