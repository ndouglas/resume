# Tunable Résumé Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-edited `resume.tex` with a YAML content database, profile files, and a Python generator that reproduces today's résumé byte-for-content, with tests and CI.

**Architecture:** Content lives in `content/*.yaml`, profiles in `profiles/*.yaml`. A small package `tunable/` loads and validates both, selects items per profile with a deterministic tag/weight rule, renders a Jinja2 LaTeX template, and drives `lualatex`. `build.py` is the CLI. This plan covers spec stage 1 (tooling, content transcribed unchanged) and stage 4 (legacy removal). Content rewriting (stages 2–3) is a separate plan.

**Tech Stack:** Python 3.11+, PyYAML, Jinja2, pytest, pypdf, lualatex (TeX Live), pdftotext (poppler), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-11-tunable-resume-design.md`

## Global Constraints

- Python 3.11+; runtime dependencies are exactly PyYAML and Jinja2; test-only dependencies pytest and pypdf.
- Every bullet has `id` (unique, kebab-case), `text`, non-empty `tags` from `content/tags.yaml`, integer `weight` 1–5, non-empty `evidence`.
- Selection rule: tag filter → exclude → include → sort by shared-tag count desc, weight desc, original order → `require` minimums → cap. Nothing else.
- Jinja2 delimiters are `\BLOCK{...}`, `\VAR{...}`, `\#{...}`. Escaper handles `& % $ # _ { } ~ ^ \`.
- Sensitivity patterns (from spec §8): `\$\s?\d`; `\d[\d,]*\s*(veterans|patients|users)`; `\d+(\.\d+)?[-\s](minute|hour|day|month|year)s?\s+(outage|defect|bug)`; literal `PHI leak`, `PII leak`.
- Email: `word.word####@<domain>` from a seeded RNG keyed on profile name; `--email` overrides.
- `dist/` and `build/` are git-ignored. `dist/resume.pdf` is the default profile's alias.
- GitHub Actions stay SHA-pinned with version comments.
- Commit after every task with the trailer `Claude-Session: https://claude.ai/code/session_01TpGrt9ccJLFdFPpQEzqrbT`.
- Never use `--no-verify`.

## File Structure

| Path | Responsibility |
|---|---|
| `resume.yaml` | Contact details, email domain, default profile name |
| `content/tags.yaml` | Tag vocabulary: `tag: description` |
| `content/summary.yaml` | `clearance:` line and `variants:` map |
| `content/experience.yaml` | Employers → roles → bullets |
| `content/projects.yaml` | `projects:` list and `notes:` list |
| `content/skills.yaml` | Skill groups with tagged items |
| `content/education.yaml`, `content/languages.yaml` | Static tagged lists |
| `content/words.txt` | Word list for generated emails |
| `profiles/*.yaml` | One profile per target |
| `templates/resume.tex.j2` | LaTeX template with content slots |
| `tunable/model.py` | Frozen dataclasses only |
| `tunable/loader.py` | YAML → model, all validation, `ContentError` |
| `tunable/select.py` | Selection algorithm, `Selection` result, `all_text()` |
| `tunable/render.py` | Jinja env, `tex()` escaper, date formatting, `render()` |
| `tunable/emailgen.py` | Deterministic address |
| `tunable/sensitivity.py` | Patterns and `violations()` |
| `tunable/pdf.py` | lualatex, pdftotext, page count |
| `build.py` | CLI |
| `tests/` | One test file per module plus content-wide tests |
| `Makefile`, `requirements.txt`, `pytest.ini` | Tooling |
| `.github/workflows/continuous_delivery.yaml` | Test on PR; build and publish on main |

---

### Task 1: Model and loader with validation

**Files:**
- Create: `requirements.txt`, `pytest.ini`, `Makefile`, `tunable/__init__.py`, `tests/__init__.py`, `tunable/model.py`, `tunable/loader.py`
- Modify: `.gitignore` (append `build/`, `dist/`, `.venv/`, `__pycache__/`)
- Test: `tests/test_loader.py`, `tests/conftest.py`

**Interfaces:**
- Produces: `tunable.model` dataclasses (below); `tunable.loader.load_content(root: Path) -> Content`; `tunable.loader.load_profile(path: Path, content: Content) -> Profile`; `tunable.loader.load_config(path: Path) -> Config`; `tunable.loader.ContentError(Exception)`.

- [ ] **Step 1: Scaffolding**

`requirements.txt`:
```
pyyaml>=6.0
jinja2>=3.1
pytest>=8.0
pypdf>=4.0
```

`pytest.ini`:
```ini
[pytest]
testpaths = tests
```

`Makefile`:
```make
.PHONY: test build build-all clean
PROFILE ?= commercial-senior-swe

test:
	python3 -m pytest -q

build:
	python3 build.py --profile $(PROFILE)

build-all:
	python3 build.py --all

clean:
	rm -rf build dist
```

Append to `.gitignore`:
```
# Generator output
build/
dist/
.venv/
__pycache__/
```

`tunable/__init__.py` and `tests/__init__.py`: empty files. The `tests` package is what makes `from tests.conftest import ...` and `import build` resolve, because pytest then puts the repository root on `sys.path`.

Run: `python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt`
(Every later `pytest` and `python3` command in this plan assumes the venv is active.)

- [ ] **Step 2: Write the model**

`tunable/model.py`:
```python
"""Frozen dataclasses for résumé content and profiles. No logic lives here."""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Bullet:
    id: str
    text: str
    tags: tuple[str, ...]
    weight: int
    evidence: str


@dataclass(frozen=True)
class Role:
    id: str
    title: str
    start: str  # "YYYY-MM" or "present"
    end: str
    bullets: tuple[Bullet, ...]


@dataclass(frozen=True)
class Employer:
    name: str
    start: str
    end: str
    roles: tuple[Role, ...]
    location: str = ""


@dataclass(frozen=True)
class Project:
    id: str
    name: str
    url: str
    text: str
    stack: tuple[str, ...]
    tags: tuple[str, ...]
    weight: int
    evidence: str
    emoji: str = ""


@dataclass(frozen=True)
class SkillItem:
    text: str
    tags: tuple[str, ...]


@dataclass(frozen=True)
class SkillGroup:
    name: str
    items: tuple[SkillItem, ...]


@dataclass(frozen=True)
class Education:
    institution: str
    location: str
    degree: str
    date: str
    tags: tuple[str, ...]


@dataclass(frozen=True)
class Language:
    name: str
    level: str
    tags: tuple[str, ...]


@dataclass(frozen=True)
class Content:
    tags: dict[str, str]
    summaries: dict[str, str]
    clearance: str
    employers: tuple[Employer, ...]
    projects: tuple[Project, ...]
    project_notes: tuple[Bullet, ...]
    skills: tuple[SkillGroup, ...]
    education: tuple[Education, ...]
    languages: tuple[Language, ...]

    def role_ids(self) -> set[str]:
        return {r.id for e in self.employers for r in e.roles}

    def item_ids(self) -> set[str]:
        ids = {b.id for e in self.employers for r in e.roles for b in r.bullets}
        ids |= {p.id for p in self.projects}
        ids |= {n.id for n in self.project_notes}
        return ids


@dataclass(frozen=True)
class Require:
    tag: str
    min: int
    roles: tuple[str, ...]


@dataclass(frozen=True)
class Caps:
    default: int | None = None
    roles: dict[str, int] = field(default_factory=dict)
    projects: int | None = None


@dataclass(frozen=True)
class Profile:
    name: str
    summary: str
    clearance_line: bool
    email: str  # "auto" or a literal address
    page_limit: int | None
    sections: tuple[str, ...]
    tags: tuple[str, ...] | None  # None means "no tag filter"
    caps: Caps
    include: tuple[str, ...]
    exclude: tuple[str, ...]
    require: tuple[Require, ...]


@dataclass(frozen=True)
class Config:
    name: str
    phone: str
    phone_plain: str
    website: str
    linkedin: str
    github: str
    email_domain: str
    default_profile: str


SECTIONS = ("experience", "skills", "projects", "education", "languages")
```

- [ ] **Step 3: Write the failing loader tests**

`tests/conftest.py`:
```python
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
```

`tests/test_loader.py`:
```python
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pytest tests/test_loader.py -q`
Expected: ImportError on `tunable.loader`.

- [ ] **Step 5: Write the loader**

