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
