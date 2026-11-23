from pathlib import Path
import textwrap
import pytest

MINIMAL = {
    "tags.yaml": """
        backend: Backend application work
        testing: Test engineering
        leadership: Leading people or process
        federal: Federal-specific signal
    """,
    "summary.yaml": """
        clearance: "U.S. Public Trust (Tier 2, active)"
        variants:
          commercial: "Senior software engineer."
          short: "Engineer."
    """,
    "experience.yaml": """
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
                  - id: b-one
                    text: Did the first thing
                    tags: [backend]
                    weight: 5
                    evidence: "acme#1"
                  - id: b-two
                    text: Led the second thing
                    tags: [leadership, testing]
                    weight: 3
                    evidence: "acme#2"
              - id: acme-junior
                title: Engineer
                start: 2020-10
                end: 2022-01
                bullets:
                  - id: b-three
                    text: Did a third thing
                    tags: [testing]
                    weight: 2
                    evidence: "acme#3"
    """,
    "projects.yaml": """
        projects:
          - id: p-one
            name: Widget
            url: https://example.com/widget
            text: A widget
            stack: [Rust]
            tags: [backend]
            weight: 4
            evidence: https://example.com/widget
        notes:
          - id: n-oss
            text: Open-source contributor
            tags: [backend]
            weight: 1
            evidence: github
    """,
    "skills.yaml": """
        groups:
          - name: Languages
            items:
              - text: Rust
                tags: [backend]
              - text: Cypress
                tags: [testing]
          - name: Federal
            items:
              - text: ATO
                tags: [federal]
    """,
    "education.yaml": """
        education:
          - institution: State U
            location: Somewhere
            degree: B.A. Computer Science
            date: 2011-12
            tags: [backend]
    """,
    "languages.yaml": """
        languages:
          - name: English
            level: Native
            tags: [backend]
    """,
    "words.txt": "alpha\nbravo\ncharlie\ndelta\necho\nfoxtrot\n",
}


def write_content(root: Path, overrides: dict[str, str] | None = None) -> Path:
    content = root / "content"
    content.mkdir(exist_ok=True)
    files = dict(MINIMAL)
    if overrides:
        files.update(overrides)
    for name, body in files.items():
        (content / name).write_text(textwrap.dedent(body).lstrip("\n"))
    return content


def write_profile(root: Path, name: str, body: str) -> Path:
    profiles = root / "profiles"
    profiles.mkdir(exist_ok=True)
    path = profiles / f"{name}.yaml"
    path.write_text(textwrap.dedent(body).lstrip("\n"))
    return path


@pytest.fixture
def content_dir(tmp_path: Path) -> Path:
    return write_content(tmp_path)


@pytest.fixture
def tmp_root(tmp_path: Path) -> Path:
    write_content(tmp_path)
    return tmp_path