`tunable/loader.py`:
```python
"""Load YAML content and profiles into model objects, validating everything.

All validation lives here so a bad file fails before anything renders. Errors
are collected and raised together as one ContentError so the author sees every
problem in one run.
"""
from __future__ import annotations

import re
from pathlib import Path

import yaml

from tunable.model import (
    SECTIONS, Bullet, Caps, Config, Content, Education, Employer, Language,
    Profile, Project, Require, Role, SkillGroup, SkillItem,
)

DATE_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")


class ContentError(Exception):
    """Raised with a newline-separated list of every validation problem found."""


class _Errors:
    def __init__(self) -> None:
        self.items: list[str] = []

    def add(self, msg: str) -> None:
        self.items.append(msg)

    def raise_if_any(self) -> None:
        if self.items:
            raise ContentError("\n".join(self.items))


def _read(path: Path) -> dict:
    with path.open() as f:
        data = yaml.safe_load(f)
    return data or {}


def _tags(raw, where: str, vocab: dict[str, str], errors: _Errors) -> tuple[str, ...]:
    if not isinstance(raw, list) or not raw:
        errors.add(f"{where}: tags must be non-empty")
        return ()
    for t in raw:
        if t not in vocab:
            errors.add(f"{where}: unknown tag '{t}'")
    return tuple(str(t) for t in raw)


def _date(raw, where: str, errors: _Errors) -> str:
    s = str(raw)
    if s != "present" and not DATE_RE.match(s):
        errors.add(f"{where}: date '{s}' must be YYYY-MM or 'present'")
    return s


def _date_key(s: str) -> str:
    return "9999-99" if s == "present" else s


def _bullet(raw: dict, where: str, vocab, errors: _Errors) -> Bullet:
    bid = str(raw.get("id", ""))
    if not ID_RE.match(bid):
        errors.add(f"{where}: id '{bid}' must be kebab-case")
    text = str(raw.get("text", "")).strip()
    if not text:
        errors.add(f"{where} ({bid}): text must be non-empty")
    weight = raw.get("weight")
    if not isinstance(weight, int) or isinstance(weight, bool) or not 1 <= weight <= 5:
        errors.add(f"{where} ({bid}): weight must be 1-5")
        weight = 1
    evidence = str(raw.get("evidence") or "").strip()
    if not evidence:
        errors.add(f"{where} ({bid}): evidence must be non-empty")
    return Bullet(bid, text, _tags(raw.get("tags"), f"{where} ({bid})", vocab, errors), weight, evidence)


def _check_unique(ids: list[str], errors: _Errors) -> None:
    seen: set[str] = set()
    for i in ids:
        if i in seen:
            errors.add(f"duplicate id '{i}'")
        seen.add(i)


def load_content(root: Path) -> Content:
    errors = _Errors()
    vocab_raw = _read(root / "tags.yaml")
    vocab = {str(k): str(v) for k, v in vocab_raw.items()}

    summary = _read(root / "summary.yaml")
    summaries = {str(k): str(v).strip() for k, v in (summary.get("variants") or {}).items()}
    if not summaries:
        errors.add("summary.yaml: variants must be non-empty")
    clearance = str(summary.get("clearance") or "").strip()

    employers: list[Employer] = []
    all_ids: list[str] = []
    role_ids: list[str] = []
    for e in _read(root / "experience.yaml").get("employers") or []:
        ename = str(e.get("name", ""))
        where = f"experience.yaml employer '{ename}'"
        roles: list[Role] = []
        for r in e.get("roles") or []:
            rid = str(r.get("id", ""))
            if not ID_RE.match(rid):
                errors.add(f"{where}: role id '{rid}' must be kebab-case")
            role_ids.append(rid)
            rwhere = f"{where} role '{rid}'"
            bullets = [_bullet(b, rwhere, vocab, errors) for b in r.get("bullets") or []]
            all_ids += [b.id for b in bullets]
            roles.append(Role(rid, str(r.get("title", "")), _date(r.get("start"), rwhere, errors),
                              _date(r.get("end"), rwhere, errors), tuple(bullets)))
        starts = [_date_key(r.start) for r in roles]
        if starts != sorted(starts, reverse=True):
            errors.add(f"roles of '{ename}' must be in reverse chronological order")
        employers.append(Employer(ename, _date(e.get("start"), where, errors), _date(e.get("end"), where, errors),
                                  tuple(roles), str(e.get("location") or "")))
    _check_unique(role_ids, errors)

    proj_raw = _read(root / "projects.yaml")
    projects: list[Project] = []
    for p in proj_raw.get("projects") or []:
        b = _bullet(p, "projects.yaml", vocab, errors)
        projects.append(Project(b.id, str(p.get("name", "")), str(p.get("url", "")), b.text,
                                tuple(str(s) for s in p.get("stack") or []), b.tags, b.weight, b.evidence,
                                str(p.get("emoji") or "")))
    notes = [_bullet(n, "projects.yaml notes", vocab, errors) for n in proj_raw.get("notes") or []]
    all_ids += [p.id for p in projects] + [n.id for n in notes]
    _check_unique(all_ids, errors)

    groups: list[SkillGroup] = []
    for g in _read(root / "skills.yaml").get("groups") or []:
        gname = str(g.get("name", ""))
        items = [SkillItem(str(i.get("text", "")), _tags(i.get("tags"), f"skills.yaml '{gname}'", vocab, errors))
                 for i in g.get("items") or []]
        groups.append(SkillGroup(gname, tuple(items)))

    education = [Education(str(x.get("institution", "")), str(x.get("location") or ""), str(x.get("degree", "")),
                           _date(x.get("date"), "education.yaml", errors),
                           _tags(x.get("tags"), "education.yaml", vocab, errors))
                 for x in _read(root / "education.yaml").get("education") or []]
    languages = [Language(str(x.get("name", "")), str(x.get("level", "")),
                          _tags(x.get("tags"), "languages.yaml", vocab, errors))
                 for x in _read(root / "languages.yaml").get("languages") or []]

    errors.raise_if_any()
    return Content(vocab, summaries, clearance, tuple(employers), tuple(projects), tuple(notes),
                   tuple(groups), tuple(education), tuple(languages))


def load_profile(path: Path, content: Content) -> Profile:
    errors = _Errors()
    raw = _read(path)
    name = str(raw.get("name") or path.stem)
    where = f"profile '{name}'"

    summary = str(raw.get("summary", ""))
    if summary not in content.summaries:
        errors.add(f"{where}: unknown summary variant '{summary}'")

    sections = tuple(str(s) for s in raw.get("sections") or [])
    for s in sections:
        if s not in SECTIONS:
            errors.add(f"{where}: unknown section '{s}'")

    tags_raw = raw.get("tags")
    tags: tuple[str, ...] | None = None
    if tags_raw is not None:
        tags = _tags(tags_raw, where, content.tags, errors)

    item_ids = content.item_ids()
    include = tuple(str(i) for i in raw.get("include") or [])
    exclude = tuple(str(i) for i in raw.get("exclude") or [])
    for i in include + exclude:
        if i not in item_ids:
            errors.add(f"{where}: unknown item id '{i}'")

    role_ids = content.role_ids()
    caps_raw = raw.get("caps") or {}
    role_caps = {str(k): int(v) for k, v in (caps_raw.get("roles") or {}).items()}
    for r in role_caps:
        if r not in role_ids:
            errors.add(f"{where}: unknown role id '{r}' in caps")
    caps = Caps(caps_raw.get("default"), role_caps, caps_raw.get("projects"))

    require: list[Require] = []
    for q in raw.get("require") or []:
        tag = str(q.get("tag", ""))
        if tag not in content.tags:
            errors.add(f"{where}: unknown tag '{tag}' in require")
        roles = tuple(str(r) for r in q.get("roles") or [])
        for r in roles:
            if r not in role_ids:
                errors.add(f"{where}: unknown role id '{r}' in require")
        require.append(Require(tag, int(q.get("min", 1)), roles))

    page_limit = raw.get("page_limit")
    errors.raise_if_any()
    return Profile(name, summary, bool(raw.get("clearance_line", False)), str(raw.get("email", "auto")),
                   int(page_limit) if page_limit is not None else None, sections, tags, caps,
                   include, exclude, tuple(require))


def load_config(path: Path) -> Config:
    raw = _read(path)
    missing = [k for k in ("name", "phone", "phone_plain", "website", "linkedin", "github",
                           "email_domain", "default_profile") if k not in raw]
    if missing:
        raise ContentError(f"resume.yaml: missing {', '.join(missing)}")
    return Config(**{k: str(raw[k]) for k in
                     ("name", "phone", "phone_plain", "website", "linkedin", "github",
                      "email_domain", "default_profile")})
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_loader.py -q`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add requirements.txt pytest.ini Makefile .gitignore tunable tests
git commit -m "Add content model and validating loader

