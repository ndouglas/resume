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
    protected: set[str] = set()
    for req in profile.require:
        if role_id is None or role_id not in req.roles:
            continue
        have = [i for i in chosen if req.tag in i.tags]
        needed = [i for i in ranked if req.tag in i.tags and i not in chosen][: max(0, req.min - len(have))]
        for item in needed:
            victims = [i for i in reversed(chosen) if req.tag not in i.tags and i.id not in protected]
            if not victims:
                break
            chosen.remove(victims[0])
            chosen.append(item)
        protected.update(i.id for i in chosen if req.tag in i.tags)
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
