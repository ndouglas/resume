from pathlib import Path
from tunable.render import tex, fmt_date, render
from tunable.loader import load_content, load_profile, load_config
from tunable.select import select
from tests.conftest import write_profile

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / "templates"


def test_escaper_handles_special_characters():
    assert tex("60% & $5 #1 a_b {c} ~ ^ \\") == r"60\% \& \$5 \#1 a\_b \{c\} \textasciitilde{} \textasciicircum{} \textbackslash{}"


def test_escaper_leaves_unicode_alone():
    assert tex("Drupal 8→9") == "Drupal 8→9"


def test_fmt_date():
    assert fmt_date("2020-10") == "Oct. 2020"
    assert fmt_date("2024-05") == "May 2024"
    assert fmt_date("present") == "Present"


def _render(tmp_root, body):
    content = load_content(tmp_root / "content")
    profile = load_profile(write_profile(tmp_root, "p", body), content)
    cfg = load_config(ROOT / "resume.yaml")
    return render(select(content, profile), cfg, "x.y1234@tenesm.us", TEMPLATES)


def test_renders_all_sections(tmp_root):
    out = _render(tmp_root, """
        name: p
        summary: commercial
        clearance_line: true
        email: auto
        sections: [experience, skills, projects, education, languages]
    """)
    assert r"\begin{document}" in out and r"\end{document}" in out
    assert "x.y1234@tenesm.us" in out
    assert "Senior software engineer." in out
    assert "U.S. Public Trust" in out
    assert r"\resumeSubheading" in out and "Acme" in out
    assert "Oct. 2020 – Present" in out
    assert r"\resumeSubSubheading" in out and "Engineer" in out
    assert "Did the first thing" in out
    assert r"\section{Technical Skills}" in out and "Cypress" in out
    assert r"\section{Projects}" in out and "Widget" in out and "{A widget}{Rust}" in out
    assert "Open-source contributor" in out
    assert r"\section{Education}" in out and "State U" in out
    assert r"\section{Languages}" in out and "Native" in out


def test_omits_unselected_sections_and_clearance(tmp_root):
    out = _render(tmp_root, """
        name: p
        summary: short
        clearance_line: false
        email: auto
        sections: [experience]
    """)
    assert "U.S. Public Trust" not in out
    assert r"\section{Projects}" not in out
    assert r"\section{Languages}" not in out
    assert "Engineer." in out


def test_two_role_employer_renders_role_dates(tmp_root):
    # Acme has two roles (acme-senior, acme-junior); check the two-role layout:
    # employer dates on the heading, role dates on each role.
    out = _render(tmp_root, """
        name: p
        summary: short
        clearance_line: false
        email: auto
        sections: [experience]
    """)
    assert "{Senior Engineer}{Jan. 2022 – Present}" in out
    assert "{Engineer}{Oct. 2020 – Jan. 2022}" in out


def test_single_role_employer_has_blank_role_dates(tmp_root):
    from tests.conftest import write_content
    write_content(tmp_root, {"experience.yaml": """
        employers:
          - name: Acme
            start: 2020-10
            end: present
            roles:
              - id: acme-solo
                title: Engineer
                start: 2020-10
                end: present
                bullets:
                  - id: b-one
                    text: Did a thing
                    tags: [backend]
                    weight: 1
                    evidence: "acme#1"
    """})
    out = _render(tmp_root, """
        name: p
        summary: short
        clearance_line: false
        email: auto
        sections: [experience]
    """)
    assert "{Engineer}{}" in out
    # The preamble's \newcommand{\resumeSubSubheading}... definition always
    # contains the literal command name, so check it is never invoked rather
    # than absent outright: exactly one occurrence (the definition).
    assert out.count(r"\resumeSubSubheading") == 1


def test_selected_but_empty_section_is_omitted(tmp_root):
    # projects is a requested section, but a tag filter that matches nothing
    # leaves zero projects and zero notes selected (p-one and n-oss are
    # tagged backend, not federal), so the section must not appear.
    out = _render(tmp_root, """
        name: p
        summary: short
        clearance_line: false
        email: auto
        sections: [projects]
        tags: [federal]
    """)
    assert r"\section{Projects}" not in out


def test_escapes_content(tmp_root):
    from tests.conftest import write_content
    write_content(tmp_root, {"summary.yaml": """
        clearance: ""
        variants:
          commercial: "Cut CI by 60% & more"
          short: "s"
    """})
    out = _render(tmp_root, """
        name: p
        summary: commercial
        clearance_line: false
        email: auto
        sections: [experience]
    """)
    assert r"Cut CI by 60\% \& more" in out