Claude-Session: https://claude.ai/code/session_01TpGrt9ccJLFdFPpQEzqrbT"
```

---

### Task 2: Transcribe today's résumé into content files and a master profile

**Files:**
- Create: `resume.yaml`, `content/tags.yaml`, `content/summary.yaml`, `content/experience.yaml`, `content/projects.yaml`, `content/skills.yaml`, `content/education.yaml`, `content/languages.yaml`, `content/words.txt`, `profiles/master.yaml`
- Test: `tests/test_content.py`

**Interfaces:**
- Consumes: `load_content`, `load_profile`, `load_config` from Task 1.
- Produces: the real content set. Later tasks and the content-rewrite plan edit these files.

Content is transcribed from `resume.tex` unchanged except: `\LaTeX` becomes the plain word "LaTeX", `\%` becomes `%`, and the `→` arrows stay as Unicode. Weights and tags are provisional and will be revised in the content plan.

- [ ] **Step 1: Write the failing content tests**

`tests/test_content.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_content.py -q`
Expected: FAIL, files missing.

- [ ] **Step 3: Write `resume.yaml`**

```yaml
name: Nathan Douglas
phone: "(330) 998-8049"
phone_plain: "+13309988049"
website: darkdell.net
linkedin: nug-doug
github: ndouglas
email_domain: tenesm.us
default_profile: commercial-senior-swe
```

- [ ] **Step 4: Write `content/tags.yaml`**

```yaml
backend: Application and API engineering
platform: Internal developer platform, shared infrastructure
aws: Amazon Web Services
kubernetes: Kubernetes and container orchestration
terraform: Terraform, Terragrunt, infrastructure as code
serverless: Lambda, API Gateway, managed services
drupal: Drupal and PHP content platforms
php: PHP
node: Node.js
typescript: TypeScript and JavaScript
rust: Rust
testing: Test engineering, static analysis, quality gates
ci-cd: Pipelines, delivery automation, release engineering
security: Credentials, supply chain, hardening
observability: Metrics, logs, traces, monitors, dashboards
incident-response: Incidents, postmortems, on-call
cost: Cost analysis and capacity
migration: Migrations, upgrades, cutovers, decommissions
architecture: System design and patterns adopted by others
ownership: End-to-end responsibility for a system
leadership: Recruiting, running process, decomposing work for others
mentoring: Growing other engineers
documentation: Runbooks, strategy docs, guides
cross-team: Sustained work in other teams' systems
federal: Federal-specific signal
ato: Authority to Operate and compliance
fedramp: FedRAMP-constrained tooling
govcloud: AWS GovCloud
healthcare: Healthcare data and EHR integration
open-source: Upstream contributions
ml: Machine learning
research: Exploratory or research-flavoured work
macos: macOS and iOS
```

- [ ] **Step 5: Write `content/summary.yaml`**

```yaml
clearance: "U.S. Public Trust (Tier 2, active) · Prior Top Secret clearance"
variants:
  commercial: >-
    Platform engineer with 14+ years building distributed infrastructure and
    observability-heavy systems. Focused on making complex systems behave
    predictably: migration without downtime, deployment without failure,
    correctness by design. Exploring formal verification (TLA+) for
    distributed and ML-serving systems.
```

(This is today's text verbatim; the content plan replaces it.)

- [ ] **Step 6: Write `content/experience.yaml`**

```yaml
employers:
  - name: Agile Six Applications, Inc (contract to U.S. Department of Veterans Affairs)
    start: 2020-10
    end: present
    roles:
      - id: cie
        title: Senior Platform Engineer
        start: 2024-02
        end: present
        bullets:
          - id: cie-account-migration
            text: >-
              Migrated VA.gov Check-In infrastructure between AWS accounts with
              zero downtime; converted CloudFormation to Terraform with
              automated testing to resolve configuration drift
            tags: [aws, terraform, migration, ownership, govcloud]
            weight: 5
            evidence: "cutover 2026-07-29; checkin-devops#1958"
          - id: cie-system-tests
            text: >-
              Engineered cross-product system tests for VA.gov, automating
              integrations with VistA EHR, Oracle Health, and VEText to verify
              PHI/PII compliance across critical veteran healthcare workflows
            tags: [testing, healthcare, aws, serverless]
            weight: 4
            evidence: "cie-system-tests repo"
      - id: cms-tl
        title: Technical Lead
        start: 2023-07
        end: 2024-02
        bullets:
          - id: cms-tl-drupal-upgrades
            text: >-
              Led Drupal 8→9 and 9→10 upgrades as Technical Lead for a
              12-person CMS team, coordinating tenant teams and stakeholders
              with zero unplanned downtime
            tags: [drupal, migration, leadership, cross-team]
            weight: 5
            evidence: "va.gov-cms#5667, #8159, #11014; D10 shipped 2023-11-29"
          - id: cms-tl-ci-and-release
            text: >-
              Reduced CI runtime by 60% through test parallelization;
              architected event-driven content release pipeline serving
              VA.gov's static content with zero deployment-related failures
            tags: [ci-cd, testing, architecture, drupal]
            weight: 5
            evidence: "va.gov-cms#14540, #14834, #13844, #14794"
          - id: cms-tl-ato
            text: >-
              Maintained Authority to Operate (ATO) for VistA-integrated
              PHI/PII systems, resolving regulatory identity gaps through
              audits and tabletop exercises
            tags: [ato, federal, security, healthcare]
            weight: 3
            evidence: "from memory; discuss in interview"
          - id: cms-tl-recruiting
            text: >-
              Recruited senior engineers and a QA architect to remediate
              systemic technical debt and flaky tests
            tags: [leadership, testing]
            weight: 3
            evidence: "from memory; discuss in interview"
      - id: cms-sse
        title: Senior Software/DevOps Engineer
        start: 2020-10
        end: 2023-07
        bullets:
          - id: cms-sse-qa-initiative
            text: >-
              Spearheaded QA initiative to broaden unit test coverage, refine
              behavioral and accessibility tests, and mentor engineers on test
              and system design
            tags: [testing, mentoring, leadership, drupal]
            weight: 4
            evidence: "62% of tests/ by blame at exit; va.gov-cms#8746, #12620"
          - id: cms-sse-runner-service
            text: >-
              Implemented a service to monitor and respond to corner cases in
              GitHub Actions self-hosted runner registration and
              orchestration, improving CI reliability
            tags: [ci-cd, aws, node]
            weight: 2
            evidence: "content-build#1676, #1687"
  - name: Convention News Company
    start: 2016-01
    end: 2020-10
    roles:
      - id: ain
        title: Senior Software/DevOps Engineer
        start: 2016-01
        end: 2020-10
        bullets:
          - id: ain-acquia-to-aws
            text: >-
              Led migration from Acquia to AWS, reducing annual infrastructure
              costs by 70% and eliminating legacy stability issues
            tags: [aws, migration, cost, ownership, drupal]
            weight: 5
            evidence: "from memory; discuss in interview"
          - id: ain-headless-architecture
            text: >-
              Engineered a headless Drupal and Next.js architecture on AWS,
              integrating Stripe and AWS Cognito for subscription services with
              independent scaling
            tags: [architecture, backend, aws, drupal, typescript]
            weight: 4
            evidence: "from memory; discuss in interview"
          - id: ain-lambda-services
            text: >-
              Built Lambda-based subscriber services and data pipelines with
              CloudWatch and Slack for real-time monitoring; optimized
              performance via Varnish and Redis caching
            tags: [serverless, backend, observability, aws]
            weight: 3
            evidence: "from memory; discuss in interview"
          - id: ain-ci-cd
            text: >-
              Established CI/CD pipelines and containerized development
              environments, increasing deployment frequency to multiple times
              daily
            tags: [ci-cd, platform]
            weight: 4
            evidence: "from memory; discuss in interview"
          - id: ain-mentoring
            text: >-
              Mentored junior engineers on clean code practices and peer
              review, improving ticket turnaround and codebase
              maintainability
            tags: [mentoring, leadership]
            weight: 3
            evidence: "from memory; discuss in interview"
  - name: DEVONtechnologies
    start: 2012-01
    end: 2015-12
    roles:
      - id: devon
        title: Software Engineer
        start: 2012-01
        end: 2015-12
        bullets:
          - id: devon-sync-features
            text: >-
              Developed client-side features and synchronization functionality
              for DEVONthink across macOS and iOS, working across cloud storage
              and peer-to-peer sync backends
            tags: [backend, macos]
            weight: 3
            evidence: "from memory; discuss in interview"
          - id: devon-sync-ownership
            text: >-
              Took ownership of a complex sync subsystem during a high-risk
              engineer transition, supporting release stabilization, defect
              resolution, and customer issue triage
            tags: [ownership, backend, macos]
            weight: 4
            evidence: "from memory; discuss in interview"
          - id: devon-legacy-objc
            text: >-
              Contributed to release engineering and iterative debugging in a
              legacy Objective-C codebase with significant performance,
              reliability, and memory-management constraints
            tags: [backend, macos, ci-cd]
            weight: 2
            evidence: "from memory; discuss in interview"
