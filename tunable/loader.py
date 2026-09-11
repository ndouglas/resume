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
    return Bullet(bid, text, _tags(raw.get("tags"), f"{where} ({bid})", vocab, errors), weight, evidence,
                  str(raw.get("alt") or ""))


def _int(raw, where: str, errors: _Errors, default: int | None) -> int | None:
    try:
        return int(raw)
    except (TypeError, ValueError):
        errors.add(f"{where} must be an integer")
        return default


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
        if not roles:
            errors.add(f"{where} must have at least one role")
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
    role_caps = {
        str(k): _int(v, f"{where}: cap for role '{k}'", errors, 0)
        for k, v in (caps_raw.get("roles") or {}).items()
    }
    for r in role_caps:
        if r not in role_ids:
            errors.add(f"{where}: unknown role id '{r}' in caps")
    default_cap_raw = caps_raw.get("default")
    default_cap = (
        _int(default_cap_raw, f"{where}: caps.default", errors, None)
        if default_cap_raw is not None else None
    )
    projects_cap_raw = caps_raw.get("projects")
    projects_cap = (
        _int(projects_cap_raw, f"{where}: caps.projects", errors, None)
        if projects_cap_raw is not None else None
    )
    caps = Caps(default_cap, role_caps, projects_cap)

    require: list[Require] = []
    for q in raw.get("require") or []:
        tag = str(q.get("tag", ""))
        if tag not in content.tags:
            errors.add(f"{where}: unknown tag '{tag}' in require")
        roles = tuple(str(r) for r in q.get("roles") or [])
        for r in roles:
            if r not in role_ids:
                errors.add(f"{where}: unknown role id '{r}' in require")
        min_ = _int(q.get("min", 1), f"{where}: min for tag '{tag}'", errors, 1)
        require.append(Require(tag, min_, roles))

    page_limit_raw = raw.get("page_limit")
    page_limit = (
        _int(page_limit_raw, f"{where}: page_limit", errors, None)
        if page_limit_raw is not None else None
    )
    errors.raise_if_any()
    return Profile(name, summary, bool(raw.get("clearance_line", False)), str(raw.get("email", "auto")),
                   page_limit, sections, tags, caps,
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
