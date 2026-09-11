from pathlib import Path
import pytest
from tunable.loader import ContentError, load_content, load_profile, load_config
from tests.conftest import write_content, write_profile


def test_loads_minimal_content(content_dir):
    content = load_content(content_dir)
    assert content.role_ids() == {"acme-senior", "acme-junior"}
    assert content.item_ids() == {"b-one", "b-two", "b-three", "p-one", "n-oss"}
    assert content.employers[0].roles[0].bullets[0].tags == ("backend",)
    assert content.summaries["commercial"] == "Senior software engineer."
    assert content.clearance.startswith("U.S. Public Trust")


def test_duplicate_bullet_id_fails(tmp_path):
    exp = """
        employers:
          - name: Acme
            start: 2020-10
            end: present
            roles:
              - id: r
                title: T
                start: 2020-10
                end: present
                bullets:
                  - {id: dup, text: a, tags: [backend], weight: 1, evidence: e}
                  - {id: dup, text: b, tags: [backend], weight: 1, evidence: e}
    """
    content_dir = write_content(tmp_path, {"experience.yaml": exp})
    with pytest.raises(ContentError, match="duplicate id 'dup'"):
        load_content(content_dir)


def test_duplicate_role_id_across_employers_fails(tmp_path):
    exp = """
        employers:
          - name: Acme
            start: 2020-10
            end: present
            roles:
              - id: dup
                title: T
                start: 2020-10
                end: present
                bullets:
                  - {id: x, text: a, tags: [backend], weight: 1, evidence: e}
          - name: Widgetco
            start: 2018-01
            end: 2020-09
            roles:
              - id: dup
                title: T
                start: 2018-01
                end: 2020-09
                bullets:
                  - {id: y, text: a, tags: [backend], weight: 1, evidence: e}
    """
    content_dir = write_content(tmp_path, {"experience.yaml": exp})
    with pytest.raises(ContentError, match="duplicate id 'dup'"):
        load_content(content_dir)


def test_unknown_tag_fails(tmp_path):
    exp = """
        employers:
          - name: Acme
            start: 2020-10
            end: present
            roles:
              - id: r
                title: T
                start: 2020-10
                end: present
                bullets:
                  - {id: x, text: a, tags: [nope], weight: 1, evidence: e}
    """
    content_dir = write_content(tmp_path, {"experience.yaml": exp})
    with pytest.raises(ContentError, match="unknown tag 'nope'"):
        load_content(content_dir)


@pytest.mark.parametrize("field,value,msg", [
    ("weight", 0, "weight must be 1-5"),
    ("weight", 6, "weight must be 1-5"),
    ("evidence", "''", "evidence must be non-empty"),
    ("tags", "[]", "tags must be non-empty"),
])
def test_bullet_field_validation(tmp_path, field, value, msg):
    fields = {"id": "x", "text": "a", "tags": "[backend]", "weight": 1, "evidence": "e"}
    fields[field] = value
    line = ", ".join(f"{k}: {v}" for k, v in fields.items())
    exp = f"""
        employers:
          - name: Acme
            start: 2020-10
            end: present
            roles:
              - id: r
                title: T
                start: 2020-10
                end: present
                bullets:
                  - {{{line}}}
    """
    content_dir = write_content(tmp_path, {"experience.yaml": exp})
    with pytest.raises(ContentError, match=msg):
        load_content(content_dir)


def test_roles_must_be_reverse_chronological(tmp_path):
    exp = """
        employers:
          - name: Acme
            start: 2020-10
            end: present
            roles:
              - id: old
                title: T
                start: 2020-10
                end: 2021-01
                bullets:
                  - {id: x, text: a, tags: [backend], weight: 1, evidence: e}
              - id: new
                title: T
                start: 2021-01
                end: present
                bullets:
                  - {id: y, text: a, tags: [backend], weight: 1, evidence: e}
    """
    content_dir = write_content(tmp_path, {"experience.yaml": exp})
    with pytest.raises(ContentError, match="roles of 'Acme' must be in reverse chronological order"):
        load_content(content_dir)


def test_bad_date_fails(tmp_path):
    exp = """
        employers:
          - name: Acme
            start: October 2020
            end: present
            roles: []
    """
    content_dir = write_content(tmp_path, {"experience.yaml": exp})
    with pytest.raises(ContentError, match="date 'October 2020' must be YYYY-MM or 'present'"):
        load_content(content_dir)


def test_employer_with_no_roles_fails(tmp_path):
    exp = """
        employers:
          - name: Acme
            start: 2020-10
            end: present
            roles: []
    """
    content_dir = write_content(tmp_path, {"experience.yaml": exp})
    with pytest.raises(ContentError, match=r"employer 'Acme' must have at least one role"):
        load_content(content_dir)


