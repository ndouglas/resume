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
