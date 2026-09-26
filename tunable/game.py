"""Export résumé content plus the game design to game-data.json.

The game in game/ is static: an HTML shell and plain ES modules. Its data is
generated here from the same validated content the PDF uses, so editing a
bullet updates the game on the next build. validate() is the contract between
design.yaml and content/: cited ids exist, every tag does something, and the
sensitivity rule holds for game text too.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import yaml

from tunable.emailgen import load_words, resolve
from tunable.loader import ContentError, load_config, load_content, load_profile
from tunable.model import Content
from tunable.sensitivity import violations

PDF_URL = "https://ndouglas.github.io/resume/resume.pdf"
TRAITS = {"split", "trace", "pierce", "noFalloff", "security", "pin", "cache", "heavy", "homing", "matrix"}
BONUSES = {"copiesInherit", "shatter", "autoTarget", "evenSplit", "cacheAlways", "traceArea"}
ENEMY_IDS = {"request", "flaky", "silent", "credential", "idle", "deadlock", "dependency", "skipped", "module"}
BOSS_IDS = {"sync-conflict", "managed-host-invoice", "drupal-upgrade", "hard-cutover"}
STAGE_NUMBERS = ("duration", "speed", "hpScale", "spawnEvery", "rowMin", "rowMax")
SHIP_EXCLUDE = {"design.yaml", "test", "package.json"}


def load_design(path: Path) -> dict:
    return yaml.safe_load(path.read_text()) or {}


def _strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield str(k)
            yield from _strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from _strings(v)


def validate(design: dict, content: Content) -> list[str]:
    errors: list[str] = []
    items = content.item_ids()
    roles = content.role_ids()
    mods = design.get("mods") or {}
    effects = design.get("tag_effects") or {}
    balls = {b.get("id"): b for b in design.get("balls") or []}
    enemies = design.get("enemies") or {}
    bosses = {b.get("id"): b for b in design.get("bosses") or []}

    def check_cites(where: str, entry: dict) -> None:
        cites = entry.get("cites")
        if not cites:
            errors.append(f"{where}: cites is required")
        for c in cites or []:
            if c not in items:
                errors.append(f"{where}: cites unknown id '{c}'")

    for tag in content.tags:
        if tag not in effects:
            errors.append(f"tag_effects: no entry for tag '{tag}'")
    for tag, eff in effects.items():
        if tag not in content.tags:
            errors.append(f"tag_effects: unknown tag '{tag}'")
        for mod in eff or {}:
            if mod not in mods:
                errors.append(f"tag_effects.{tag}: unknown mod '{mod}'")

    for bid, b in balls.items():
        for t in b.get("traits") or []:
            if t not in TRAITS:
                errors.append(f"balls.{bid}: unknown trait '{t}'")
    if sum(1 for b in balls.values() if b.get("start")) != 1:
        errors.append("balls: exactly one ball must have start: true")

    for f in design.get("fusions") or []:
        where = f"fusions.{f.get('id')}"
        check_cites(where, f)
        if f.get("bonus") not in BONUSES:
            errors.append(f"{where}: unknown bonus '{f.get('bonus')}'")
        parts = f.get("parts") or []
        if len(parts) != 2 or any(p not in balls for p in parts):
            errors.append(f"{where}: parts must name two balls")

    if set(enemies) != ENEMY_IDS:
        errors.append(f"enemies: expected exactly {sorted(ENEMY_IDS)}")
    for eid, e in enemies.items():
        check_cites(f"enemies.{eid}", e)
    if set(bosses) != BOSS_IDS:
        errors.append(f"bosses: expected exactly {sorted(BOSS_IDS)}")
    for bid, b in bosses.items():
        check_cites(f"bosses.{bid}", b)

    for s in design.get("stages") or []:
        where = f"stages.{s.get('id')}"
        if not s.get("roles"):
            errors.append(f"{where}: roles is required")
        for r in s.get("roles") or []:
            if r not in roles:
                errors.append(f"{where}: unknown role '{r}'")
        if s.get("boss") not in bosses:
            errors.append(f"{where}: unknown boss '{s.get('boss')}'")
        for k in s.get("mix") or {}:
            if k not in enemies:
                errors.append(f"{where}: unknown enemy '{k}' in mix")
        for k in STAGE_NUMBERS:
            if not isinstance(s.get(k), (int, float)):
                errors.append(f"{where}: {k} must be a number")

    for text in _strings(design):
        for v in violations(text):
            errors.append(f"design.yaml: {v}")
    return errors


def export(root: Path) -> dict:
    content = load_content(root / "content")
    design = load_design(root / "game" / "design.yaml")
    errors = validate(design, content)
    if errors:
        raise ContentError("game/design.yaml:\n  " + "\n  ".join(errors))
    config = load_config(root / "resume.yaml")
    profile = load_profile(root / "profiles" / f"{config.default_profile}.yaml", content)
    email = resolve(profile.email, profile.name, config.email_domain, load_words(root / "content" / "words.txt"))
    summary = content.summaries.get("commercial") or next(iter(content.summaries.values()))
    return {
        "person": {
            "name": config.name, "email": email, "website": config.website,
            "github": config.github, "linkedin": config.linkedin,
            "summary": summary, "pdf": PDF_URL,
        },
        "roles": [
            {"id": r.id, "title": r.title, "employer": e.name, "start": r.start, "end": r.end,
             "bullets": [{"id": b.id, "text": b.text, "tags": list(b.tags), "weight": b.weight, "alt": b.alt}
                         for b in r.bullets]}
            for e in content.employers for r in e.roles
        ],
        "projects": [{"id": p.id, "name": p.name, "emoji": p.emoji, "text": p.text, "url": p.url}
                     for p in content.projects],
        "design": design,
    }


def write(root: Path, out_dir: Path) -> Path:
    """Copy the game's runtime files to out_dir/game and write game-data.json beside them."""
    data = export(root)
    src = (root / "game").resolve()
    dest = out_dir / "game"
    if dest.exists():
        shutil.rmtree(dest)

    def ignore(directory: str, names: list[str]) -> list[str]:
        return [n for n in names if Path(directory).resolve() == src and n in SHIP_EXCLUDE]

    shutil.copytree(src, dest, ignore=ignore)
    (dest / "game-data.json").write_text(json.dumps(data, ensure_ascii=False, indent=1))
    return dest