```

- [ ] **Step 7: Write `content/projects.yaml`**

```yaml
projects:
  - id: goldentooth
    name: Goldentooth
    emoji: "🦷"
    url: https://github.com/goldentooth/
    text: >-
      Personal research lab: multi-node Kubernetes cluster exploring
      infrastructure verification (TLA+), GPU compute, full observability, and
      GitOps deployment
    stack: [Talos, Kubernetes, Flux CD, TLA+]
    tags: [kubernetes, observability, platform]
    weight: 5
    evidence: ~/Projects/goldentooth
  - id: bitwit
    name: Bitwit
    emoji: "📚"
    url: https://bit-wit.com/
    text: >-
      Spaced repetition platform for CS education with time-based grading and
      parameterized card generation
    stack: [TypeScript, AWS Lambda, DynamoDB]
    tags: [typescript, serverless, backend]
    weight: 3
    evidence: https://bit-wit.com/
  - id: whispers
    name: Whispers
    emoji: "🗣️"
    url: https://github.com/ndouglas/whispers/
    text: >-
      Gossip-based mesh network with fraud-resistant distributed optimization
      via audited CRDTs
    stack: [Rust]
    tags: [rust, research]
    weight: 2
    evidence: https://github.com/ndouglas/whispers/
  - id: distillation
    name: Distillation
    emoji: "🧪"
    url: https://github.com/ndouglas/distillation/
    text: >-
      Knowledge distillation with Jacobian/Hessian regularization and
      adversarial training
    stack: [Python, PyTorch]
    tags: [ml, research]
    weight: 2
    evidence: https://github.com/ndouglas/distillation/
  - id: blackpool
    name: Blackpool
    emoji: "💻"
    url: https://github.com/ndouglas/blackpool/
    text: >-
      Stack-based bytecode VM with mark-and-sweep GC, closures, and
      inheritance
    stack: [Rust]
    tags: [rust, backend]
    weight: 3
    evidence: https://github.com/ndouglas/blackpool/
  - id: longtable
    name: Longtable
    emoji: "🎲"
    url: https://github.com/ndouglas/longtable/
    text: >-
      Rule-based simulation engine with LISP DSL, immutable world state, and
      time-travel debugging
    stack: [Rust]
    tags: [rust, backend]
    weight: 3
    evidence: ~/Projects/ndouglas/longtable
  - id: greenstone
    name: Greenstone
    emoji: "🎮"
    url: https://github.com/ndouglas/greenstone/
    text: >-
      Cycle-accurate NES emulator with precise timing and hardware modeling
    stack: [Rust]
    tags: [rust, backend]
    weight: 3
    evidence: ~/Projects/ndouglas/greenstone
  - id: clork
    name: Clork
    emoji: "📜"
    url: https://github.com/ndouglas/clork/
    text: >-
      Zork I port with an OpenAI Gym-style RL training API
    stack: [Clojure]
    tags: [research, backend]
    weight: 2
    evidence: ~/Projects/ndouglas/clork
notes:
  - id: open-source-note
    text: >-
      Open-source contributor to Terraform, OpenTofu, Argo CD, Datadog,
      Couchbase, and Drupal, among others
    tags: [open-source]
    weight: 1
    evidence: "gh search prs --author ndouglas --merged (verified 2026-09-11; OpenTofu not found, to fix in content plan)"
```

- [ ] **Step 8: Write `content/skills.yaml`, `content/education.yaml`, `content/languages.yaml`, `content/words.txt`**

`content/skills.yaml`:
```yaml
groups:
  - name: Languages
    items:
      - {text: Rust, tags: [rust]}
      - {text: Python, tags: [backend]}
      - {text: Bash, tags: [platform]}
      - {text: JavaScript, tags: [typescript, node]}
      - {text: TypeScript, tags: [typescript, node]}
      - {text: PHP, tags: [php, drupal]}
      - {text: Go, tags: [backend]}
      - {text: C, tags: [backend]}
      - {text: Objective-C, tags: [macos]}
      - {text: Clojure, tags: [research]}
      - {text: LaTeX, tags: [documentation]}
  - name: Infrastructure-as-Code
    items:
      - {text: Terraform, tags: [terraform]}
      - {text: Ansible, tags: [platform]}
      - {text: CloudFormation, tags: [aws]}
      - {text: Terragrunt, tags: [terraform]}
  - name: Orchestration
    items:
      - {text: Kubernetes, tags: [kubernetes]}
      - {text: Docker, tags: [platform]}
      - {text: Nomad, tags: [research]}
  - name: CI/CD
    items:
      - {text: GitHub Actions, tags: [ci-cd]}
      - {text: Jenkins, tags: [ci-cd]}
      - {text: CodeBuild/CodePipeline, tags: [ci-cd, aws]}
  - name: Observability
    items:
      - {text: Prometheus, tags: [observability]}
      - {text: Grafana, tags: [observability]}
      - {text: OpenTelemetry, tags: [observability]}
      - {text: Datadog, tags: [observability]}
      - {text: CloudWatch, tags: [observability, aws]}
  - name: Networking/Security
    items:
      - {text: Consul, tags: [research]}
      - {text: Envoy, tags: [research]}
      - {text: Vault, tags: [security]}
      - {text: Cilium, tags: [kubernetes]}
```

`content/education.yaml`:
```yaml
education:
  - institution: University of Nevada, Las Vegas
    location: Las Vegas, NV
    degree: Bachelor of Arts in Computer Science
    date: 2011-12
    tags: [backend]
```

`content/languages.yaml`:
```yaml
languages:
  - {name: English, level: Native, tags: [backend]}
  - {name: French, level: "A2/B1 (in progress, targeting C1 by 2028)", tags: [backend]}
```

`content/words.txt` (one word per line, lowercase, 64 words):
```
amber basil cedar coral dusk ember fable fern flint gale glade grove harbor
heron ivory jade juniper kestrel lark linden marsh moss myrtle north oak
olive onyx orchid osprey pebble pine plover quartz quince raven reed ridge
river robin sable sage sedge slate sorrel spruce sterling stone summit
tarn teal thistle thorn tide timber topaz umber vale violet wren yarrow
zephyr cobalt drift
```

- [ ] **Step 9: Write `profiles/master.yaml`**

```yaml
name: master
summary: commercial
clearance_line: true
email: auto
sections: [experience, skills, projects, education, languages]
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `pytest -q`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add resume.yaml content profiles tests/test_content.py
git commit -m "Transcribe current résumé into content files

Claude-Session: https://claude.ai/code/session_01TpGrt9ccJLFdFPpQEzqrbT"
```

---

### Task 3: Selection

**Files:**
- Create: `tunable/select.py`
- Test: `tests/test_select.py`

**Interfaces:**
- Consumes: model types, `load_content`, `load_profile`.
- Produces: `tunable.select.select(content: Content, profile: Profile) -> Selection`; `Selection` fields `summary: str`, `clearance: str | None`, `employers: tuple[SelectedEmployer, ...]`, `projects: tuple[Project, ...]`, `project_notes: tuple[Bullet, ...]`, `skills: tuple[SkillGroup, ...]`, `education: tuple[Education, ...]`, `languages: tuple[Language, ...]`, `sections: tuple[str, ...]`; `SelectedEmployer(employer: Employer, roles: tuple[SelectedRole, ...])`; `SelectedRole(role: Role, bullets: tuple[Bullet, ...])`; `tunable.select.all_text(selection: Selection) -> list[str]`; `tunable.select.pick(items, profile, cap, role_id=None) -> list`.

- [ ] **Step 1: Write the failing selection tests**

`tests/test_select.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_select.py -q`
Expected: ImportError on `tunable.select`.

- [ ] **Step 3: Write the selector**

`tunable/select.py`:
```python
"""Pick which content a profile renders.

The rule, in order: tag filter, exclude, include, sort by (shared tags desc,
weight desc, original order), enforce `require` minimums, cap. Nothing else,
so the reason an item appears is predictable from the profile file alone.
"""
from __future__ import annotations

from dataclasses import dataclass

from tunable.model import (
    Bullet, Content, Education, Employer, Language, Profile, Project, Role, SkillGroup,
)


@dataclass(frozen=True)
class SelectedRole:
    role: Role
    bullets: tuple[Bullet, ...]


@dataclass(frozen=True)
class SelectedEmployer:
    employer: Employer
    roles: tuple[SelectedRole, ...]


@dataclass(frozen=True)
class Selection:
    summary: str
    clearance: str | None
    sections: tuple[str, ...]
    employers: tuple[SelectedEmployer, ...]
    projects: tuple[Project, ...]
    project_notes: tuple[Bullet, ...]
    skills: tuple[SkillGroup, ...]
    education: tuple[Education, ...]
    languages: tuple[Language, ...]


def _shared(item, profile: Profile) -> int:
    if profile.tags is None:
        return 0
    return len(set(item.tags) & set(profile.tags))


def _matches(item, profile: Profile) -> bool:
    return profile.tags is None or _shared(item, profile) > 0


def pick(items, profile: Profile, cap: int | None, role_id: str | None = None) -> list:
    """Apply the selection rule to a list of Bullets or Projects."""
    kept = [i for i in items if (_matches(i, profile) or i.id in profile.include) and i.id not in profile.exclude]
    ranked = sorted(enumerate(kept), key=lambda p: (-_shared(p[1], profile), -p[1].weight, p[0]))
    ranked = [i for _, i in ranked]
    if cap is None:
        return ranked
    chosen = ranked[:cap]
    for req in profile.require:
        if role_id is None or role_id not in req.roles:
            continue
        have = [i for i in chosen if req.tag in i.tags]
        needed = [i for i in ranked if req.tag in i.tags and i not in chosen][: max(0, req.min - len(have))]
        for item in needed:
            victims = [i for i in reversed(chosen) if req.tag not in i.tags]
            if not victims:
                break
            chosen.remove(victims[0])
            chosen.append(item)
    chosen.sort(key=ranked.index)
    return chosen


def _role_cap(profile: Profile, role_id: str) -> int | None:
    return profile.caps.roles.get(role_id, profile.caps.default)


