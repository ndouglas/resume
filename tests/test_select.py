from tunable.loader import load_content, load_profile
from tunable.select import select, pick, all_text
from tests.conftest import write_profile

BASE = """
name: {name}
summary: commercial
clearance_line: {clearance}
email: auto
sections: [{sections}]
"""


def _profile(root, body, name="p", clearance="false", sections="experience, skills, projects, education, languages"):
    content = load_content(root / "content")
    path = write_profile(root, name, BASE.format(name=name, clearance=clearance, sections=sections) + body)
    return content, load_profile(path, content)


def _ids(items):
    return [i.id for i in items]


def test_master_selects_everything_in_weight_order(tmp_root):
    content, profile = _profile(tmp_root, "", name="master", clearance="true")
    sel = select(content, profile)
    senior = sel.employers[0].roles[0]
    assert _ids(senior.bullets) == ["b-one", "b-two"]      # weight 5 then 3
    assert _ids(sel.employers[0].roles[1].bullets) == ["b-three"]
    assert _ids(sel.projects) == ["p-one"]
    assert _ids(sel.project_notes) == ["n-oss"]
    assert [g.name for g in sel.skills] == ["Languages", "Federal"]
    assert sel.clearance is not None
    assert sel.summary == "Senior software engineer."


def test_tag_filter_drops_unshared_items(tmp_root):
    content, profile = _profile(tmp_root, "tags: [testing]\n")
    sel = select(content, profile)
    assert _ids(sel.employers[0].roles[0].bullets) == ["b-two"]
    assert _ids(sel.projects) == []
    assert [g.name for g in sel.skills] == ["Languages"]          # Federal group emptied and dropped
    assert [i.text for i in sel.skills[0].items] == ["Cypress"]
    assert sel.clearance is None


def test_sort_is_shared_tags_then_weight_then_order(tmp_root):
    # b-two shares 2 of [leadership, testing]; b-one shares 0 but is included explicitly
    content, profile = _profile(tmp_root, "tags: [leadership, testing]\ninclude: [b-one]\n")
    sel = select(content, profile)
    assert _ids(sel.employers[0].roles[0].bullets) == ["b-two", "b-one"]


def test_exclude_beats_include(tmp_root):
    content, profile = _profile(tmp_root, "include: [b-one]\nexclude: [b-one]\n")
    sel = select(content, profile)
    assert "b-one" not in _ids(sel.employers[0].roles[0].bullets)


def test_caps_apply_per_role_with_default(tmp_root):
    content, profile = _profile(tmp_root, "caps: {default: 1, roles: {acme-senior: 2}, projects: 0}\n")
    sel = select(content, profile)
    assert len(sel.employers[0].roles[0].bullets) == 2
    assert len(sel.employers[0].roles[1].bullets) == 1
    assert sel.projects == ()


def test_require_promotes_tagged_item_within_cap(tmp_root):
    # cap 1 would keep b-one (weight 5); require leadership forces b-two in instead
    content, profile = _profile(tmp_root,
        "caps: {default: 1}\nrequire: [{tag: leadership, min: 1, roles: [acme-senior]}]\n")
    sel = select(content, profile)
    assert _ids(sel.employers[0].roles[0].bullets) == ["b-two"]


def test_require_ignores_roles_not_listed(tmp_root):
    content, profile = _profile(tmp_root,
        "caps: {default: 1}\nrequire: [{tag: leadership, min: 1, roles: [acme-junior]}]\n")
    sel = select(content, profile)
    assert _ids(sel.employers[0].roles[0].bullets) == ["b-one"]


def test_sections_control_presence(tmp_root):
    content, profile = _profile(tmp_root, "", sections="experience, projects")
    sel = select(content, profile)
    assert sel.sections == ("experience", "projects")
    assert sel.skills == () and sel.education == () and sel.languages == ()


def test_selection_is_deterministic(tmp_root):
    content, profile = _profile(tmp_root, "tags: [backend, testing]\ncaps: {default: 1}\n")
    assert select(content, profile) == select(content, profile)


def test_all_text_covers_every_rendered_string(tmp_root):
    content, profile = _profile(tmp_root, "", name="master", clearance="true")
    text = all_text(select(content, profile))
    assert "Senior software engineer." in text
    assert "Did the first thing" in text
    assert "A widget" in text
    assert "Open-source contributor" in text
    assert "Cypress" in text
    assert "B.A. Computer Science" in text
    assert "Native" in text
    assert content.clearance in text