def test_loads_profile(tmp_root):
    content = load_content(tmp_root / "content")
    path = write_profile(tmp_root, "p", """
        name: p
        summary: commercial
        clearance_line: false
        email: auto
        page_limit: 2
        sections: [experience, skills, projects, education]
        tags: [backend, leadership]
        caps:
          default: 5
          roles: {acme-senior: 7}
          projects: 6
        include: [b-three]
        exclude: []
        require:
          - {tag: leadership, min: 1, roles: [acme-senior]}
    """)
    profile = load_profile(path, content)
    assert profile.name == "p"
    assert profile.tags == ("backend", "leadership")
    assert profile.caps.roles == {"acme-senior": 7}
    assert profile.require[0].roles == ("acme-senior",)


def test_master_profile_defaults(tmp_root):
    content = load_content(tmp_root / "content")
    path = write_profile(tmp_root, "master", """
        name: master
        summary: commercial
        clearance_line: true
        email: auto
        sections: [experience, skills, projects, education, languages]
    """)
    profile = load_profile(path, content)
    assert profile.tags is None
    assert profile.page_limit is None
    assert profile.caps.default is None
    assert profile.include == () and profile.exclude == () and profile.require == ()


@pytest.mark.parametrize("body,msg", [
    ("summary: nope\nsections: [experience]", "unknown summary variant 'nope'"),
    ("summary: commercial\nsections: [bogus]", "unknown section 'bogus'"),
    ("summary: commercial\nsections: [experience]\ntags: [nope]", "unknown tag 'nope'"),
    ("summary: commercial\nsections: [experience]\ninclude: [ghost]", "unknown item id 'ghost'"),
    ("summary: commercial\nsections: [experience]\nexclude: [ghost]", "unknown item id 'ghost'"),
    ("summary: commercial\nsections: [experience]\ncaps: {roles: {ghost: 1}}", "unknown role id 'ghost'"),
    ("summary: commercial\nsections: [experience]\nrequire: [{tag: backend, min: 1, roles: [ghost]}]", "unknown role id 'ghost'"),
    ("summary: commercial\nsections: [experience]\nrequire: [{tag: nope, min: 1, roles: [acme-senior]}]", "unknown tag 'nope'"),
    ("summary: commercial\nsections: [experience]\ncaps: {roles: {acme-senior: seven}}", "cap for role 'acme-senior' must be an integer"),
    ("summary: commercial\nsections: [experience]\ncaps: {default: five}", "caps.default must be an integer"),
    ("summary: commercial\nsections: [experience]\ncaps: {projects: lots}", "caps.projects must be an integer"),
    ("summary: commercial\nsections: [experience]\nrequire: [{tag: backend, min: two, roles: [acme-senior]}]", "min for tag 'backend' must be an integer"),
    ("summary: commercial\nsections: [experience]\npage_limit: two", "page_limit must be an integer"),
    ("summary: commercial\nsections: [experience]\ninclude: [b-one]\nexclude: [b-one]", "both include and exclude"),
])
def test_profile_validation(tmp_root, body, msg):
    content = load_content(tmp_root / "content")
    path = write_profile(tmp_root, "bad", "name: bad\nclearance_line: false\nemail: auto\n" + body)
    with pytest.raises(ContentError, match=msg):
        load_profile(path, content)


def test_load_config(tmp_path):
    cfg = tmp_path / "resume.yaml"
    cfg.write_text("""
name: Nathan Douglas
phone: "(330) 998-8049"
phone_plain: "+13309988049"
website: darkdell.net
linkedin: nug-doug
github: ndouglas
email_domain: tenesm.us
default_profile: commercial-senior-swe
""")
    config = load_config(cfg)
    assert config.github == "ndouglas"
    assert config.default_profile == "commercial-senior-swe"


def test_bullet_alt_is_optional_and_loaded(tmp_path):
    exp = """
        employers:
          - name: Acme
            start: 2020-10
            end: present
            roles:
              - id: r
                title: T
                start: 2020-10
                end: present
                bullets:
                  - {id: a, text: a, tags: [backend], weight: 1, evidence: e, alt: line-one}
                  - {id: b, text: b, tags: [backend], weight: 1, evidence: e}
    """
    content_dir = write_content(tmp_path, {"experience.yaml": exp})
    content = load_content(content_dir)
    bullets = {b.id: b for b in content.employers[0].roles[0].bullets}
    assert bullets["a"].alt == "line-one"
    assert bullets["b"].alt == ""