def select(content: Content, profile: Profile) -> Selection:
    wants = set(profile.sections)
    employers: list[SelectedEmployer] = []
    if "experience" in wants:
        for e in content.employers:
            roles = tuple(SelectedRole(r, tuple(pick(r.bullets, profile, _role_cap(profile, r.id), r.id)))
                          for r in e.roles)
            employers.append(SelectedEmployer(e, roles))

    projects: tuple[Project, ...] = ()
    notes: tuple[Bullet, ...] = ()
    if "projects" in wants:
        projects = tuple(pick(content.projects, profile, profile.caps.projects))
        notes = tuple(pick(content.project_notes, profile, profile.caps.default))

    skills: tuple[SkillGroup, ...] = ()
    if "skills" in wants:
        groups = []
        for g in content.skills:
            items = tuple(i for i in g.items if _matches(i, profile))
            if items:
                groups.append(SkillGroup(g.name, items))
        skills = tuple(groups)

    education = tuple(x for x in content.education if _matches(x, profile)) if "education" in wants else ()
    languages = tuple(x for x in content.languages if _matches(x, profile)) if "languages" in wants else ()

    return Selection(
        summary=content.summaries[profile.summary],
        clearance=content.clearance if profile.clearance_line else None,
        sections=profile.sections,
        employers=tuple(employers),
        projects=projects,
        project_notes=notes,
        skills=skills,
        education=education,
        languages=languages,
    )


def all_text(sel: Selection) -> list[str]:
    """Every human-readable string the selection will render, for lint checks."""
    out = [sel.summary]
    if sel.clearance:
        out.append(sel.clearance)
    for e in sel.employers:
        out.append(e.employer.name)
        for r in e.roles:
            out.append(r.role.title)
            out += [b.text for b in r.bullets]
    for p in sel.projects:
        out += [p.name, p.text, ", ".join(p.stack)]
    out += [n.text for n in sel.project_notes]
    for g in sel.skills:
        out.append(g.name)
        out += [i.text for i in g.items]
    for x in sel.education:
        out += [x.institution, x.location, x.degree]
    for x in sel.languages:
        out += [x.name, x.level]
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_select.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tunable/select.py tests/test_select.py
git commit -m "Add deterministic profile selection

Claude-Session: https://claude.ai/code/session_01TpGrt9ccJLFdFPpQEzqrbT"
```

---

### Task 4: Sensitivity lint

**Files:**
- Create: `tunable/sensitivity.py`
- Test: `tests/test_sensitivity.py`

**Interfaces:**
- Consumes: `select`, `all_text`, loaders.
- Produces: `tunable.sensitivity.violations(text: str) -> list[str]` (each entry `"<rule>: <matched text>"`); `tunable.sensitivity.PATTERNS: list[tuple[str, re.Pattern]]`.

- [ ] **Step 1: Write the failing tests**

`tests/test_sensitivity.py`:
```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_sensitivity.py -q`
Expected: ImportError.

- [ ] **Step 3: Write the linter**

`tunable/sensitivity.py`:
```python
"""Patterns that must never appear in rendered résumé text.

Encodes the sensitivity rule from the design spec (§3, §8). Add a pattern here
and it applies to every profile, present and future.
"""
import re

PATTERNS: list[tuple[str, re.Pattern]] = [
    ("dollar amount", re.compile(r"\$\s?\d[\d,.]*[KkMm]?")),
    ("people count", re.compile(r"\d[\d,]*\s*(veterans|patients|users)\b", re.I)),
    ("incident duration", re.compile(
        r"\d+(\.\d+)?[-\s](minute|hour|day|month|year)s?\s+(outage|defect|bug)\b", re.I)),
    ("PHI/PII incident", re.compile(r"\bP[HI]I leak\b", re.I)),
]


def violations(text: str) -> list[str]:
    found = []
    for name, pattern in PATTERNS:
        for m in pattern.finditer(text):
            found.append(f"{name}: {m.group(0)}")
    return found
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_sensitivity.py -q`
Expected: all pass (today's content has no violations).

- [ ] **Step 5: Commit**

```bash
git add tunable/sensitivity.py tests/test_sensitivity.py
git commit -m "Add sensitivity lint over rendered text

Claude-Session: https://claude.ai/code/session_01TpGrt9ccJLFdFPpQEzqrbT"
```

---

### Task 5: Deterministic email addresses

**Files:**
- Create: `tunable/emailgen.py`
- Test: `tests/test_emailgen.py`

**Interfaces:**
- Produces: `tunable.emailgen.address(profile_name: str, domain: str, words: list[str]) -> str`; `tunable.emailgen.load_words(path: Path) -> list[str]`.

- [ ] **Step 1: Write the failing tests**

`tests/test_emailgen.py`:
```python
import re
from pathlib import Path
from tunable.emailgen import address, load_words

WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"]


def test_shape():
    assert re.fullmatch(r"[a-z]+\.[a-z]+\d{4}@tenesm\.us", address("p", "tenesm.us", WORDS))


def test_deterministic_per_profile():
    assert address("commercial", "tenesm.us", WORDS) == address("commercial", "tenesm.us", WORDS)
    assert address("commercial", "tenesm.us", WORDS) != address("govtech", "tenesm.us", WORDS)


def test_two_distinct_words():
    local = address("p", "x.org", WORDS).split("@")[0]
    first, second = local.rstrip("0123456789").split(".")
    assert first != second


