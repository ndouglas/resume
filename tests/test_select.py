from tunable.loader import load_content, load_profile
from tunable.select import select, pick, all_text
from tests.conftest import write_content, write_profile

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
    # b-two matches the tag filter and would be selected on its own; excluding
    # it must still win even though b-one is separately forced in via include.
    content, profile = _profile(tmp_root, "tags: [leadership, testing]\ninclude: [b-one]\nexclude: [b-two]\n")
    sel = select(content, profile)
    ids = _ids(sel.employers[0].roles[0].bullets)
    assert "b-two" not in ids
    assert "b-one" in ids


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


def test_two_requires_on_same_role_do_not_evict_each_other(tmp_path):
    # cap 2, require leadership min 1 and require testing min 1, three bullets:
    # hi(backend,w5) lead(leadership,w1) test(testing,w1). Before the fix, the
    # second require's victim search could evict the item the first require
    # had just promoted, dropping that minimum silently.
    exp = """
        employers:
          - name: Acme
            start: 2020-10
            end: present
            roles:
              - id: acme-senior
                title: Senior Engineer
                start: 2022-01
                end: present
                bullets:
                  - {id: hi, text: Did a thing, tags: [backend], weight: 5, evidence: e}
                  - {id: lead, text: Led a thing, tags: [leadership], weight: 1, evidence: e}
                  - {id: test, text: Tested a thing, tags: [testing], weight: 1, evidence: e}
    """
    content_dir = write_content(tmp_path, {"experience.yaml": exp})
    content = load_content(content_dir)
    path = write_profile(tmp_path, "p", """
        name: p
        summary: commercial
        clearance_line: false
        email: auto
        sections: [experience]
        caps: {default: 2}
        require:
          - {tag: leadership, min: 1, roles: [acme-senior]}
          - {tag: testing, min: 1, roles: [acme-senior]}
    """)
    profile = load_profile(path, content)
    sel = select(content, profile)
    ids = _ids(sel.employers[0].roles[0].bullets)
    assert "lead" in ids
    assert "test" in ids


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


ALT_EXP = """
    employers:
      - name: Acme
        start: 2020-10
        end: present
        roles:
          - id: acme-senior
            title: Senior Engineer
            start: 2020-10
            end: present
            bullets:
              - id: plat-security
                text: Built the platform with no long-lived credentials
                tags: [backend, leadership]
                weight: 5
                evidence: e
                alt: platform
              - id: plat-testing
                text: Built the platform with modules tested against live AWS
                tags: [testing]
                weight: 5
                evidence: e
                alt: platform
              - id: other
                text: Did something else
                tags: [backend]
                weight: 2
                evidence: e
"""


def test_alt_forms_keep_only_the_best_ranked(tmp_path):
    from tests.conftest import write_content
    write_content(tmp_path, {"experience.yaml": ALT_EXP})
    content, profile = _profile(tmp_path, "tags: [testing]\n")
    ids = _ids(select(content, profile).employers[0].roles[0].bullets)
    assert ids == ["plat-testing"]


def test_alt_forms_master_keeps_first_by_weight_then_order(tmp_path):
    from tests.conftest import write_content
    write_content(tmp_path, {"experience.yaml": ALT_EXP})
    content, profile = _profile(tmp_path, "", name="master")
    ids = _ids(select(content, profile).employers[0].roles[0].bullets)
    assert ids == ["plat-security", "other"]


def test_alt_forms_exclude_lets_the_other_form_through(tmp_path):
    from tests.conftest import write_content
    write_content(tmp_path, {"experience.yaml": ALT_EXP})
    content, profile = _profile(tmp_path, "exclude: [plat-security]\n", name="master")
    ids = _ids(select(content, profile).employers[0].roles[0].bullets)
    assert ids == ["plat-testing", "other"]