def test_load_words(tmp_path: Path):
    p = tmp_path / "w.txt"
    p.write_text("one two\nthree\n\n")
    assert load_words(p) == ["one", "two", "three"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_emailgen.py -q`
Expected: ImportError.

- [ ] **Step 3: Write the generator**

`tunable/emailgen.py`:
```python
"""Stable, traceable catch-all addresses: one per profile, derived from its name."""
import hashlib
import random
from pathlib import Path


def load_words(path: Path) -> list[str]:
    return [w for w in path.read_text().split() if w]


def address(profile_name: str, domain: str, words: list[str]) -> str:
    seed = int.from_bytes(hashlib.sha256(profile_name.encode()).digest()[:8], "big")
    rng = random.Random(seed)
    first, second = rng.sample(words, 2)
    return f"{first}.{second}{rng.randint(0, 9999):04d}@{domain}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_emailgen.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tunable/emailgen.py tests/test_emailgen.py
git commit -m "Add deterministic per-profile email addresses

Claude-Session: https://claude.ai/code/session_01TpGrt9ccJLFdFPpQEzqrbT"
```

---

### Task 6: Renderer and LaTeX template

**Files:**
- Create: `tunable/render.py`, `templates/resume.tex.j2`
- Test: `tests/test_render.py`

**Interfaces:**
- Consumes: `Selection`, `Profile`, `Config`.
- Produces: `tunable.render.tex(s: str) -> str` (escaper); `tunable.render.fmt_date(s: str) -> str`; `tunable.render.render(selection: Selection, config: Config, email: str, template_dir: Path) -> str`.

- [ ] **Step 1: Write the failing tests**

`tests/test_render.py`:
```python
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


def test_single_role_employer_has_blank_role_dates(tmp_root):
    # acme-junior is the second role; render a profile that only keeps acme-senior's bullets
    # and check the two-role layout: employer dates on the heading, role dates on each role
    out = _render(tmp_root, """
        name: p
        summary: short
        clearance_line: false
        email: auto
        sections: [experience]
    """)
    assert "{Senior Engineer}{Jan. 2022 – Present}" in out
    assert "{Engineer}{Oct. 2020 – Jan. 2022}" in out


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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_render.py -q`
Expected: ImportError.

- [ ] **Step 3: Write the renderer**

`tunable/render.py`:
```python
"""Render a Selection into LaTeX source using the Jinja2 template.

Jinja delimiters are chosen so they never collide with LaTeX braces:
  \BLOCK{ ... }   statements
  \VAR{ ... }     expressions
  \#{ ... }       comments
Every content string passes through the `tex` filter.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from tunable.model import Config
from tunable.select import Selection

_ESCAPES = [
    ("\\", r"\textbackslash{}"),
    ("&", r"\&"), ("%", r"\%"), ("$", r"\$"), ("#", r"\#"), ("_", r"\_"),
    ("{", r"\{"), ("}", r"\}"),
    ("~", r"\textasciitilde{}"), ("^", r"\textasciicircum{}"),
]


def tex(s: str) -> str:
    out = str(s)
    # Backslash first so later escapes are not re-escaped; braces after the
    # backslash replacement would otherwise catch the braces it introduces.
    out = out.replace("\\", "\x00")
    for ch, rep in _ESCAPES[1:]:
        out = out.replace(ch, rep)
    return out.replace("\x00", r"\textbackslash{}")


def fmt_date(s: str) -> str:
    if s == "present":
        return "Present"
    year, month = (int(x) for x in s.split("-"))
    name = date(year, month, 1).strftime("%b")
    return f"{name} {year}" if name == "May" else f"{name}. {year}"


def _env(template_dir: Path) -> Environment:
    env = Environment(
        loader=FileSystemLoader(str(template_dir)),
        block_start_string=r"\BLOCK{", block_end_string="}",
        variable_start_string=r"\VAR{", variable_end_string="}",
        comment_start_string=r"\#{", comment_end_string="}",
        trim_blocks=True, lstrip_blocks=True, autoescape=False,
        keep_trailing_newline=True,
    )
    env.filters["tex"] = tex
    env.filters["date"] = fmt_date
    return env


def render(selection: Selection, config: Config, email: str, template_dir: Path) -> str:
    template = _env(template_dir).get_template("resume.tex.j2")
    return template.render(sel=selection, cfg=config, email=email)
```

- [ ] **Step 4: Write the template**

`templates/resume.tex.j2` (the preamble is today's `resume.tex` lines 1–110 verbatim, with the `%%%%%%  RESUME STARTS HERE` line removed; then the body below):

```latex
% !TeX program = lualatex
% Nug Doug's Tunable Résumé. Rendered from content/ and profiles/ by build.py;
% do not edit the generated .tex by hand.
%
% (c) 2024 Nathan Douglas https://darkdell.net
% Released under the Unlicense. See LICENSE for details.

\documentclass[letterpaper,11pt]{article}

\usepackage{latexsym}
\usepackage[empty]{fullpage}
\usepackage{titlesec}
\usepackage{marvosym}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{fancyhdr}
\usepackage[english]{babel}
\usepackage{tabularx}
\usepackage{fontawesome5}
\usepackage{fontspec}

\directlua{luaotfload.add_fallback
  ("emojifallback",
    {
      "NotoColorEmoji:mode=harf;"
    }
  )}

\setmainfont{texgyretermes-regular}[
  Extension      = .otf ,
  BoldFont       = texgyretermes-bold,
  ItalicFont     = texgyretermes-italic,
  BoldItalicFont = texgyretermes-bolditalic,
  RawFeature={fallback=emojifallback}
]

\def\pdfglyphtounicode#1#2{}
\input{glyphtounicode}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\addtolength{\oddsidemargin}{-0.5in}
\addtolength{\evensidemargin}{-0.5in}
\addtolength{\textwidth}{1in}
\addtolength{\topmargin}{-.5in}
\addtolength{\textheight}{1.0in}

\urlstyle{same}
\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

\titleformat{\section}{
  \vspace{-4pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

\newcommand{\emoji}[1]{\ifmmode \text{\emojifont{#1}} \else \emojifont{#1} \fi}

\newcommand{\resumeItem}[1]{
  \item\small{
    {#1 \vspace{-2pt}}
  }
}

\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & #2 \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubSubheading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \textit{\small#1} & \textit{\small #2} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubheadingNote}[1]{\vspace{0pt}\item\hspace{1em}\small{\emph{#1}}\vspace{-7pt}}

\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}

\newenvironment{resumeListicle}{
    \small
    \setlength{\itemsep}{0pt}
    \setlength{\parskip}{0pt}
}{}

\newcommand{\resumeListicleStart}{\begin{resumeListicle}}
\newcommand{\resumeListicleEnd}{\end{resumeListicle}}
\newcommand{\resumeListicleItem}[2]{%
  \item \textbf{#1}: #2%
}
\newcommand{\resumeSideProjectListicleItem}[4]{%
  \item \textbf{\href{#1}{#2}}: #3 (\emph{#4})%
}

\begin{document}

%----------HEADING----------
\begin{center}
  \textbf{\Huge \scshape \VAR{cfg.name|tex}} \\ \vspace{1pt}
  \small \faPhone\hspace{0.5em}\VAR{cfg.phone|tex}\hspace{0.25em} $|$ \href{mailto:\VAR{email}}{\faAt\hspace{0.5em}\underline{\VAR{email|tex}}} $|$
  \href{https://linkedin.com/in/\VAR{cfg.linkedin}}{\faLinkedin\hspace{0.5em}\underline{linkedin.com/in/\VAR{cfg.linkedin|tex}}} $|$
  \href{https://github.com/\VAR{cfg.github}}{\faGithub\hspace{0.5em}\underline{github.com/\VAR{cfg.github|tex}}} $|$
  \href{https://\VAR{cfg.website}}{\faGlobe\hspace{0.5em}\underline{\VAR{cfg.website|tex}}}
\end{center}

\begin{center}
\VAR{sel.summary|tex}
\BLOCK{if sel.clearance}
\\
\faLock\hspace{0.5em}\VAR{sel.clearance|tex}
\BLOCK{endif}
\end{center}

\BLOCK{for section in sel.sections}
\BLOCK{if section == "experience" and sel.employers}
%-----------EXPERIENCE-----------
\section{Experience}
  \resumeSubHeadingListStart
\BLOCK{for se in sel.employers}
\BLOCK{set first = se.roles[0]}
\BLOCK{set single = se.roles|length == 1}
    \resumeSubheading
      {\VAR{se.employer.name|tex}}{\VAR{se.employer.start|date} – \VAR{se.employer.end|date}}
      {\VAR{first.role.title|tex}}{\BLOCK{if not single}\VAR{first.role.start|date} – \VAR{first.role.end|date}\BLOCK{endif}}
\BLOCK{if first.bullets}
      \resumeItemListStart
\BLOCK{for b in first.bullets}
        \resumeItem{\VAR{b.text|tex}}
\BLOCK{endfor}
      \resumeItemListEnd
\BLOCK{endif}
\BLOCK{for sr in se.roles[1:]}

    \resumeSubSubheading
      {\VAR{sr.role.title|tex}}{\VAR{sr.role.start|date} – \VAR{sr.role.end|date}}
\BLOCK{if sr.bullets}
      \resumeItemListStart
\BLOCK{for b in sr.bullets}
        \resumeItem{\VAR{b.text|tex}}
\BLOCK{endfor}
      \resumeItemListEnd
\BLOCK{endif}
\BLOCK{endfor}

\BLOCK{endfor}
  \resumeSubHeadingListEnd

\BLOCK{elif section == "skills" and sel.skills}
%-----------TECHNICAL SKILLS-----------
\section{Technical Skills}
  \resumeSubHeadingListStart
    \resumeListicleStart
\BLOCK{for g in sel.skills}
      \resumeListicleItem{\VAR{g.name|tex}}{\VAR{g.items|map(attribute="text")|map("tex")|join(", ")}} \\
\BLOCK{endfor}
    \resumeListicleEnd
  \resumeSubHeadingListEnd

\BLOCK{elif section == "projects" and (sel.projects or sel.project_notes)}
%-----------PROJECTS-----------
\section{Projects}
  \resumeSubHeadingListStart
\BLOCK{if sel.projects}
    \resumeListicleStart
\BLOCK{for p in sel.projects}
      \resumeSideProjectListicleItem{\VAR{p.url}}{\BLOCK{if p.emoji}\VAR{p.emoji} \BLOCK{endif}\VAR{p.name|tex}}{\VAR{p.text|tex}}{\VAR{p.stack|map("tex")|join(", ")}} \\
\BLOCK{endfor}
    \resumeListicleEnd
\BLOCK{endif}
\BLOCK{for n in sel.project_notes}
    \resumeSubheadingNote{\VAR{n.text|tex}}
\BLOCK{endfor}
  \resumeSubHeadingListEnd

\BLOCK{elif section == "education" and sel.education}
%-----------EDUCATION-----------
\section{Education}
  \resumeSubHeadingListStart
\BLOCK{for x in sel.education}
    \resumeSubheading
      {\VAR{x.institution|tex}}{\VAR{x.location|tex}}
      {\VAR{x.degree|tex}}{\VAR{x.date|date}}
\BLOCK{endfor}
  \resumeSubHeadingListEnd

\BLOCK{elif section == "languages" and sel.languages}
%-----------LANGUAGES-----------
\section{Languages}
  \resumeSubHeadingListStart
    \resumeListicleStart
\BLOCK{for x in sel.languages}
      \resumeListicleItem{\VAR{x.name|tex}}{\VAR{x.level|tex}} \\
\BLOCK{endfor}
    \resumeListicleEnd
  \resumeSubHeadingListEnd

\BLOCK{endif}
\BLOCK{endfor}

\end{document}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_render.py -q`
Expected: all pass. If `test_single_role_employer_has_blank_role_dates` fails on whitespace inside the braces, adjust the test's expected string to match the template's exact output rather than adding whitespace handling to the template.

- [ ] **Step 6: Commit**

```bash
git add tunable/render.py templates tests/test_render.py
git commit -m "Add LaTeX renderer and template

Claude-Session: https://claude.ai/code/session_01TpGrt9ccJLFdFPpQEzqrbT"
```

---

### Task 7: Tuned profiles

**Files:**
- Create: `profiles/commercial-senior-swe.yaml`, `profiles/govtech-platform.yaml`
- Test: `tests/test_profiles.py`

**Interfaces:**
- Consumes: loaders, `select`.
- Produces: the two target profiles named in the spec. `tests/test_content.py::test_every_profile_loads` and `tests/test_sensitivity.py::test_every_profile_is_clean` pick them up automatically.

- [ ] **Step 1: Write the failing tests**

`tests/test_profiles.py`:
```python
from pathlib import Path
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


def test_tuned_profiles_have_leadership_in_each_agile_six_role():
    for name in ("commercial-senior-swe", "govtech-platform"):
        sel = _sel(name)
        agile_six = sel.employers[0]
        for sr in agile_six.roles:
            assert any("leadership" in b.tags for b in sr.bullets), f"{name}: {sr.role.id}"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_profiles.py -q`
Expected: FAIL, profile files missing.

- [ ] **Step 3: Write the profiles**

`profiles/commercial-senior-swe.yaml`:
```yaml
name: commercial-senior-swe
summary: commercial
clearance_line: false
email: auto
page_limit: 2
sections: [experience, skills, projects, education]
tags: [backend, platform, aws, kubernetes, terraform, serverless, node, typescript, rust,
       testing, ci-cd, security, observability, incident-response, cost, migration,
       architecture, ownership, leadership, mentoring, cross-team, macos]
caps:
  default: 5
  roles: {cie: 7, cms-tl: 4, cms-sse: 5, ain: 4, devon: 2}
  projects: 6
include: []
exclude: []
require:
  - {tag: leadership, min: 1, roles: [cie, cms-tl, cms-sse]}
```

`profiles/govtech-platform.yaml`:
```yaml
name: govtech-platform
summary: commercial
clearance_line: true
email: auto
page_limit: 2
sections: [experience, skills, projects, education]
tags: [backend, platform, aws, kubernetes, terraform, serverless, drupal, php, node, typescript,
       testing, ci-cd, security, observability, incident-response, cost, migration,
       architecture, ownership, leadership, mentoring, documentation, cross-team,
       federal, ato, fedramp, govcloud, healthcare]
caps:
  default: 5
  roles: {cie: 7, cms-tl: 4, cms-sse: 5, ain: 4, devon: 2}
  projects: 6
include: []
exclude: []
require:
  - {tag: leadership, min: 1, roles: [cie, cms-tl, cms-sse]}
```

Note: with today's transcribed content, role `cie` has no leadership-tagged bullet, so `test_tuned_profiles_have_leadership_in_each_agile_six_role` will fail for `cie`. That is correct and expected: it is the content plan's job to add one. Mark that single assertion with `pytest.mark.xfail(strict=True, reason="cie leadership bullet arrives with the content rewrite")` by splitting the test into a parametrized version over role ids and marking only `cie`:

```python
import pytest

@pytest.mark.parametrize("name", ["commercial-senior-swe", "govtech-platform"])
@pytest.mark.parametrize("role_id", [
    pytest.param("cie", marks=pytest.mark.xfail(strict=True, reason="cie leadership bullet arrives with the content rewrite")),
    "cms-tl", "cms-sse",
])
def test_tuned_profiles_have_leadership_in_each_agile_six_role(name, role_id):
    sel = _sel(name)
    roles = {sr.role.id: sr for sr in sel.employers[0].roles}
    assert any("leadership" in b.tags for b in roles[role_id].bullets)
```

Use this parametrized form instead of the loop version above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest -q`
Expected: all pass, with the two `cie` cases reported as xfail.

- [ ] **Step 5: Commit**

```bash
git add profiles tests/test_profiles.py
git commit -m "Add commercial and govtech profiles

Claude-Session: https://claude.ai/code/session_01TpGrt9ccJLFdFPpQEzqrbT"
```

---

### Task 8: PDF driver and CLI

**Files:**
- Create: `tunable/pdf.py`, `build.py`
- Test: `tests/test_pdf.py`, `tests/test_build.py`

**Interfaces:**
- Consumes: everything above.
- Produces: `tunable.pdf.have_lualatex() -> bool`; `tunable.pdf.compile(tex_path: Path, out_dir: Path) -> Path`; `tunable.pdf.to_text(pdf: Path, txt: Path) -> None`; `tunable.pdf.page_count(pdf: Path) -> int`; `build.py` CLI with `--profile`, `--all`, `--email`, `--no-pdf`, `--out`; `build.build(profile_name, *, root, out_dir, email=None, pdf=True) -> Path`.

- [ ] **Step 1: Write the failing tests**

`tests/test_pdf.py`:
```python
from pathlib import Path
import pytest
from tunable import pdf

MINIMAL_TEX = r"""
\documentclass{article}
\begin{document}
Hello. \newpage Second page.
\end{document}
"""


def test_have_lualatex_is_bool():
    assert isinstance(pdf.have_lualatex(), bool)


@pytest.mark.skipif(not pdf.have_lualatex(), reason="lualatex not installed")
def test_compile_and_count_pages(tmp_path: Path):
    tex = tmp_path / "min.tex"
    tex.write_text(MINIMAL_TEX)
    out = pdf.compile(tex, tmp_path / "out")
    assert out.exists() and out.suffix == ".pdf"
    assert pdf.page_count(out) == 2
    txt = tmp_path / "min.txt"
    pdf.to_text(out, txt)
    assert "Hello" in txt.read_text()
```

`tests/test_build.py`:
```python
from pathlib import Path
import subprocess
import sys
import pytest
from tunable import pdf
from tunable.loader import load_content, load_profile
import build as build_mod

ROOT = Path(__file__).resolve().parent.parent
PROFILES = sorted(p.stem for p in (ROOT / "profiles").glob("*.yaml"))


@pytest.mark.parametrize("name", PROFILES)
def test_render_only(tmp_path: Path, name):
    tex = build_mod.build(name, root=ROOT, out_dir=tmp_path, pdf=False)
    assert tex.name == f"resume-{name}.tex"
    assert r"\end{document}" in tex.read_text()


def test_email_override(tmp_path: Path):
    tex = build_mod.build("master", root=ROOT, out_dir=tmp_path, email="me@example.com", pdf=False)
    assert "me@example.com" in tex.read_text()


def test_auto_email_is_stable(tmp_path: Path):
    a = build_mod.build("master", root=ROOT, out_dir=tmp_path / "a", pdf=False).read_text()
    b = build_mod.build("master", root=ROOT, out_dir=tmp_path / "b", pdf=False).read_text()
    assert a == b
    assert "@tenesm.us" in a


def test_cli_reports_validation_errors(tmp_path: Path):
    bad = tmp_path / "profiles"
    bad.mkdir()
    (bad / "broken.yaml").write_text("name: broken\nsummary: nope\nclearance_line: false\nemail: auto\nsections: [experience]\n")
    for name in ("content", "templates", "resume.yaml"):
        target = tmp_path / name
        src = ROOT / name
        if src.is_dir():
            import shutil
            shutil.copytree(src, target)
        else:
            target.write_text(src.read_text())
    r = subprocess.run([sys.executable, str(ROOT / "build.py"), "--profile", "broken", "--no-pdf", "--root", str(tmp_path)],
                       capture_output=True, text=True)
    assert r.returncode == 1
    assert "unknown summary variant 'nope'" in r.stderr


@pytest.mark.skipif(not pdf.have_lualatex(), reason="lualatex not installed")
@pytest.mark.parametrize("name", PROFILES)
def test_page_budget(tmp_path: Path, name):
    content = load_content(ROOT / "content")
    profile = load_profile(ROOT / "profiles" / f"{name}.yaml", content)
    if profile.page_limit is None:
        pytest.skip("no page limit")
    tex = build_mod.build(name, root=ROOT, out_dir=tmp_path, pdf=True)
    out = tmp_path / f"resume-{name}.pdf"
    assert out.exists()
    assert pdf.page_count(out) <= profile.page_limit
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_pdf.py tests/test_build.py -q`
Expected: ImportError.

- [ ] **Step 3: Write the PDF driver**

`tunable/pdf.py`:
```python
"""Drive lualatex and pdftotext. Everything here shells out; keep it thin."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def have_lualatex() -> bool:
    return shutil.which("lualatex") is not None


def compile(tex_path: Path, out_dir: Path) -> Path:
    """Run lualatex twice (for cross-references) and return the PDF path."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = ["lualatex", "-interaction=nonstopmode", "-halt-on-error",
           f"-output-directory={out_dir}", str(tex_path)]
    for _ in range(2):
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=tex_path.parent)
        if r.returncode != 0:
            log = out_dir / f"{tex_path.stem}.log"
            tail = log.read_text(errors="replace")[-3000:] if log.exists() else r.stdout[-3000:]
            raise RuntimeError(f"lualatex failed for {tex_path.name}:\n{tail}")
    return out_dir / f"{tex_path.stem}.pdf"


def to_text(pdf: Path, txt: Path) -> None:
    subprocess.run(["pdftotext", "-raw", str(pdf), str(txt)], check=True)


def page_count(pdf: Path) -> int:
    from pypdf import PdfReader
    return len(PdfReader(str(pdf)).pages)
```

- [ ] **Step 4: Write the CLI**

`build.py`:
```python
#!/usr/bin/env python3
"""Render one or all résumé profiles.

  python build.py --profile commercial-senior-swe [--email ADDR] [--no-pdf]
  python build.py --all
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from tunable import pdf as pdfmod
from tunable.emailgen import address, load_words
from tunable.loader import ContentError, load_config, load_content, load_profile
from tunable.render import render
from tunable.select import select

ROOT = Path(__file__).resolve().parent


def build(profile_name: str, *, root: Path = ROOT, out_dir: Path | None = None,
          email: str | None = None, pdf: bool = True) -> Path:
    """Render a profile. Returns the .tex path; the PDF and .txt sit beside it in out_dir."""
    out_dir = out_dir or root / "dist"
    build_dir = root / "build"
    config = load_config(root / "resume.yaml")
    content = load_content(root / "content")
    profile = load_profile(root / "profiles" / f"{profile_name}.yaml", content)

    if email is None:
        if profile.email == "auto":
            email = address(profile.name, config.email_domain, load_words(root / "content" / "words.txt"))
        else:
            email = profile.email

    source = render(select(content, profile), config, email, root / "templates")
    out_dir.mkdir(parents=True, exist_ok=True)
    tex_path = out_dir / f"resume-{profile.name}.tex"
    tex_path.write_text(source)

    if pdf:
        built = pdfmod.compile(tex_path, build_dir)
        final = out_dir / built.name
        shutil.copyfile(built, final)
        pdfmod.to_text(final, final.with_suffix(".txt"))
        if profile.name == config.default_profile:
            shutil.copyfile(final, out_dir / "resume.pdf")
            shutil.copyfile(final.with_suffix(".txt"), out_dir / "resume.txt")
    return tex_path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--profile", help="profile name (profiles/<name>.yaml)")
    g.add_argument("--all", action="store_true", help="build every profile")
    ap.add_argument("--email", help="override the rendered email address")
    ap.add_argument("--no-pdf", action="store_true", help="render .tex only")
    ap.add_argument("--out", type=Path, help="output directory (default: dist/)")
    ap.add_argument("--root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

    names = sorted(p.stem for p in (args.root / "profiles").glob("*.yaml")) if args.all else [args.profile]
    try:
        for name in names:
            path = build(name, root=args.root, out_dir=args.out, email=args.email, pdf=not args.no_pdf)
            print(f"built {name}: {path}" + ("" if args.no_pdf else f", {path.with_suffix('.pdf')}"))
    except (ContentError, RuntimeError, FileNotFoundError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest -q`
Expected: all pass (PDF tests run locally since lualatex is installed).

- [ ] **Step 6: Compare the generated master against today's résumé**

Run:
```bash
python build.py --profile master --out dist
diff <(tr -s ' \n' '\n' < resume.txt | sort) <(tr -s ' \n' '\n' < dist/resume-master.txt | sort) | head -40
```
Expected: differences limited to the email address, the LaTeX logo ("LaTeX" vs the split "L A TEX"), and bullet ordering within roles (master sorts by weight). Any other difference is a transcription error in Task 2: fix the YAML, not the template.

Then open `dist/resume-master.pdf` and confirm it looks like `resume.pdf`.

- [ ] **Step 7: Commit**

```bash
git add tunable/pdf.py build.py tests/test_pdf.py tests/test_build.py
git commit -m "Add PDF driver and build CLI

Claude-Session: https://claude.ai/code/session_01TpGrt9ccJLFdFPpQEzqrbT"
```

---

### Task 9: CI workflow

**Files:**
- Modify: `.github/workflows/continuous_delivery.yaml` (replace contents)

**Interfaces:**
- Consumes: `make test`, `python build.py --all`.

- [ ] **Step 1: Replace the workflow**

`.github/workflows/continuous_delivery.yaml`:
```yaml
name: Build and Deploy

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: 'continuous_deployment-${{ github.ref }}'
  cancel-in-progress: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - name: Set up Python
        uses: actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065 # v5.6.0
        with:
          python-version: '3.12'
      - name: Install dependencies
        run: pip install -r requirements.txt
      - name: Test (no TeX; page-budget tests skip)
        run: make test

  build:
    needs: test
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    container:
      image: texlive/texlive:latest
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - name: Install system dependencies
        run: |
          apt-get update
          apt-get install -y --no-install-recommends python3 python3-pip python3-venv poppler-utils fonts-noto-color-emoji
          luaotfload-tool --update
      - name: Install Python dependencies
        run: |
          python3 -m venv .venv
          .venv/bin/pip install -r requirements.txt
      - name: Test with TeX (page budgets enforced)
        run: .venv/bin/python -m pytest -q
      - name: Build every profile
        run: .venv/bin/python build.py --all
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b # v4.0.0
        with:
          path: dist
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e # v4.0.5
```

Verify the `setup-python` SHA before committing: `gh api repos/actions/setup-python/git/ref/tags/v5.6.0 --jq .object.sha` (if it is a tag object, follow it with `gh api repos/actions/setup-python/git/tags/<sha> --jq .object.sha`). Replace the SHA above with the verified one.

- [ ] **Step 2: Validate the workflow file**

Run: `yq '.jobs | keys' .github/workflows/continuous_delivery.yaml` and, if installed, `actionlint`.
Expected: `- build` and `- test`; no actionlint errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/continuous_delivery.yaml
git commit -m "Build every profile in CI and publish dist/

Claude-Session: https://claude.ai/code/session_01TpGrt9ccJLFdFPpQEzqrbT"
```

- [ ] **Step 4: After the branch merges, watch the first main build**

Run: `gh run watch` on the first push to main. If the build job fails in `luaotfload-tool` or on the emoji fallback, apply the spec's fallback: add `emoji: true` to `Profile` (default true, loader reads `raw.get("emoji", True)`), wrap the `\BLOCK{if p.emoji}` in the template with `and sel.emoji`, thread `emoji` through `Selection`, set it false in the two tuned profiles, and drop the `\directlua` fallback block from the template when emoji is off. Record what happened in the commit message.

---

### Task 10: Remove legacy files and rewrite the README

**Files:**
- Delete: `resume.tex`, `resume.pdf`, `resume.txt`, `resume.aux`, `resume.log`, `resume.out`, `generate_resume.sh`
- Modify: `README.md`

- [ ] **Step 1: Confirm the generator reproduces today's document**

Run: `python build.py --all && ls dist/`
Expected: `resume-master.pdf`, `resume-commercial-senior-swe.pdf`, `resume-govtech-platform.pdf`, `resume.pdf`, matching `.tex` and `.txt` files.

- [ ] **Step 2: Remove the legacy files**

```bash
git rm resume.tex resume.pdf resume.txt generate_resume.sh
git rm --cached resume.aux resume.log resume.out 2>/dev/null; rm -f resume.aux resume.log resume.out
```

- [ ] **Step 3: Rewrite the README**

`README.md`:
```markdown
# Nug Doug's Tunable Résumé

My résumé as a content database plus profiles, rendered to LaTeX and PDF.
Every bullet carries tags, a weight, and an evidence pointer; a profile picks
which bullets appear for a given kind of job.

The general-purpose PDF is published at
https://ndouglas.github.io/resume/resume.pdf. Other profiles are alongside it
as `resume-<profile>.pdf`.

## Layout

- `content/` — the bullets, projects, skills, summaries, and tag vocabulary
- `profiles/` — one YAML file per target; `master.yaml` selects everything
- `templates/resume.tex.j2` — the LaTeX template
- `tunable/` — loader, selection, rendering, PDF driver
- `build.py` — the CLI

## Usage

    python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
    make test                         # validate content and profiles
    make build PROFILE=master         # render one profile into dist/
    make build-all                    # render every profile
    python build.py --profile commercial-senior-swe --email me@example.com

Rendering a PDF needs `lualatex` (TeX Live) and `pdftotext` (poppler).
Without them, `--no-pdf` renders the `.tex` only and the page-budget tests
skip.

## Adding a profile

Copy an existing file in `profiles/`, change `name` to match the filename,
adjust `tags`, `caps`, `include`, and `exclude`. Selection is deliberate and
boring: keep bullets sharing a tag with the profile, sort by shared tags then
weight, enforce any `require` minimums, cut at the cap. `exclude` beats
`include` beats tags.

## Design

See `docs/superpowers/specs/2026-09-11-tunable-resume-design.md`.

![How a Programmer Reads Your Résumé](./images/resume_comic.png)
Credit: [Steve Hanov](http://stevehanov.ca/blog/index.php?id=56).
```

- [ ] **Step 4: Run the full suite one last time**

Run: `make test && make build-all`
Expected: all tests pass; `dist/` populated.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Remove hand-edited résumé sources; document the generator

Claude-Session: https://claude.ai/code/session_01TpGrt9ccJLFdFPpQEzqrbT"
```

---

## Self-review against the spec

- §4 layout: Tasks 1, 2, 6, 8, 10. Covered.
- §5 data model: Task 1 (model, loader), Task 2 (real content). `location` optional, role ids, tag vocabulary, summary variants, profile schema with `require`. Covered.
- §6 selection: Task 3, including exclude > include > tags, sort order, `require` promotion, caps. Covered.
- §7 generator: Task 8 (CLI flags, dist/build dirs, default-profile alias), Task 6 (delimiters, escaper), Task 5 (email). Covered.
- §8 tests: schema (Task 1), profiles (Task 1, 2), selection (Task 3), sensitivity (Task 4), render (Task 6), page budget (Task 8). Covered.
- §9 CI: Task 9, including the emoji fallback path. Covered.
- §10 content plan and §12 stages 2–3: deliberately out of this plan; a separate content plan follows.
- §12 stage 4: Task 10. Covered.
- Type consistency: `Selection` fields used in the template match `select.py`; `build()` signature matches its tests; `pdf.compile`/`to_text`/`page_count` names match across Task 8 files; `Caps.projects` used for projects, `Caps.default` for notes.
