# Error Budget (Résumé Roguelike) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Ball x Pit–style browser roguelike, "Error Budget", generated from `content/` and published at `ndouglas.github.io/resume/game/` beside the PDF.

**Architecture:** `tunable/game.py` validates a hand-authored `game/design.yaml` against the content database and exports `game-data.json`. The game is plain ES modules: pure simulation modules (`world`, `rng`, `physics`, `balls`, `fusion`, `enemies`, `stages`, `bosses`, `cards`, `postmortem`, `engine`) that never touch the DOM, plus `render.js`, `ui.js`, `main.js` for the browser. A headless Node simulation, driven from pytest, proves a run is winnable and losable.

**Tech Stack:** Python 3.12 + PyYAML + pytest (existing); vanilla JavaScript ES modules, Canvas 2D, `node --test` (Node ≥ 20, no npm dependencies).

**Spec:** `docs/superpowers/specs/2026-09-25-resume-roguelike-design.md`

## Global Constraints

- Bullet text appears verbatim; every enemy, boss, and fusion `cites` an existing bullet or project id (build fails otherwise).
- Every string in `game/design.yaml` passes `tunable.sensitivity.violations` (no dollar amounts, outage durations, people counts, blame).
- No npm dependencies, no bundler, no CDN scripts. Plain ES modules and Canvas 2D.
- Pure modules (`game/src/*.js` except `render.js`, `ui.js`, `main.js`) must not reference `window`, `document`, or canvas.
- Every tag in `content/tags.yaml` has an entry in `design.yaml` `tag_effects`.
- `dist/game/` ships runtime files only: never `design.yaml`, `test/`, or `package.json`.
- `localStorage` access is wrapped in try/catch; the game works without it.
- Runs take 5–8 minutes for the scripted bot (asserted as 240–720 s simulated).
- Commit messages end with `Claude-Session: https://claude.ai/code/session_019Gn4ESpBQMBXM6ugLwTT3t`.

## Review Focus

1. **Private browsing / blocked storage** — `localStorage` throws or is null; the game must still start and end normally. Test: `postmortem.test.js` "best-run storage survives a throwing storage" (Task 6).
2. **A ball that never comes back** — a slotted ball bouncing indefinitely would permanently remove a slot. Expected: after its 20 s ttl it is released and the slot refills. Test: `engine.test.js` "an expired slotted ball frees its slot" (Task 7).
3. **Card pool exhaustion** — a long run that has picked every bullet with every tool maxed must not hang on an empty level-up. Test: `cards.test.js` "exhausted pools yield no cards" and `engine.test.js` "a level-up with nothing to offer does not pause" (Tasks 6, 7).
4. **Content edits break the design** — renaming a bullet the game cites must fail the build with a message naming the file and id. Test: `test_game.py::test_unknown_cite_is_reported` (Task 1).
5. **Opened without a server / data fails to load** — `file://` or a 404 on `game-data.json` must still leave the visitor a link to the PDF. Checked manually in Task 9 Step 7 (static fallback text in `index.html` plus `ui.showError`).

---

### Task 1: Game design file, validator, exporter, and `build.py --game`

**Files:**
- Modify: `tunable/emailgen.py` (add `resolve`)
- Modify: `build.py` (use `resolve`; add `--game`; `--all` also builds the game)
- Create: `game/design.yaml`
- Create: `tunable/game.py`
- Create: `tests/test_game.py`
- Modify: `docs/superpowers/specs/2026-09-25-resume-roguelike-design.md` (record decisions made while planning)

**Interfaces:**
- Produces: `tunable.game.load_design(path) -> dict`, `validate(design, content) -> list[str]`, `export(root) -> dict`, `write(root, out_dir) -> Path` (returns `out_dir/"game"`), constants `PDF_URL`, `TRAITS`, `BONUSES`, `ENEMY_IDS`, `BOSS_IDS`.
- Produces: `game-data.json` shape consumed by every JS task:
  ```
  { person: {name, email, website, github, linkedin, summary, pdf},
    roles: [{id, title, employer, start, end, bullets: [{id, text, tags, weight, alt}]}],
    projects: [{id, name, emoji, text, url}],
    design: <design.yaml as-is> }
  ```
- Produces: `tunable.emailgen.resolve(profile_email, profile_name, domain, words) -> str`.

- [ ] **Step 1: Write the failing tests**

`tests/test_game.py`:

```python
from pathlib import Path
import json
import shutil

import pytest

import build as build_mod
from tunable import game
from tunable.emailgen import resolve
from tunable.loader import ContentError, load_content

ROOT = Path(__file__).resolve().parent.parent


def real():
    return game.load_design(ROOT / "game" / "design.yaml"), load_content(ROOT / "content")


def test_real_design_is_valid():
    design, content = real()
    assert game.validate(design, content) == []


def test_every_content_tag_has_an_effect():
    design, content = real()
    assert set(content.tags) <= set(design["tag_effects"])


def test_unknown_cite_is_reported():
    design, content = real()
    design["enemies"]["request"]["cites"] = ["no-such-bullet"]
    assert "enemies.request: cites unknown id 'no-such-bullet'" in game.validate(design, content)


def test_missing_tag_effect_is_reported():
    design, content = real()
    del design["tag_effects"]["testing"]
    assert "tag_effects: no entry for tag 'testing'" in game.validate(design, content)


def test_unknown_role_trait_and_mod_are_reported():
    design, content = real()
    design["stages"][0]["roles"] = ["nope"]
    design["balls"][1]["traits"] = ["laser"]
    design["tag_effects"]["testing"] = {"luck": 1}
    errors = game.validate(design, content)
    assert any("unknown role 'nope'" in e for e in errors)
    assert any("unknown trait 'laser'" in e for e in errors)
    assert any("unknown mod 'luck'" in e for e in errors)


def test_sensitive_design_text_is_reported():
    design, content = real()
    design["bosses"][0]["blurb"] = "Cost $5,000 a month"
    assert any(e.startswith("design.yaml: dollar amount") for e in game.validate(design, content))


def test_export_shape():
    data = game.export(ROOT)
    assert set(data) == {"person", "roles", "projects", "design"}
    assert data["person"]["pdf"] == game.PDF_URL
    assert [r["id"] for r in data["roles"]] == ["cie", "cms-tl", "cms-sse", "ain", "devon"]
    assert all(b["text"] for r in data["roles"] for b in r["bullets"])
    json.dumps(data)


def test_export_email_matches_default_profile_pdf(tmp_path: Path):
    tex = build_mod.build("commercial-senior-swe", root=ROOT, out_dir=tmp_path, pdf=False).read_text()
    assert game.export(ROOT)["person"]["email"] in tex


def test_export_refuses_invalid_design(tmp_path: Path):
    root = _scratch_root(tmp_path)
    text = (root / "game" / "design.yaml").read_text().replace("cites: [cie-cost]", "cites: [gone]")
    (root / "game" / "design.yaml").write_text(text)
    with pytest.raises(ContentError, match="cites unknown id 'gone'"):
        game.export(root)


def test_write_ships_runtime_files_only(tmp_path: Path):
    root = _scratch_root(tmp_path)
    dest = game.write(root, tmp_path / "out")
    assert dest == tmp_path / "out" / "game"
    assert (dest / "index.html").is_file()
    assert (dest / "src" / "main.js").is_file()
    assert json.loads((dest / "game-data.json").read_text())["person"]["name"]
    for gone in ("design.yaml", "test", "package.json"):
        assert not (dest / gone).exists(), gone


def test_write_replaces_a_stale_build(tmp_path: Path):
    root = _scratch_root(tmp_path)
    stale = tmp_path / "out" / "game" / "old.js"
    stale.parent.mkdir(parents=True)
    stale.write_text("")
    game.write(root, tmp_path / "out")
    assert not stale.exists()


def test_cli_game_flag(tmp_path: Path):
    assert build_mod.main(["--game", "--out", str(tmp_path)]) == 0
    assert (tmp_path / "game" / "game-data.json").is_file()


def test_resolve_email():
    words = ["alpha", "bravo", "charlie"]
    assert resolve("me@example.com", "x", "d.net", words) == "me@example.com"
    assert resolve("auto", "x", "d.net", words).endswith("@d.net")


def _scratch_root(tmp_path: Path) -> Path:
    root = tmp_path / "root"
    for name in ("content", "profiles"):
        shutil.copytree(ROOT / name, root / name)
    shutil.copyfile(ROOT / "resume.yaml", root / "resume.yaml")
    g = root / "game"
    (g / "src").mkdir(parents=True)
    (g / "test").mkdir()
    shutil.copyfile(ROOT / "game" / "design.yaml", g / "design.yaml")
    (g / "index.html").write_text("<!doctype html>")
    (g / "src" / "main.js").write_text("")
    (g / "test" / "a.test.js").write_text("")
    (g / "package.json").write_text("{}")
    return root
```

- [ ] **Step 2: Run to verify they fail**

Run: `python3 -m pytest tests/test_game.py -q`
Expected: collection error `ModuleNotFoundError: No module named 'tunable.game'`.

- [ ] **Step 3: Add `resolve` to `tunable/emailgen.py`** (append):

```python
def resolve(profile_email: str, profile_name: str, domain: str, words: list[str]) -> str:
    """A profile's rendered address: its literal email, or the derived one for "auto"."""
    return address(profile_name, domain, words) if profile_email == "auto" else profile_email
```

- [ ] **Step 4: Write `game/design.yaml`**

```yaml
# Game design for Error Budget, the résumé roguelike.
#
# Every enemy, boss, and fusion cites the bullet or project it is drawn from;
# the build fails if a cited id does not exist. Every string here passes the
# sensitivity lint. Every tag in content/tags.yaml needs a tag_effects entry.
# Balance numbers are tuned against the headless simulation (tests/test_game.py).

mods:
  fireRate:    {label: deploy frequency, format: pct}
  regen:       {label: budget regen (MTTR), format: rate}
  reveal:      {label: monitoring coverage, format: px}
  armorPierce: {label: armor piercing, format: pct}
  testDmg:     {label: damage vs flaky and skipped, format: pct}
  bossDmg:     {label: boss damage, format: pct}
  xpGain:      {label: XP gain, format: pct}
  maxBudget:   {label: max error budget, format: num}
  teammates:   {label: teammates, format: frac}
  fusionEarly: {label: fusion readiness, format: frac}
  ballCount:   {label: ball copies, format: frac}
  damage:      {label: damage, format: pct}
  crossTeam:   {label: bounce speed-up, format: pct}
  tracedBonus: {label: traced damage, format: pct}
  docs:        {label: full postmortem timeline, format: flag}

# Effect per point of bullet weight. A weight-5 ci-cd bullet gives +25% fire rate.
tag_effects:
  ci-cd:             {fireRate: 0.05}
  incident-response: {regen: 0.012}
  observability:     {reveal: 12, tracedBonus: 0.04}
  security:          {armorPierce: 0.04}
  testing:           {testDmg: 0.1}
  migration:         {bossDmg: 0.06}
  cost:              {xpGain: 0.06}
  ownership:         {maxBudget: 0.6}
  mentoring:         {teammates: 0.12}
  leadership:        {teammates: 0.1}
  architecture:      {fusionEarly: 0.1}
  platform:          {ballCount: 0.1}
  terraform:         {ballCount: 0.08}
  cross-team:        {crossTeam: 0.02}
  documentation:     {docs: 1, regen: 0.004}
  backend:           {damage: 0.03}
  serverless:        {damage: 0.03}
  aws:               {damage: 0.03}
  kubernetes:        {damage: 0.03}
  node:              {damage: 0.03}
  typescript:        {damage: 0.03}
  php:               {damage: 0.03}
  drupal:            {damage: 0.03}
  rust:              {damage: 0.03}
  macos:             {damage: 0.03}
  federal:           {damage: 0.02}
  ato:               {damage: 0.02}
  fedramp:           {damage: 0.02}
  govcloud:          {damage: 0.02}
  healthcare:        {damage: 0.02}
  open-source:       {damage: 0.02}
  ml:                {damage: 0.02}
  research:          {damage: 0.02}
  core:              {damage: 0.02}

balls:
  - id: bash
    name: Bash
    color: "#c9d1d9"
    traits: []
    start: true
    blurb: The one you start with. It bounces, and it is always there.
  - id: lambda
    name: Lambda
    color: "#ff9900"
    traits: [split]
    blurb: Scales out. Each hit spawns short-lived concurrent copies.
  - id: datadog
    name: Datadog
    color: "#e05cc1"
    traits: [trace]
    blurb: Traces what it hits for bonus damage and reveals silent defects.
  - id: terraform
    name: Terraform
    color: "#844fba"
    traits: [pierce, noFalloff]
    blurb: Idempotent. Pierces, and repeat hits never lose damage.
  - id: oidc
    name: OIDC
    color: "#3fb950"
    traits: [security]
    blurb: Short-lived credentials. Security damage cuts through armor.
  - id: cypress
    name: Cypress
    color: "#69d3a7"
    traits: [pin]
    blurb: Pins flaky tests solid so they can be hit.
  - id: redis
    name: Redis
    color: "#ff4438"
    traits: [cache]
    blurb: Cache hits repeat the damage for free.
  - id: rust
    name: Rust
    color: "#dea584"
    traits: [heavy, pierce]
    blurb: Heavy and slow. Pierces everything; same damage every time.
  - id: pagerduty
    name: PagerDuty
    color: "#57c7ff"
    traits: [homing]
    blurb: Pages toward whatever is closest to breaching.
  - id: gha
    name: GitHub Actions
    color: "#2f81f7"
    traits: [matrix]
    blurb: Matrix build. Fires a fan of shards.
  - id: mentee
    name: Teammate
    color: "#8b949e"
    traits: []
    offer: false
    blurb: Fired by the engineers you have mentored.

fusions:
  - id: self-describing-lambda
    name: Self-describing Lambda
    parts: [lambda, terraform]
    bonus: copiesInherit
    color: "#ffb454"
    cites: [cie-self-describing-lambda]
    blurb: Copies inherit pierce. Adding an endpoint means adding a directory.
  - id: zero-long-lived-credentials
    name: Zero Long-lived Credentials
    parts: [oidc, gha]
    bonus: shatter
    color: "#56d364"
    cites: [cie-credentials]
    blurb: Every shard does security damage, and a hit strips armor for good.
  - id: dead-man-switch
    name: Dead-man Switch
    parts: [datadog, pagerduty]
    bonus: autoTarget
    color: "#f778ba"
    cites: [cie-monitors-as-code]
    blurb: Homes on traced enemies first. Silence is an alert.
  - id: weighted-parallelization
    name: Weighted Parallelization
    parts: [cypress, gha]
    bonus: evenSplit
    color: "#79c0ff"
    cites: [cms-tl-cypress-parallel]
    blurb: Twice the shards, spread across the whole pit.
  - id: deterministic-replay
    name: Deterministic Replay
    parts: [rust, redis]
    bonus: cacheAlways
    color: "#ffa198"
    cites: [hornvale]
    blurb: Byte-identical every time. Every hit is a cache hit.
  - id: monitors-as-code
    name: Monitors as Code
    parts: [datadog, terraform]
    bonus: traceArea
    color: "#d2a8ff"
    cites: [cie-monitors-as-code]
    blurb: Traces everything near the hit.

enemies:
  request:
    name: Request
    label: REQ
    color: "#58a6ff"
    hp: 20
    budget: 1
    xp: 1
    cites: [cie-ownership]
    blurb: Production traffic. It arrives in bursts.
  flaky:
    name: Flaky Test
    label: FLAKY
    color: "#d29922"
    hp: 30
    budget: 1
    xp: 2
    cites: [cms-sse-flaky]
    blurb: Phases in and out. Shots pass through it half the time.
  silent:
    name: Silent Defect
    label: DEFECT
    color: "#f85149"
    hp: 40
    budget: 3
    xp: 3
    cites: [cie-silent-defect]
    blurb: Invisible until monitoring or a traced hit finds it.
  credential:
    name: Long-lived Credential
    label: CRED
    color: "#e3b341"
    hp: 60
    armored: true
    budget: 2
    xp: 3
    cites: [cie-credentials]
    blurb: Armored. Only security damage gets through cleanly.
  idle:
    name: Idle Capacity
    label: IDLE
    color: "#6e7681"
    hp: 140
    w: 112
    budget: 0
    xp: 12
    cites: [cie-cost]
    blurb: Large and harmless, and never served a request. Removing it pays well.
  deadlock:
    name: Deadlock
    label: LOCK
    color: "#bc8cff"
    hp: 35
    budget: 1
    xp: 2
    cites: [cms-sse-flaky]
    blurb: Comes in linked pairs. Kill both close together or one comes back.
  dependency:
    name: Unpinned Dependency
    label: DEP
    color: "#7ee787"
    hp: 18
    budget: 1
    xp: 1
    cites: [cie-dependency-hygiene]
    blurb: Left alone, it pulls in more of itself.
  skipped:
    name: Skipped Check
    label: SKIP
    color: "#a5d6ff"
    hp: 30
    budget: 2
    xp: 2
    cites: [cie-dependency-hygiene]
    blurb: Counted as a pass. Hits do nothing until it is revealed.
  module:
    name: Drupal Module
    label: MOD
    color: "#0678be"
    hp: 45
    budget: 0
    xp: 1
    cites: [cms-tl-content-release]
    blurb: A shield of modules. Break them before the core will take damage.

stages:
  - id: devon
    employer: DEVONtechnologies
    roles: [devon]
    duration: 70
    speed: 16
    hpScale: 1.0
    spawnEvery: 2.6
    rowMin: 2
    rowMax: 4
    spikeEvery: 0
    ramp: 0
    bossRate: 0.5
    mix: {request: 6, flaky: 2, dependency: 1}
    boss: sync-conflict
  - id: ain
    employer: Convention News
    roles: [ain]
    duration: 75
    speed: 17
    hpScale: 1.5
    spawnEvery: 2.5
    rowMin: 2
    rowMax: 4
    spikeEvery: 0
    ramp: 0.2
    bossRate: 0.5
    mix: {request: 5, flaky: 2, idle: 1, dependency: 2, skipped: 1}
    boss: managed-host-invoice
  - id: cms
    employer: VA.gov CMS
    roles: [cms-tl, cms-sse]
    duration: 80
    speed: 18
    hpScale: 2.2
    spawnEvery: 2.4
    rowMin: 3
    rowMax: 5
    spikeEvery: 0
    ramp: 0.3
    bossRate: 0.5
    mix: {request: 4, flaky: 3, deadlock: 2, skipped: 2, dependency: 1, silent: 1}
    boss: drupal-upgrade
  - id: cie
    employer: VA.gov Check-In
    roles: [cie]
    duration: 85
    speed: 19
    hpScale: 3.0
    spawnEvery: 2.3
    rowMin: 3
    rowMax: 5
    spikeEvery: 14
    ramp: 0.8
    bossRate: 0.7
    mix: {request: 5, silent: 2, credential: 2, idle: 1, deadlock: 1, skipped: 1}
    boss: hard-cutover

bosses:
  - id: sync-conflict
    name: The Sync Conflict
    hp: 900
    cites: [devon-owned-sync]
    blurb: At half health it splits into two replicas. Kill both before they re-merge.
  - id: managed-host-invoice
    name: The Managed Host Invoice
    hp: 1400
    cites: [ain-arc]
    blurb: Grows the longer you leave it. Migration damage counts double.
  - id: drupal-upgrade
    name: "Drupal 8 → 9 → 10"
    hp: 2400
    cites: [cms-sse-drupal9, cms-tl-drupal10]
    blurb: Three phases. Each upgrade raises a fresh shield of modules.
  - id: hard-cutover
    name: The Hard Cutover
    hp: 3600
    cites: [cie-account-cutover, cie-ownership]
    blurb: Moves between the legacy account and the new one while traffic keeps rising.
```

- [ ] **Step 5: Write `tunable/game.py`**

```python
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
```

- [ ] **Step 6: Update `build.py`**

Replace the import line `from tunable.emailgen import address, load_words` with:

```python
from tunable import game as gamemod
from tunable.emailgen import load_words, resolve
```

Replace the `if email is None:` block inside `build()` with:

```python
    if email is None:
        email = resolve(profile.email, profile.name, config.email_domain, load_words(root / "content" / "words.txt"))
```

Update the docstring usage lines to add `python build.py --game`. In `main()`, add to the mutually exclusive group:

```python
    g.add_argument("--game", action="store_true", help="build only the game into <out>/game")
```

and replace the `names = ...` line and `try:` block with:

```python
    if args.all:
        names = sorted(p.stem for p in (args.root / "profiles").glob("*.yaml"))
    else:
        names = [args.profile] if args.profile else []
    try:
        for name in names:
            path = build(name, root=args.root, out_dir=args.out, email=args.email, pdf=not args.no_pdf)
            print(f"built {name}: {path}" + ("" if args.no_pdf else f", {path.with_suffix('.pdf')}"))
        if args.all or args.game:
            dest = gamemod.write(args.root, (args.out or args.root / "dist").resolve())
            print(f"built game: {dest}")
    except (ContentError, RuntimeError, FileNotFoundError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    return 0
```

- [ ] **Step 7: Run the tests**

Run: `python3 -m pytest -q`
Expected: all pass (including the existing suite; `test_build.py` still passes with `resolve`).

- [ ] **Step 8: Record planning decisions in the spec**

In `docs/superpowers/specs/2026-09-25-resume-roguelike-design.md`:
- §3 layout: add `world.js` (playfield constants), `bosses.js` (boss scripts; `stages.js` keeps the wave schedule), and `test/sim.mjs` (headless run used by pytest).
- §7 enemies table, Idle Capacity row: behaviour becomes "Large and tanky, harmless to budget; big XP bonus ('cost savings')." (It falls at row speed so rows never overlap.) Add a Drupal Module row: "Static shield row raised by the Drupal boss", cites `cms-tl-content-release`.
- §7 fusions table: replace the Bonus column with the `blurb` values from `game/design.yaml`.
- §5: add "The first time each enemy kind or boss appears, a toast names it and quotes the bullet it cites."
- §7 balls: add "At most five tool kinds at once; a fusion frees a slot."

- [ ] **Step 9: Commit**

```bash
git add tunable/emailgen.py tunable/game.py build.py game/design.yaml tests/test_game.py docs/superpowers/specs/2026-09-25-resume-roguelike-design.md
git commit -m "Add the game design file and export it as game-data.json

Claude-Session: https://claude.ai/code/session_019Gn4ESpBQMBXM6ugLwTT3t"
```

---

### Task 2: JS foundation — world constants, seeded RNG, physics

**Files:**
- Create: `game/package.json`, `game/src/world.js`, `game/src/rng.js`, `game/src/physics.js`
- Create: `game/test/rng.test.js`, `game/test/physics.test.js`
- Modify: `Makefile`, `.github/workflows/continuous_delivery.yaml`

**Interfaces:**
- Produces (`world.js`): `W=480, H=720, COLS=8, COL_W=60, PLAYER_Y=680, DANGER_Y=640, BOTTOM=700, MOVE_BAND_Y=600, REVEAL_BASE=140, STEP=1/120`.
- Produces (`rng.js`): `makeRng(seed) -> { next(): [0,1), range(a,b), int(a,b) inclusive, pick(arr), weighted(items, weightFn) }`.
- Produces (`physics.js`): `circleRect(c{x,y,r}, rect{x,y,w,h}) -> {nx,ny,depth}|null`, `reflect(ball, hit)`, `bounceWalls(ball) -> boolean` (true = below BOTTOM), `clampUp(dir, minUp=0.15)`, `aimVector(fx,fy,tx,ty,minUp=0.15)`, `keepSteep(ball, minUp=0.2)`, `setSpeed(ball, speed)`.

- [ ] **Step 1: Scaffolding**

`game/package.json`:

```json
{
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test test/*.test.js" }
}
```

`game/src/world.js`:

```js
// Playfield geometry in logical pixels. The canvas scales this to the screen.
export const W = 480;
export const H = 720;
export const COLS = 8;
export const COL_W = W / COLS;
export const PLAYER_Y = 680;
export const DANGER_Y = 640; // an enemy whose bottom crosses this burns error budget
export const BOTTOM = 700; // a ball below this has returned to the player
export const MOVE_BAND_Y = 600; // pointer below this moves the player instead of aiming
export const REVEAL_BASE = 140; // enemies this close to DANGER_Y are revealed by monitoring
export const STEP = 1 / 120; // fixed simulation timestep, seconds
```

- [ ] **Step 2: Write failing tests**

`game/test/rng.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../src/rng.js';

test('same seed, same sequence', () => {
  const a = makeRng(42), b = makeRng(42);
  for (let i = 0; i < 20; i++) assert.equal(a.next(), b.next());
});

test('different seeds diverge', () => {
  assert.notEqual(makeRng(1).next(), makeRng(2).next());
});

test('next stays in [0, 1) and int is inclusive', () => {
  const r = makeRng(7);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const x = r.next();
    assert.ok(x >= 0 && x < 1);
    seen.add(r.int(2, 4));
  }
  assert.deepEqual([...seen].sort(), [2, 3, 4]);
});

test('weighted never picks a zero-weight item', () => {
  const r = makeRng(3);
  for (let i = 0; i < 500; i++) assert.notEqual(r.weighted(['a', 'b'], (x) => (x === 'a' ? 0 : 1)), 'a');
});
```

`game/test/physics.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { circleRect, reflect, bounceWalls, aimVector, clampUp, keepSteep, setSpeed } from '../src/physics.js';
import { W, BOTTOM } from '../src/world.js';

const close = (a, b) => Math.abs(a - b) < 1e-9;

test('circleRect misses a distant circle', () => {
  assert.equal(circleRect({ x: 0, y: 0, r: 5 }, { x: 20, y: 20, w: 10, h: 10 }), null);
});

test('circleRect reports a downward normal for a hit from below', () => {
  const hit = circleRect({ x: 25, y: 33, r: 5 }, { x: 20, y: 20, w: 10, h: 10 });
  assert.equal(hit.nx, 0);
  assert.equal(hit.ny, 1);
  assert.ok(close(hit.depth, 2));
});

test('a centre inside the rect is pushed out of the nearest side', () => {
  const hit = circleRect({ x: 21, y: 25, r: 3 }, { x: 20, y: 20, w: 10, h: 10 });
  assert.equal(hit.nx, -1);
  assert.equal(hit.ny, 0);
});

test('reflect flips the normal component and pushes the ball out', () => {
  const b = { x: 25, y: 33, r: 5, vx: 10, vy: -100 };
  reflect(b, { nx: 0, ny: 1, depth: 2 });
  assert.equal(b.vy, 100);
  assert.equal(b.vx, 10);
  assert.equal(b.y, 35);
});

test('reflect leaves a ball already moving away alone', () => {
  const b = { x: 0, y: 0, vx: 0, vy: 50 };
  reflect(b, { nx: 0, ny: 1, depth: 1 });
  assert.equal(b.vy, 50);
});

test('bounceWalls reflects off left, right and top and reports the bottom', () => {
  const l = { x: 2, y: 100, r: 6, vx: -50, vy: -50 };
  assert.equal(bounceWalls(l), false);
  assert.equal(l.vx, 50);
  assert.equal(l.x, 6);
  const r = { x: W, y: 100, r: 6, vx: 50, vy: -50 };
  bounceWalls(r);
  assert.equal(r.vx, -50);
  const t = { x: 100, y: 1, r: 6, vx: 0, vy: -50 };
  bounceWalls(t);
  assert.equal(t.vy, 50);
  assert.equal(bounceWalls({ x: 100, y: BOTTOM + 7, r: 6, vx: 0, vy: 50 }), true);
});

test('aimVector is a unit vector clamped above the minimum upward angle', () => {
  const v = aimVector(100, 600, 400, 610);
  assert.ok(close(Math.hypot(v.x, v.y), 1));
  assert.ok(v.y <= -0.15 + 1e-9);
  assert.ok(v.x > 0);
  const up = aimVector(100, 600, 100, 0);
  assert.ok(close(up.y, -1));
  assert.deepEqual(clampUp({ x: 0, y: -1 }), { x: 0, y: -1 });
});

test('keepSteep keeps speed and enforces a vertical component', () => {
  const b = { vx: 100, vy: -1 };
  const speed = Math.hypot(b.vx, b.vy);
  keepSteep(b);
  assert.ok(close(Math.hypot(b.vx, b.vy), speed));
  assert.ok(b.vy < 0 && Math.abs(b.vy) / speed >= 0.2 - 1e-9);
});

test('setSpeed rescales without changing direction', () => {
  const b = { vx: 3, vy: 4 };
  setSpeed(b, 10);
  assert.ok(close(b.vx, 6) && close(b.vy, 8));
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd game && node --test test/*.test.js`
Expected: FAIL, `Cannot find module '.../src/rng.js'`.

- [ ] **Step 4: Implement**

`game/src/rng.js`:

```js
// Seeded PRNG (mulberry32) so runs and tests are reproducible.
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted(items, weight) {
      const total = items.reduce((sum, x) => sum + weight(x), 0);
      let r = next() * total;
      for (const x of items) {
        r -= weight(x);
        if (r < 0) return x;
      }
      return items[items.length - 1];
    },
  };
}
```

`game/src/physics.js`:

```js
import { W, BOTTOM } from './world.js';

// Circle vs axis-aligned rect. Returns the push-out normal and depth, or null.
export function circleRect(c, r) {
  const cx = Math.max(r.x, Math.min(c.x, r.x + r.w));
  const cy = Math.max(r.y, Math.min(c.y, r.y + r.h));
  const dx = c.x - cx;
  const dy = c.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 > c.r * c.r) return null;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    return { nx: dx / d, ny: dy / d, depth: c.r - d };
  }
  const left = c.x - r.x;
  const right = r.x + r.w - c.x;
  const top = c.y - r.y;
  const bottom = r.y + r.h - c.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { nx: -1, ny: 0, depth: left + c.r };
  if (m === right) return { nx: 1, ny: 0, depth: right + c.r };
  if (m === top) return { nx: 0, ny: -1, depth: top + c.r };
  return { nx: 0, ny: 1, depth: bottom + c.r };
}

export function reflect(b, hit) {
  const dot = b.vx * hit.nx + b.vy * hit.ny;
  if (dot < 0) {
    b.vx -= 2 * dot * hit.nx;
    b.vy -= 2 * dot * hit.ny;
  }
  b.x += hit.nx * hit.depth;
  b.y += hit.ny * hit.depth;
}

// Bounce off the side and top walls. Returns true once the ball is below BOTTOM.
export function bounceWalls(b) {
  if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx); }
  if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx); }
  if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy); }
  return b.y - b.r > BOTTOM;
}

export function clampUp(d, minUp = 0.15) {
  if (d.y <= -minUp) return d;
  return { x: Math.sign(d.x || 1) * Math.sqrt(1 - minUp * minUp), y: -minUp };
}

export function aimVector(fx, fy, tx, ty, minUp = 0.15) {
  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.hypot(dx, dy) || 1;
  return clampUp({ x: dx / len, y: dy / len }, minUp);
}

// Stop a ball settling into a near-horizontal loop between the side walls.
export function keepSteep(b, minUp = 0.2) {
  const s = Math.hypot(b.vx, b.vy) || 1;
  if (Math.abs(b.vy) / s >= minUp) return;
  const sign = b.vy < 0 ? -1 : 1;
  b.vy = sign * minUp * s;
  b.vx = Math.sign(b.vx || 1) * Math.sqrt(1 - minUp * minUp) * s;
}

export function setSpeed(b, speed) {
  const s = Math.hypot(b.vx, b.vy) || 1;
  b.vx *= speed / s;
  b.vy *= speed / s;
}
```

- [ ] **Step 5: Wire node tests into make and CI**

`Makefile`:

```make
.PHONY: test build build-all game serve clean
PROFILE ?= commercial-senior-swe

test:
	python3 -m pytest -q
	cd game && node --test test/*.test.js

build:
	python3 build.py --profile $(PROFILE)

build-all:
	python3 build.py --all

game:
	python3 build.py --game

serve: game
	python3 -m http.server -d dist 8000

clean:
	rm -rf build dist
```

In `.github/workflows/continuous_delivery.yaml`, `test` job, after the `Test (no TeX; page-budget tests skip)` step:

```yaml
      - name: Game unit tests
        run: cd game && node --test test/*.test.js
```

- [ ] **Step 6: Run**

Run: `cd game && node --test test/*.test.js`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add game/package.json game/src/world.js game/src/rng.js game/src/physics.js game/test Makefile .github/workflows/continuous_delivery.yaml
git commit -m "Add the game's playfield constants, seeded RNG, and collision physics

Claude-Session: https://claude.ai/code/session_019Gn4ESpBQMBXM6ugLwTT3t"
```

---

### Task 3: Balls and fusions

**Files:**
- Create: `game/src/balls.js`, `game/src/fusion.js`
- Create: `game/src/enemies.js` (only `isTargetable` and `lowestTarget` in this task; Task 4 extends it)
- Create: `game/test/helpers.js`, `game/test/balls.test.js`, `game/test/fusion.test.js`

**Interfaces:**
- Consumes: `world.js`, `physics.setSpeed`, `rng`.
- Produces (`balls.js`): `MAX_LEVEL=3`, `MAX_KINDS=5`, `BASE_SPEED=560`, `BASE_R=6`, `BASE_DAMAGE=10`, `MAX_CHILDREN=80`, `isFusion(kind)`, `fusionKind(id)`, `kindInfo(kind, design) -> {id,name,color,blurb}`, `traitsFor(kind, design) -> Set`, `makeBall(state, kind, x, y, dir, opts)`, `hitDamage(state, ball, enemy, rng) -> {damage, cached}`, `applyHitEffects(state, ball, enemy, rng)`, `steer(state, ball, dt)`, `rebuildSlots(state)`.
- Produces (`fusion.js`): `requiredLevel(state)`, `eligibleFusions(state)`, `applyFusion(state, fusion)`.
- Produces (`enemies.js`, partial): `isTargetable(e)`, `lowestTarget(state, preferTraced=false)`.
- Ball object: `{id, kind, traits:Set, level, x, y, vx, vy, speed, r, dmgScale, slot, ttl, child, lastEnemy, cooldowns:Map, hits}`. Slot object: `{kind, out}`.
- State fields this task relies on (created by `engine.newRun` in Task 7; tests build them with `fixtureState`): `design, t, nextId, inventory, slots, balls, enemies, mods, fused`.

- [ ] **Step 1: Test helpers**

`game/test/helpers.js`:

```js
// Minimal but complete game data for unit tests. Real data is exercised by the
// pytest-driven simulation (tests/test_game.py).
import { makeRng } from '../src/rng.js';

const MODS = ['fireRate', 'regen', 'reveal', 'armorPierce', 'testDmg', 'bossDmg', 'xpGain', 'maxBudget',
  'teammates', 'fusionEarly', 'ballCount', 'damage', 'crossTeam', 'tracedBonus', 'docs'];

const enemy = (name, label, extra = {}) => ({ name, label, color: '#58a6ff', hp: 20, budget: 1, xp: 1, cites: ['b1'], blurb: name, ...extra });

export function fixtureData() {
  const design = {
    mods: Object.fromEntries(MODS.map((m) => [m, { label: m, format: m === 'docs' ? 'flag' : 'pct' }])),
    tag_effects: {
      'ci-cd': { fireRate: 0.05 },
      testing: { testDmg: 0.1 },
      ownership: { maxBudget: 0.6 },
      documentation: { docs: 1, regen: 0.004 },
    },
    balls: [
      { id: 'bash', name: 'Bash', color: '#ffffff', traits: [], start: true, blurb: 'b' },
      { id: 'lambda', name: 'Lambda', color: '#ff9900', traits: ['split'], blurb: 'l' },
      { id: 'datadog', name: 'Datadog', color: '#e05cc1', traits: ['trace'], blurb: 'd' },
      { id: 'terraform', name: 'Terraform', color: '#844fba', traits: ['pierce', 'noFalloff'], blurb: 't' },
      { id: 'oidc', name: 'OIDC', color: '#3fb950', traits: ['security'], blurb: 'o' },
      { id: 'cypress', name: 'Cypress', color: '#69d3a7', traits: ['pin'], blurb: 'c' },
      { id: 'redis', name: 'Redis', color: '#ff4438', traits: ['cache'], blurb: 'r' },
      { id: 'rust', name: 'Rust', color: '#dea584', traits: ['heavy', 'pierce'], blurb: 'r' },
      { id: 'pagerduty', name: 'PagerDuty', color: '#57c7ff', traits: ['homing'], blurb: 'p' },
      { id: 'gha', name: 'GitHub Actions', color: '#2f81f7', traits: ['matrix'], blurb: 'g' },
      { id: 'mentee', name: 'Teammate', color: '#8b949e', traits: [], offer: false, blurb: 'm' },
    ],
    fusions: [
      { id: 'self-describing-lambda', name: 'Self-describing Lambda', parts: ['lambda', 'terraform'], bonus: 'copiesInherit', color: '#ffb454', cites: ['b1'], blurb: 'sdl' },
      { id: 'deterministic-replay', name: 'Deterministic Replay', parts: ['rust', 'redis'], bonus: 'cacheAlways', color: '#ffa198', cites: ['p1'], blurb: 'dr' },
    ],
    enemies: {
      request: enemy('Request', 'REQ'),
      flaky: enemy('Flaky Test', 'FLAKY', { hp: 30 }),
      silent: enemy('Silent Defect', 'DEFECT', { hp: 40, budget: 3 }),
      credential: enemy('Long-lived Credential', 'CRED', { hp: 60, armored: true, budget: 2 }),
      idle: enemy('Idle Capacity', 'IDLE', { hp: 140, w: 112, budget: 0, xp: 12 }),
      deadlock: enemy('Deadlock', 'LOCK', { hp: 35 }),
      dependency: enemy('Unpinned Dependency', 'DEP', { hp: 18 }),
      skipped: enemy('Skipped Check', 'SKIP', { hp: 30, budget: 2 }),
      module: enemy('Drupal Module', 'MOD', { hp: 45, budget: 0 }),
    },
    stages: [
      { id: 's1', employer: 'Acme', roles: ['r1'], duration: 10, speed: 20, hpScale: 1, spawnEvery: 2, rowMin: 2, rowMax: 3, spikeEvery: 0, ramp: 0, bossRate: 0.5, mix: { request: 1 }, boss: 'sync-conflict' },
      { id: 's2', employer: 'Beta', roles: ['r1'], duration: 10, speed: 20, hpScale: 1, spawnEvery: 2, rowMin: 2, rowMax: 3, spikeEvery: 0, ramp: 0, bossRate: 0.5, mix: { request: 1 }, boss: 'managed-host-invoice' },
    ],
    bosses: [
      { id: 'sync-conflict', name: 'The Sync Conflict', hp: 100, cites: ['b1'], blurb: 'sc' },
      { id: 'managed-host-invoice', name: 'The Managed Host Invoice', hp: 100, cites: ['b1'], blurb: 'inv' },
      { id: 'drupal-upgrade', name: 'Drupal 8 → 9 → 10', hp: 300, cites: ['b1'], blurb: 'du' },
      { id: 'hard-cutover', name: 'The Hard Cutover', hp: 100, cites: ['b1'], blurb: 'hc' },
    ],
  };
  return {
    person: { name: 'Test Person', email: 'a@b.c', website: 'x.net', github: 'x', linkedin: 'x', summary: 'Engineer.', pdf: 'https://x/resume.pdf' },
    roles: [{
      id: 'r1', title: 'Engineer', employer: 'Acme (contract)', start: '2020-01', end: 'present',
      bullets: [
        { id: 'b1', text: 'Did a thing', tags: ['ci-cd'], weight: 5, alt: '' },
        { id: 'b2', text: 'Tested a thing', tags: ['testing'], weight: 3, alt: 'x' },
        { id: 'b3', text: 'Wrote down a thing', tags: ['documentation', 'ownership'], weight: 3, alt: 'x' },
      ],
    }],
    projects: [{ id: 'p1', name: 'Proj', emoji: '', text: 'A project', url: 'https://x' }],
    design,
  };
}

// A bare state for testing modules below the engine.
export function fixtureState(seed = 1) {
  const data = fixtureData();
  const mods = Object.fromEntries(Object.keys(data.design.mods).map((k) => [k, 0]));
  return {
    data, design: data.design, rng: makeRng(seed), t: 0, nextId: 1,
    stageIndex: 0, stageDef: data.design.stages[0], stageTime: 0, spawnTimer: 0, spikeTimer: 0, spikeDue: false,
    boss: null, player: { x: 240, aim: { x: 0, y: -1 } },
    budget: 20, maxBudget: 20, mods,
    inventory: { bash: 1 }, slots: [], slotCursor: 0,
    balls: [], enemies: [], pendingRespawns: [],
    xp: 0, level: 1, xpToNext: 8, pendingLevels: 0, cards: null, cardsPicked: 0,
    picks: [], pickedAlts: [], fused: [], seen: [], events: [],
    stats: { shots: 0, balls: 0, misses: 0, kills: 0, firstBossAt: null, degradedSince: null, restores: [], crossed: [], timeline: [] },
  };
}

export function rect(state, props) {
  return { id: state.nextId++, kind: 'request', x: 200, y: 200, w: 52, h: 24, hp: 20, maxHp: 20, budget: 1, xp: 1,
    armored: false, revealed: true, traced: false, phased: false, pinnedUntil: 0, phaseOffset: 0, spawnTimer: 3.5,
    link: null, static: false, shieldOf: null, dead: false, boss: null, ...props };
}
```

- [ ] **Step 2: Write failing tests**

`game/test/balls.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { traitsFor, kindInfo, makeBall, hitDamage, applyHitEffects, rebuildSlots, steer, fusionKind, BASE_DAMAGE } from '../src/balls.js';
import { fixtureState, rect } from './helpers.js';

const up = { x: 0, y: -1 };
const noCache = { next: () => 0.99 };

test('a fusion has both parts\' traits plus its bonus', () => {
  const s = fixtureState();
  const t = traitsFor(fusionKind('self-describing-lambda'), s.design);
  assert.deepEqual([...t].sort(), ['copiesInherit', 'noFalloff', 'pierce', 'split']);
  assert.equal(kindInfo(fusionKind('self-describing-lambda'), s.design).name, 'Self-describing Lambda');
});

test('base damage at level 1 with no mods', () => {
  const s = fixtureState();
  const b = makeBall(s, 'bash', 0, 0, up);
  assert.equal(hitDamage(s, b, rect(s), noCache).damage, BASE_DAMAGE);
});

test('level scales damage by half per level', () => {
  const s = fixtureState();
  const b = makeBall(s, 'bash', 0, 0, up, { level: 3 });
  assert.equal(hitDamage(s, b, rect(s), noCache).damage, BASE_DAMAGE * 2);
});

test('repeat hits on the same enemy fall off, except for noFalloff', () => {
  const s = fixtureState();
  const e = rect(s);
  const bash = makeBall(s, 'bash', 0, 0, up);
  bash.lastEnemy = e.id;
  assert.equal(hitDamage(s, bash, e, noCache).damage, BASE_DAMAGE / 2);
  const tf = makeBall(s, 'terraform', 0, 0, up);
  tf.lastEnemy = e.id;
  assert.equal(hitDamage(s, tf, e, noCache).damage, BASE_DAMAGE);
});

test('traced enemies take 50% more, plus tracedBonus', () => {
  const s = fixtureState();
  s.mods.tracedBonus = 0.5;
  const b = makeBall(s, 'bash', 0, 0, up);
  assert.equal(hitDamage(s, b, rect(s, { traced: true }), noCache).damage, BASE_DAMAGE * 2);
});

test('armor lets 10% through unless the ball does security damage', () => {
  const s = fixtureState();
  const e = rect(s, { armored: true });
  assert.ok(Math.abs(hitDamage(s, makeBall(s, 'bash', 0, 0, up), e, noCache).damage - 1) < 1e-9);
  assert.equal(hitDamage(s, makeBall(s, 'oidc', 0, 0, up), e, noCache).damage, BASE_DAMAGE);
  s.mods.armorPierce = 0.4;
  assert.ok(Math.abs(hitDamage(s, makeBall(s, 'bash', 0, 0, up), e, noCache).damage - 5) < 1e-9);
});

test('heavy damage ignores tracing and falloff', () => {
  const s = fixtureState();
  const e = rect(s, { traced: true });
  const b = makeBall(s, 'rust', 0, 0, up);
  b.lastEnemy = e.id;
  assert.equal(hitDamage(s, b, e, noCache).damage, BASE_DAMAGE * 2.5);
});

test('migration-weak bosses apply bossDmg twice', () => {
  const s = fixtureState();
  s.mods.bossDmg = 0.5;
  const b = makeBall(s, 'bash', 0, 0, up);
  assert.equal(hitDamage(s, b, rect(s, { boss: 'x' }), noCache).damage, 15);
  assert.equal(hitDamage(s, b, rect(s, { boss: 'x', migrationWeak: true }), noCache).damage, 22.5);
});

test('cacheAlways doubles every hit', () => {
  const s = fixtureState();
  const b = makeBall(s, fusionKind('deterministic-replay'), 0, 0, up, { level: 1 });
  const r = hitDamage(s, b, rect(s), noCache);
  assert.equal(r.cached, true);
  assert.equal(r.damage, BASE_DAMAGE * 2.5 * 2);
});

test('trace marks and reveals; pin holds a flaky test solid', () => {
  const s = fixtureState();
  const e = rect(s, { kind: 'flaky', revealed: false });
  applyHitEffects(s, makeBall(s, 'datadog', 0, 0, up), e, s.rng);
  assert.equal(e.traced, true);
  assert.equal(e.revealed, true);
  s.t = 10;
  applyHitEffects(s, makeBall(s, 'cypress', 0, 0, up, { level: 2 }), e, s.rng);
  assert.equal(e.pinnedUntil, 14);
});

test('split spawns 1 + level short-lived children that do not split again', () => {
  const s = fixtureState();
  const parent = makeBall(s, 'lambda', 100, 100, up, { level: 2 });
  applyHitEffects(s, parent, rect(s), s.rng);
  assert.equal(s.balls.length, 3);
  assert.ok(s.balls.every((b) => b.child && b.ttl === 1.2 && !b.traits.has('split')));
  applyHitEffects(s, s.balls[0], rect(s), s.rng);
  assert.equal(s.balls.length, 3);
});

test('copiesInherit gives children the parent traits except split', () => {
  const s = fixtureState();
  const parent = makeBall(s, fusionKind('self-describing-lambda'), 100, 100, up, { level: 3 });
  applyHitEffects(s, parent, rect(s), s.rng);
  assert.ok(s.balls.every((b) => b.traits.has('pierce') && !b.traits.has('split')));
});

test('rebuildSlots makes copies per ballCount and keeps existing slot objects', () => {
  const s = fixtureState();
  rebuildSlots(s);
  const first = s.slots[0];
  first.out = 1;
  s.inventory.lambda = 1;
  s.mods.ballCount = 1.2;
  rebuildSlots(s);
  assert.deepEqual(s.slots.map((x) => x.kind), ['bash', 'bash', 'lambda', 'lambda']);
  assert.equal(s.slots[0], first);
});

test('homing steers toward the enemy nearest the bottom', () => {
  const s = fixtureState();
  s.enemies.push(rect(s, { x: 400, y: 500 }), rect(s, { x: 0, y: 100 }));
  const b = makeBall(s, 'pagerduty', 240, 600, up);
  for (let i = 0; i < 30; i++) steer(s, b, 1 / 60);
  assert.ok(b.vx > 0);
});
```

`game/test/fusion.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredLevel, eligibleFusions, applyFusion } from '../src/fusion.js';
import { fusionKind } from '../src/balls.js';
import { fixtureState } from './helpers.js';

test('fusion needs both parts at level 3, or 2 with fusionEarly', () => {
  const s = fixtureState();
  s.inventory = { lambda: 3, terraform: 2 };
  assert.equal(eligibleFusions(s).length, 0);
  s.mods.fusionEarly = 1;
  assert.equal(requiredLevel(s), 2);
  assert.deepEqual(eligibleFusions(s).map((f) => f.id), ['self-describing-lambda']);
  s.mods.fusionEarly = 5;
  assert.equal(requiredLevel(s), 2);
});

test('applying a fusion consumes the parts and cannot be offered twice', () => {
  const s = fixtureState();
  s.inventory = { bash: 1, lambda: 3, terraform: 3 };
  applyFusion(s, s.design.fusions[0]);
  assert.deepEqual(Object.keys(s.inventory), ['bash', fusionKind('self-describing-lambda')]);
  s.inventory.lambda = 3;
  s.inventory.terraform = 3;
  assert.equal(eligibleFusions(s).length, 0);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd game && node --test test/*.test.js`
Expected: FAIL, cannot find `../src/balls.js`.

- [ ] **Step 4: Implement**

`game/src/enemies.js` (initial):

```js
export function isTargetable(e) {
  return !e.dead && e.revealed && !e.phased;
}

// The targetable enemy closest to breaching; with preferTraced, traced ones first.
export function lowestTarget(state, preferTraced = false) {
  let best = null;
  let bestScore = -Infinity;
  for (const e of state.enemies) {
    if (!isTargetable(e)) continue;
    const score = e.y + e.h + (preferTraced && e.traced ? 1000 : 0);
    if (score > bestScore) { best = e; bestScore = score; }
  }
  return best;
}
```

`game/src/balls.js`:

```js
import { setSpeed } from './physics.js';
import { lowestTarget } from './enemies.js';

export const MAX_LEVEL = 3;
export const MAX_KINDS = 5;
export const BASE_SPEED = 560;
export const BASE_R = 6;
export const BASE_DAMAGE = 10;
export const MAX_CHILDREN = 80;

const FUSION = 'fusion:';

export const isFusion = (kind) => kind.startsWith(FUSION);
export const fusionKind = (id) => FUSION + id;
const fusionDef = (kind, design) => design.fusions.find((f) => f.id === kind.slice(FUSION.length));

export function kindInfo(kind, design) {
  const d = isFusion(kind) ? fusionDef(kind, design) : design.balls.find((b) => b.id === kind);
  return { id: kind, name: d.name, color: d.color, blurb: d.blurb };
}

export function traitsFor(kind, design) {
  if (isFusion(kind)) {
    const f = fusionDef(kind, design);
    const t = new Set([f.bonus]);
    for (const p of f.parts) for (const x of traitsFor(p, design)) t.add(x);
    return t;
  }
  const b = design.balls.find((x) => x.id === kind);
  return new Set(b ? b.traits : []);
}

export function makeBall(state, kind, x, y, dir, opts = {}) {
  const traits = opts.traits ?? traitsFor(kind, state.design);
  const heavy = traits.has('heavy');
  const speed = BASE_SPEED * (heavy ? 0.7 : 1);
  return {
    id: state.nextId++, kind, traits,
    level: opts.level ?? state.inventory[kind] ?? 1,
    x, y, vx: dir.x * speed, vy: dir.y * speed, speed,
    r: heavy ? 10 : (opts.r ?? BASE_R),
    dmgScale: opts.dmgScale ?? 1,
    slot: opts.slot ?? null,
    ttl: opts.ttl ?? 20,
    child: Boolean(opts.child),
    lastEnemy: -1,
    cooldowns: new Map(), // enemy id -> time before a piercing ball may hit it again
    hits: 0,
  };
}

export function hitDamage(state, ball, enemy, rng) {
  const m = state.mods;
  const t = ball.traits;
  let dmg = BASE_DAMAGE * ball.dmgScale * (1 + 0.5 * (ball.level - 1)) * (1 + m.damage);
  if (t.has('heavy')) {
    dmg *= 2.5; // deterministic: none of the situational multipliers below
  } else {
    if (!t.has('noFalloff') && ball.lastEnemy === enemy.id) dmg *= 0.5;
    if (enemy.traced) dmg *= 1.5 + m.tracedBonus;
    if (enemy.kind === 'flaky' || enemy.kind === 'skipped') dmg *= 1 + m.testDmg;
  }
  if (enemy.boss) dmg *= (1 + m.bossDmg) * (enemy.migrationWeak ? 1 + m.bossDmg : 1);
  if (enemy.armored && !t.has('security')) dmg *= Math.min(1, 0.1 + m.armorPierce);
  let cached = false;
  if (t.has('cache') && (t.has('cacheAlways') || rng.next() < 0.15 * ball.level)) {
    dmg *= 2;
    cached = true;
  }
  return { damage: dmg, cached };
}

export function applyHitEffects(state, ball, enemy, rng) {
  const t = ball.traits;
  if (t.has('trace')) {
    enemy.traced = true;
    enemy.revealed = true;
    if (t.has('traceArea')) {
      for (const e of state.enemies) {
        if (Math.hypot(e.x + e.w / 2 - ball.x, e.y + e.h / 2 - ball.y) < 70) {
          e.traced = true;
          e.revealed = true;
        }
      }
    }
  }
  if (t.has('pin') && enemy.kind === 'flaky') enemy.pinnedUntil = state.t + 2 + ball.level;
  if (t.has('shatter')) enemy.armored = false;
  if (t.has('split') && !ball.child) spawnCopies(state, ball, rng);
}

function spawnCopies(state, ball, rng) {
  const children = state.balls.filter((b) => b.child).length;
  const n = Math.min(1 + ball.level, MAX_CHILDREN - children);
  const inherit = ball.traits.has('copiesInherit') ? [...ball.traits].filter((x) => x !== 'split') : [];
  for (let i = 0; i < n; i++) {
    const a = rng.range(0, Math.PI * 2);
    state.balls.push(makeBall(state, ball.kind, ball.x, ball.y, { x: Math.cos(a), y: Math.sin(a) },
      { traits: new Set(inherit), level: ball.level, child: true, ttl: 1.2, dmgScale: 0.4, r: 4 }));
  }
}

export function steer(state, ball, dt) {
  if (!ball.traits.has('homing')) return;
  const e = lowestTarget(state, ball.traits.has('autoTarget'));
  if (!e) return;
  const dx = e.x + e.w / 2 - ball.x;
  const dy = e.y + e.h / 2 - ball.y;
  const d = Math.hypot(dx, dy) || 1;
  const k = Math.min(1, 5 * dt);
  ball.vx += ((dx / d) * ball.speed - ball.vx) * k;
  ball.vy += ((dy / d) * ball.speed - ball.vy) * k;
  setSpeed(ball, ball.speed);
}

// One slot per owned kind per copy. Existing slot objects are kept so balls in
// flight still return to the slot they left from.
export function rebuildSlots(state) {
  const copies = 1 + Math.floor(state.mods.ballCount);
  const slots = [];
  for (const kind of Object.keys(state.inventory)) {
    for (let i = 0; i < copies; i++) {
      const old = state.slots.find((s) => s.kind === kind && !slots.includes(s));
      slots.push(old ?? { kind, out: 0 });
    }
  }
  state.slots = slots;
}
```

`game/src/fusion.js`:

```js
import { MAX_LEVEL, fusionKind } from './balls.js';

export function requiredLevel(state) {
  return Math.max(2, MAX_LEVEL - Math.floor(state.mods.fusionEarly));
}

export function eligibleFusions(state) {
  const need = requiredLevel(state);
  return state.design.fusions.filter((f) =>
    !state.fused.includes(f.id) && f.parts.every((p) => (state.inventory[p] ?? 0) >= need));
}

export function applyFusion(state, fusion) {
  for (const p of fusion.parts) delete state.inventory[p];
  state.inventory[fusionKind(fusion.id)] = MAX_LEVEL;
  state.fused.push(fusion.id);
}
```

- [ ] **Step 5: Run**

Run: `cd game && node --test test/*.test.js`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add game/src/balls.js game/src/fusion.js game/src/enemies.js game/test/helpers.js game/test/balls.test.js game/test/fusion.test.js
git commit -m "Add ball kinds, trait-driven hit behaviour, and fusions

Claude-Session: https://claude.ai/code/session_019Gn4ESpBQMBXM6ugLwTT3t"
```

---

### Task 4: Enemies

**Files:**
- Modify: `game/src/enemies.js`
- Create: `game/test/enemies.test.js`

**Interfaces:**
- Consumes: `world.js`.
- Produces: `makeEnemy(state, kind, x, y, opts{hpScale, static, shieldOf})`, `colX(col, w)`, `solid(e)`, `immune(e)`, `spawnDeadlockPair(state, colA, colB, y, hpScale)`, `onKilled(state, e)`, `updateEnemies(state, dt) -> budget burned (number)`, plus Task 3's `isTargetable`, `lowestTarget`.
- Enemy object: `{id, kind, x, y, w, h, hp, maxHp, budget, xp, armored, revealed, traced, phased, pinnedUntil, phaseOffset, spawnTimer, link, static, shieldOf, dead, boss}`.
- Emits `{type:'intro', kind}` into `state.events` the first time a kind appears (tracked in `state.seen`).

- [ ] **Step 1: Write failing tests**

`game/test/enemies.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEnemy, updateEnemies, solid, immune, onKilled, spawnDeadlockPair, colX } from '../src/enemies.js';
import { DANGER_Y, REVEAL_BASE } from '../src/world.js';
import { fixtureState } from './helpers.js';

test('makeEnemy scales hp and hides silent defects and skipped checks', () => {
  const s = fixtureState();
  const e = makeEnemy(s, 'request', 0, 0, { hpScale: 2 });
  assert.equal(e.hp, 40);
  assert.equal(e.maxHp, 40);
  assert.equal(makeEnemy(s, 'silent', 0, 0).revealed, false);
  assert.equal(makeEnemy(s, 'skipped', 0, 0).revealed, false);
  assert.equal(makeEnemy(s, 'idle', 0, 0).w, 112);
});

test('silent defects are not solid until revealed; skipped checks are solid but immune', () => {
  const s = fixtureState();
  const silent = makeEnemy(s, 'silent', 0, 0);
  const skipped = makeEnemy(s, 'skipped', 0, 0);
  assert.equal(solid(silent), false);
  assert.equal(solid(skipped), true);
  assert.equal(immune(skipped), true);
  skipped.revealed = true;
  assert.equal(immune(skipped), false);
});

test('enemies fall at stage speed; one crossing the SLO line burns budget and is removed', () => {
  const s = fixtureState();
  const e = makeEnemy(s, 'silent', 0, DANGER_Y - 24 - 1);
  s.enemies.push(e);
  assert.equal(updateEnemies(s, 1), 3);
  assert.equal(s.enemies.length, 0);
});

test('monitoring reveals enemies near the line, farther with the reveal mod', () => {
  const s = fixtureState();
  const e = makeEnemy(s, 'silent', 0, DANGER_Y - REVEAL_BASE - 24 - 50);
  s.enemies.push(e);
  s.stageDef = { ...s.stageDef, speed: 0 };
  updateEnemies(s, 0.1);
  assert.equal(e.revealed, false);
  s.mods.reveal = 60;
  updateEnemies(s, 0.1);
  assert.equal(e.revealed, true);
});

test('flaky tests phase on a cycle unless pinned', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, speed: 0 };
  const e = makeEnemy(s, 'flaky', 0, 100);
  e.phaseOffset = 0;
  s.enemies.push(e);
  s.t = 0.5; updateEnemies(s, 0);
  assert.equal(e.phased, false);
  s.t = 1.2; updateEnemies(s, 0);
  assert.equal(e.phased, true);
  e.pinnedUntil = 5; updateEnemies(s, 0);
  assert.equal(e.phased, false);
});

test('unpinned dependencies copy themselves every 3.5 s', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, speed: 0 };
  s.enemies.push(makeEnemy(s, 'dependency', colX(3, 52), 200));
  updateEnemies(s, 3.6);
  assert.equal(s.enemies.filter((e) => e.kind === 'dependency').length, 2);
});

test('a deadlock half respawns if its partner survives 2 s', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, speed: 0 };
  spawnDeadlockPair(s, 2, 3, 100, 1);
  const [a] = s.enemies;
  a.dead = true; onKilled(s, a);
  s.t = 1; updateEnemies(s, 0);
  assert.equal(s.enemies.length, 1);
  s.t = 2.1; updateEnemies(s, 0);
  assert.equal(s.enemies.length, 2);
  assert.equal(s.enemies[0].link, s.enemies[1].id);
});

test('killing both halves inside the window resolves the deadlock', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, speed: 0 };
  spawnDeadlockPair(s, 2, 3, 100, 1);
  const [a, b] = s.enemies;
  a.dead = true; onKilled(s, a);
  s.t = 1; b.dead = true; onKilled(s, b);
  s.t = 3; updateEnemies(s, 0);
  assert.equal(s.enemies.length, 0);
});

test('the first appearance of a kind emits one intro event', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, speed: 0 };
  s.enemies.push(makeEnemy(s, 'flaky', 0, 100), makeEnemy(s, 'flaky', 60, 100));
  updateEnemies(s, 0);
  updateEnemies(s, 0);
  assert.deepEqual(s.events.filter((e) => e.type === 'intro'), [{ type: 'intro', kind: 'flaky' }]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd game && node --test test/enemies.test.js`
Expected: FAIL, `makeEnemy` is not exported.

- [ ] **Step 3: Implement** — replace `game/src/enemies.js` with:

```js
import { COL_W, DANGER_Y, REVEAL_BASE, W } from './world.js';

const DEFAULT_W = 52;
const DEFAULT_H = 24;
const DEPENDENCY_CAP = 24;

export function makeEnemy(state, kind, x, y, opts = {}) {
  const def = state.design.enemies[kind];
  const id = state.nextId++;
  const hp = def.hp * (opts.hpScale ?? 1);
  return {
    id, kind, x, y, w: def.w ?? DEFAULT_W, h: def.h ?? DEFAULT_H,
    hp, maxHp: hp, budget: def.budget, xp: def.xp,
    armored: Boolean(def.armored),
    revealed: kind !== 'silent' && kind !== 'skipped',
    traced: false, phased: false, pinnedUntil: 0,
    phaseOffset: (id * 0.37) % 1.6,
    spawnTimer: 3.5, link: null,
    static: Boolean(opts.static), shieldOf: opts.shieldOf ?? null,
    dead: false, boss: null,
  };
}

export const colX = (col, w) => col * COL_W + (COL_W - w) / 2;

// Solid: balls collide with it. Immune: balls bounce off but deal no damage.
export const solid = (e) => !e.dead && !e.phased && !(e.kind === 'silent' && !e.revealed);
export const immune = (e) => (e.kind === 'skipped' && !e.revealed) || Boolean(e.boss && e.shielded);

export function isTargetable(e) {
  return !e.dead && e.revealed && !e.phased;
}

// The targetable enemy closest to breaching; with preferTraced, traced ones first.
export function lowestTarget(state, preferTraced = false) {
  let best = null;
  let bestScore = -Infinity;
  for (const e of state.enemies) {
    if (!isTargetable(e)) continue;
    const score = e.y + e.h + (preferTraced && e.traced ? 1000 : 0);
    if (score > bestScore) { best = e; bestScore = score; }
  }
  return best;
}

export function spawnDeadlockPair(state, colA, colB, y, hpScale = 1) {
  const a = makeEnemy(state, 'deadlock', colX(colA, DEFAULT_W), y, { hpScale });
  const b = makeEnemy(state, 'deadlock', colX(colB, DEFAULT_W), y, { hpScale });
  a.link = b.id;
  b.link = a.id;
  state.enemies.push(a, b);
}

// Deadlock bookkeeping when an enemy is killed (not when it breaches).
export function onKilled(state, e) {
  if (e.kind !== 'deadlock' || e.link == null) return;
  const partner = state.enemies.find((x) => x.id === e.link && !x.dead);
  if (partner) {
    state.pendingRespawns.push({ at: state.t + 2, partnerId: partner.id, x: e.x, dy: e.y - partner.y, maxHp: e.maxHp });
  }
}

function resolveDeadlocks(state) {
  const keep = [];
  for (const p of state.pendingRespawns) {
    const partner = state.enemies.find((x) => x.id === p.partnerId && !x.dead);
    if (!partner) continue; // both halves died inside the window
    if (state.t < p.at) { keep.push(p); continue; }
    const r = makeEnemy(state, 'deadlock', p.x, partner.y + p.dy);
    r.hp = r.maxHp = p.maxHp;
    r.link = partner.id;
    partner.link = r.id;
    state.enemies.push(r);
  }
  state.pendingRespawns = keep;
}

function spawnDependencyCopy(state, e) {
  if (state.enemies.filter((x) => x.kind === 'dependency' && !x.dead).length >= DEPENDENCY_CAP) return;
  const side = e.id % 2 ? 1 : -1;
  let x = e.x + side * COL_W;
  if (x < 0 || x + e.w > W) x = e.x - side * COL_W;
  const copy = makeEnemy(state, 'dependency', x, e.y - e.h - 6);
  copy.hp = copy.maxHp = e.maxHp;
  state.enemies.push(copy);
}

// Moves, phases, reveals and breaches non-boss enemies. Returns error budget burned.
export function updateEnemies(state, dt) {
  const revealLine = DANGER_Y - REVEAL_BASE - state.mods.reveal;
  const fall = state.stageDef.speed * dt;
  let burned = 0;
  // A snapshot, so copies spawned this step don't tick (and copy themselves) until the next.
  for (const e of state.enemies.slice()) {
    if (e.dead || e.boss) continue;
    if (!state.seen.includes(e.kind)) {
      state.seen.push(e.kind);
      state.events.push({ type: 'intro', kind: e.kind });
    }
    if (!e.static) e.y += fall;
    if (e.kind === 'flaky') e.phased = state.t >= e.pinnedUntil && (state.t + e.phaseOffset) % 1.6 > 1.0;
    if (!e.revealed && e.y + e.h >= revealLine) e.revealed = true;
    if (e.kind === 'dependency') {
      e.spawnTimer -= dt;
      if (e.spawnTimer <= 0) { e.spawnTimer = 3.5; spawnDependencyCopy(state, e); }
    }
    if (e.y + e.h >= DANGER_Y) {
      e.dead = true;
      burned += e.budget;
    }
  }
  resolveDeadlocks(state);
  state.enemies = state.enemies.filter((e) => !e.dead);
  return burned;
}
```

- [ ] **Step 4: Run**

Run: `cd game && node --test test/*.test.js`
Expected: all pass (Task 3 tests still pass with the moved `isTargetable`/`lowestTarget`).

- [ ] **Step 5: Commit**

```bash
git add game/src/enemies.js game/test/enemies.test.js
git commit -m "Add enemy kinds: flaky phasing, silent defects, deadlocks, dependencies

Claude-Session: https://claude.ai/code/session_019Gn4ESpBQMBXM6ugLwTT3t"
```

---

### Task 5: Wave spawner and bosses

**Files:**
- Create: `game/src/stages.js`, `game/src/bosses.js`
- Create: `game/test/stages.test.js`, `game/test/bosses.test.js`

**Interfaces:**
- Consumes: `enemies.makeEnemy`, `colX`, `spawnDeadlockPair`; `world.js`.
- Produces (`stages.js`): `stageRate(state)`, `rowY(state)`, `spawnRow(state, rng)`, `updateSpawner(state, dt, rng)`.
- Produces (`bosses.js`): `BOSS_TOP=64`, `spawnBoss(state) -> boss enemy` (sets `state.boss = {id, def, pendingMerge}`), `updateBosses(state, dt)`, `afterBossHit(state, e)`, `onBossKilled(state, e) -> boolean` (true = fight over).
- Boss enemy: an enemy with `kind:'boss'`, `boss:<id>`, `name`, `static:true`, `dir`, plus per-boss fields (`canSplit`, `replica`, `baseHp`, `migrationWeak`, `phase`, `shielded`, `side`, `switchAt`).

- [ ] **Step 1: Write failing tests**

`game/test/stages.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnRow, updateSpawner, rowY, stageRate } from '../src/stages.js';
import { makeRng } from '../src/rng.js';
import { COL_W } from '../src/world.js';
import { fixtureState } from './helpers.js';

const cols = (s) => s.enemies.map((e) => Math.floor((e.x + 1) / COL_W));

test('a row places rowMin..rowMax enemies in distinct columns', () => {
  for (let seed = 1; seed < 30; seed++) {
    const s = fixtureState(seed);
    spawnRow(s, makeRng(seed));
    assert.ok(s.enemies.length >= 2 && s.enemies.length <= 3);
    assert.equal(new Set(cols(s)).size, s.enemies.length);
  }
});

test('idle capacity takes two columns and deadlocks come in pairs', () => {
  for (let seed = 1; seed < 40; seed++) {
    const s = fixtureState(seed);
    s.stageDef = { ...s.stageDef, rowMin: 3, rowMax: 3, mix: { idle: 1, deadlock: 1 } };
    spawnRow(s, makeRng(seed));
    const deadlocks = s.enemies.filter((e) => e.kind === 'deadlock');
    assert.equal(deadlocks.length % 2, 0);
    for (const e of s.enemies.filter((x) => x.kind === 'idle')) assert.equal(Math.round(e.x + e.w / 2) % (2 * COL_W), COL_W);
  }
});

test('a spike replaces the next row with a full row of requests', () => {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, spikeEvery: 5 };
  s.spikeTimer = 0.01;
  s.spawnTimer = 0.02;
  updateSpawner(s, 0.05, s.rng);
  assert.equal(s.enemies.length, 8);
  assert.ok(s.enemies.every((e) => e.kind === 'request'));
});

test('rows spawn below the boss during a fight, and rate ramps with stage time', () => {
  const s = fixtureState();
  assert.equal(rowY(s), -30);
  s.boss = { id: 'x' };
  assert.equal(rowY(s), 150);
  s.boss = null;
  s.stageDef = { ...s.stageDef, ramp: 1, duration: 10 };
  s.stageTime = 10;
  assert.equal(stageRate(s), 2);
});
```

`game/test/bosses.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnBoss, updateBosses, afterBossHit, onBossKilled } from '../src/bosses.js';
import { W } from '../src/world.js';
import { fixtureState } from './helpers.js';

function withBoss(id) {
  const s = fixtureState();
  s.stageDef = { ...s.stageDef, boss: id };
  const e = spawnBoss(s);
  return { s, e };
}
const alive = (s) => s.enemies.filter((x) => x.boss && !x.dead);

test('the sync conflict splits at half health into two replicas', () => {
  const { s, e } = withBoss('sync-conflict');
  e.hp = 50;
  afterBossHit(s, e);
  assert.equal(alive(s).length, 2);
  assert.ok(alive(s).every((x) => x.replica && x.hp === 25));
});

test('a lone replica re-merges after 6 s; killing both in time ends the fight', () => {
  const { s, e } = withBoss('sync-conflict');
  e.hp = 50;
  afterBossHit(s, e);
  const [a, b] = alive(s);
  a.dead = true;
  assert.equal(onBossKilled(s, a), false);
  s.t = 6.1;
  updateBosses(s, 0);
  assert.equal(alive(s).length, 2);
  assert.ok(alive(s).every((x) => x.hp === x.maxHp));
  const [c, d] = alive(s);
  c.dead = true;
  assert.equal(onBossKilled(s, c), false);
  d.dead = true;
  assert.equal(onBossKilled(s, d), true);
  assert.equal(s.boss.pendingMerge, null);
});

test('the invoice grows over time up to three times its base', () => {
  const { s, e } = withBoss('managed-host-invoice');
  updateBosses(s, 10);
  assert.ok(Math.abs(e.hp - 115) < 1e-9);
  updateBosses(s, 1000);
  assert.equal(e.hp, 300);
  assert.equal(e.migrationWeak, true);
});

test('drupal is shielded by modules and upgrades through three phases', () => {
  const { s, e } = withBoss('drupal-upgrade');
  const modules = () => s.enemies.filter((x) => x.shieldOf === e.id && !x.dead);
  assert.equal(modules().length, 8);
  updateBosses(s, 0);
  assert.equal(e.shielded, true);
  for (const m of modules()) m.dead = true;
  updateBosses(s, 0);
  assert.equal(e.shielded, false);
  e.dead = true;
  assert.equal(onBossKilled(s, e), false);
  assert.equal(e.dead, false);
  assert.equal(e.name, 'Drupal 9');
  assert.equal(modules().length, 8);
  e.dead = true;
  assert.equal(onBossKilled(s, e), false);
  e.dead = true;
  assert.equal(onBossKilled(s, e), true);
});

test('the cutover moves between halves every 8 s', () => {
  const { s, e } = withBoss('hard-cutover');
  s.t = 8.01;
  updateBosses(s, 0);
  assert.equal(e.x, W * 0.75 - e.w / 2);
  assert.ok(s.events.some((x) => x.type === 'banner' && x.text === 'Cutover'));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd game && node --test test/stages.test.js test/bosses.test.js`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`game/src/stages.js`:

```js
import { COLS, COL_W } from './world.js';
import { makeEnemy, colX, spawnDeadlockPair } from './enemies.js';

export function stageRate(state) {
  const s = state.stageDef;
  const ramp = 1 + (s.ramp ?? 0) * Math.min(1, state.stageTime / s.duration);
  return state.boss ? ramp * (s.bossRate ?? 0.5) : ramp;
}

// During a boss fight rows appear below the boss (and Drupal's shield row).
export const rowY = (state) => (state.boss ? 150 : -30);

export function updateSpawner(state, dt, rng) {
  const s = state.stageDef;
  if (s.spikeEvery) {
    state.spikeTimer -= dt;
    if (state.spikeTimer <= 0) { state.spikeTimer += s.spikeEvery; state.spikeDue = true; }
  }
  state.spawnTimer -= dt * stageRate(state);
  if (state.spawnTimer <= 0) {
    state.spawnTimer += s.spawnEvery;
    if (state.spikeDue) { state.spikeDue = false; spawnSpike(state); } else spawnRow(state, rng);
  }
}

function spawnSpike(state) {
  const w = state.design.enemies.request.w ?? 52;
  for (let c = 0; c < COLS; c++) {
    state.enemies.push(makeEnemy(state, 'request', colX(c, w), rowY(state), { hpScale: state.stageDef.hpScale }));
  }
}

export function spawnRow(state, rng) {
  const s = state.stageDef;
  const free = new Set([...Array(COLS).keys()]);
  const kinds = Object.keys(s.mix);
  const count = rng.int(s.rowMin, s.rowMax);
  const y = rowY(state);
  for (let placed = 0; placed < count && free.size; placed++) {
    const col = rng.pick([...free]);
    let kind = rng.weighted(kinds, (k) => s.mix[k]);
    if (kind === 'idle' && !(col % 2 === 0 && free.has(col + 1))) kind = 'request';
    if (kind === 'deadlock' && !free.has(col + 1) && !free.has(col - 1)) kind = 'request';
    free.delete(col);
    if (kind === 'idle') {
      free.delete(col + 1);
      const w = state.design.enemies.idle.w;
      state.enemies.push(makeEnemy(state, 'idle', col * COL_W + (2 * COL_W - w) / 2, y, { hpScale: s.hpScale }));
    } else if (kind === 'deadlock') {
      const other = free.has(col + 1) ? col + 1 : col - 1;
      free.delete(other);
      spawnDeadlockPair(state, col, other, y, s.hpScale);
    } else {
      const w = state.design.enemies[kind].w ?? 52;
      state.enemies.push(makeEnemy(state, kind, colX(col, w), y, { hpScale: s.hpScale }));
    }
  }
}
```

`game/src/bosses.js`:

```js
import { COLS, W } from './world.js';
import { makeEnemy, colX } from './enemies.js';

export const BOSS_TOP = 64;
const MERGE_WINDOW = 6;
const CUTOVER_EVERY = 8;
const DRUPAL_PHASES = ['Drupal 8', 'Drupal 9', 'Drupal 10'];

function entity(state, def, w, hp) {
  return {
    id: state.nextId++, kind: 'boss', boss: def.id, name: def.name,
    x: (W - w) / 2, y: BOSS_TOP, w, h: 44, hp, maxHp: hp,
    budget: 0, xp: 0, armored: false, revealed: true, traced: false, phased: false, pinnedUntil: 0,
    static: true, shieldOf: null, link: null, dead: false, dir: 1, shielded: false, migrationWeak: false,
  };
}

export function spawnBoss(state) {
  const def = state.design.bosses.find((b) => b.id === state.stageDef.boss);
  let e;
  switch (def.id) {
    case 'sync-conflict':
      e = entity(state, def, 150, def.hp);
      e.canSplit = true;
      break;
    case 'managed-host-invoice':
      e = entity(state, def, 120, def.hp);
      e.baseHp = def.hp;
      e.migrationWeak = true;
      break;
    case 'drupal-upgrade':
      e = entity(state, def, 170, def.hp / 3);
      e.phase = 0;
      e.name = DRUPAL_PHASES[0];
      break;
    case 'hard-cutover':
      e = entity(state, def, 140, def.hp);
      e.side = 0;
      e.switchAt = state.t + CUTOVER_EVERY;
      break;
    default:
      throw new Error(`unknown boss ${def.id}`);
  }
  state.enemies.push(e);
  state.boss = { id: def.id, def, pendingMerge: null };
  if (def.id === 'drupal-upgrade') spawnShield(state, e);
  return e;
}

function spawnShield(state, boss) {
  const w = state.design.enemies.module.w ?? 52;
  for (let c = 0; c < COLS; c++) {
    state.enemies.push(makeEnemy(state, 'module', colX(c, w), boss.y + boss.h + 14,
      { static: true, shieldOf: boss.id, hpScale: state.stageDef.hpScale }));
  }
}

function sway(e, speed, dt) {
  if (!speed) return;
  e.x += e.dir * speed * dt;
  if (e.x < 8) { e.x = 8; e.dir = 1; }
  if (e.x + e.w > W - 8) { e.x = W - 8 - e.w; e.dir = -1; }
}

export function updateBosses(state, dt) {
  for (const e of state.enemies) {
    if (!e.boss || e.dead) continue;
    switch (e.boss) {
      case 'sync-conflict':
        sway(e, e.replica ? 70 : 45, dt);
        break;
      case 'managed-host-invoice': {
        e.hp = Math.min(e.baseHp * 3, e.hp + e.baseHp * 0.015 * dt);
        e.maxHp = Math.max(e.maxHp, e.hp);
        const cx = e.x + e.w / 2;
        e.w = Math.min(260, 120 * Math.sqrt(e.maxHp / e.baseHp));
        e.x = Math.max(8, Math.min(W - 8 - e.w, cx - e.w / 2));
        sway(e, 30, dt);
        break;
      }
      case 'drupal-upgrade':
        e.shielded = state.enemies.some((x) => x.shieldOf === e.id && !x.dead);
        sway(e, [0, 50, 110][e.phase], dt);
        break;
      case 'hard-cutover':
        if (state.t >= e.switchAt) {
          e.side ^= 1;
          e.switchAt = state.t + CUTOVER_EVERY;
          e.x = (e.side ? W * 0.75 : W * 0.25) - e.w / 2;
          state.events.push({ type: 'banner', text: 'Cutover', sub: e.side ? 'Traffic on the new account' : 'Traffic on the legacy account' });
        }
        break;
    }
  }
  const m = state.boss?.pendingMerge;
  if (m && state.t >= m.at) {
    const survivor = state.enemies.find((x) => x.id === m.survivorId && !x.dead);
    if (survivor) {
      survivor.hp = survivor.maxHp;
      state.enemies.push({ ...survivor, id: state.nextId++, x: m.x, dir: -survivor.dir });
      state.events.push({ type: 'banner', text: 'Re-merged', sub: 'Kill both replicas inside the window' });
    }
    state.boss.pendingMerge = null;
  }
}

export function afterBossHit(state, e) {
  if (e.boss === 'sync-conflict' && e.canSplit && e.hp <= e.maxHp / 2) {
    const half = e.hp / 2;
    e.canSplit = false;
    e.replica = true;
    e.w = 100;
    e.hp = e.maxHp = half;
    e.dir = -1;
    state.enemies.push({ ...e, id: state.nextId++, x: Math.min(W - 108, e.x + 110), dir: 1 });
    state.events.push({ type: 'banner', text: 'Split brain', sub: 'Kill both replicas before they re-merge' });
  }
}

// Called after e.dead is set. Returns true when the whole fight is over.
export function onBossKilled(state, e) {
  switch (e.boss) {
    case 'sync-conflict': {
      const other = state.enemies.find((x) => x.boss === e.boss && !x.dead && x.id !== e.id);
      if (other) {
        state.boss.pendingMerge = { at: state.t + MERGE_WINDOW, survivorId: other.id, x: e.x };
        return false;
      }
      state.boss.pendingMerge = null;
      return true;
    }
    case 'drupal-upgrade':
      if (e.phase < DRUPAL_PHASES.length - 1) {
        e.dead = false;
        e.phase += 1;
        e.hp = e.maxHp;
        e.name = DRUPAL_PHASES[e.phase];
        spawnShield(state, e);
        state.events.push({ type: 'banner', text: `Upgraded to ${e.name}`, sub: 'New modules, new shield' });
        return false;
      }
      return true;
    default:
      return true;
  }
}
```

- [ ] **Step 4: Run**

Run: `cd game && node --test test/*.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add game/src/stages.js game/src/bosses.js game/test/stages.test.js game/test/bosses.test.js
git commit -m "Add the wave spawner and the four career bosses

Claude-Session: https://claude.ai/code/session_019Gn4ESpBQMBXM6ugLwTT3t"
```

---

### Task 6: Level-up cards and the postmortem

**Files:**
- Create: `game/src/cards.js`, `game/src/postmortem.js`
- Create: `game/test/cards.test.js`, `game/test/postmortem.test.js`

**Interfaces:**
- Consumes: `balls.MAX_LEVEL`, `MAX_KINDS`, `kindInfo`, `rebuildSlots`; `fusion.eligibleFusions`, `applyFusion`.
- Produces (`cards.js`): `newMods(design)`, `tagEffects(tags, weight, design)`, `describeEffects(effects, design) -> string[]`, `applyEffects(state, effects)`, `ballOffers(state)`, `bulletPool(state)`, `drawCards(state, rng) -> card[]`, `applyCard(state, card)`, `cardTitle(card, state)`, `cardView(card, state) -> {kicker, title, sub, text, quote, chips}`, `citedText(data, id)`, `years(start, end)`.
- Card shapes: `{type:'bullet', bullet, role, effects}`, `{type:'ball', kind, level}`, `{type:'fusion', fusion}`.
- Produces (`postmortem.js`): `newStats()`, `log(state, kind, text)`, `noteBudget(state)`, `fmtClock(s)`, `summarize(state)`, `loadBest(storage)`, `saveBest(storage, summary)`.
- Summary shape: `{outcome, stageReached, stages, duration, deploys, changeFailureRate, timeToRestore|null, leadTime|null, kills, level, timeline:[{clock,kind,text}], detailed, picks:[{role, employer, bullets:[text]}]}`.

- [ ] **Step 1: Write failing tests**

`game/test/cards.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { tagEffects, describeEffects, applyCard, drawCards, ballOffers, bulletPool, cardView, citedText, years } from '../src/cards.js';
import { makeRng } from '../src/rng.js';
import { fixtureState } from './helpers.js';

test('tag effects scale with weight and ignore tags without effects', () => {
  const s = fixtureState();
  assert.deepEqual(tagEffects(['ci-cd', 'nope'], 5, s.design), { fireRate: 0.25 });
});

test('describeEffects formats each mod', () => {
  const s = fixtureState();
  s.design.mods.regen.format = 'rate';
  s.design.mods.reveal.format = 'px';
  assert.deepEqual(describeEffects({ fireRate: 0.25, regen: 0.05, reveal: 36, docs: 3 }, s.design),
    ['+25% fireRate', '+0.05/s regen', '+36px reveal', 'docs']);
});

test('a bullet card applies effects, raises the budget, and retires its alt group', () => {
  const s = fixtureState();
  const b3 = s.data.roles[0].bullets[2];
  applyCard(s, { type: 'bullet', bullet: b3, role: s.data.roles[0], effects: tagEffects(b3.tags, b3.weight, s.design) });
  assert.ok(Math.abs(s.maxBudget - 21.8) < 1e-9);
  assert.ok(Math.abs(s.budget - 21.8) < 1e-9);
  assert.ok(s.mods.docs > 0);
  assert.deepEqual(s.picks, ['b3']);
  assert.deepEqual(bulletPool(s).map((c) => c.bullet.id), ['b1']);
});

test('the first level-up always offers a tool; cards are distinct', () => {
  for (let seed = 1; seed < 20; seed++) {
    const s = fixtureState(seed);
    const cards = drawCards(s, makeRng(seed));
    assert.equal(cards.length, 3);
    assert.ok(cards.some((c) => c.type === 'ball'));
    const alts = cards.filter((c) => c.type === 'bullet' && c.bullet.alt).map((c) => c.bullet.alt);
    assert.equal(new Set(alts).size, alts.length);
  }
});

test('an eligible fusion is usually offered', () => {
  const s = fixtureState();
  s.inventory = { lambda: 3, terraform: 3 };
  s.cardsPicked = 1;
  let offered = 0;
  for (let seed = 1; seed < 50; seed++) if (drawCards(s, makeRng(seed)).some((c) => c.type === 'fusion')) offered++;
  assert.ok(offered > 30);
});

test('ball offers respect max level and the five-kind cap', () => {
  const s = fixtureState();
  s.inventory = { bash: 3, lambda: 3, datadog: 3, terraform: 3, oidc: 2 };
  assert.deepEqual(ballOffers(s), [{ type: 'ball', kind: 'oidc', level: 3 }]);
});

test('exhausted pools yield no cards', () => {
  const s = fixtureState();
  s.inventory = { bash: 3, lambda: 3, datadog: 3, oidc: 3, cypress: 3 };
  s.picks = ['b1', 'b2', 'b3'];
  s.cardsPicked = 3;
  assert.deepEqual(drawCards(s, makeRng(1)), []);
});

test('card views quote the bullet and name the role', () => {
  const s = fixtureState();
  const [c] = bulletPool(s);
  const v = cardView(c, s);
  assert.equal(v.text, c.bullet.text);
  assert.equal(v.title, 'Engineer, Acme');
  assert.equal(v.sub, '2020–present');
  const f = cardView({ type: 'fusion', fusion: s.design.fusions[1] }, s);
  assert.equal(f.quote, 'Proj: A project');
});

test('citedText and years', () => {
  const s = fixtureState();
  assert.equal(citedText(s.data, 'b1'), 'Did a thing');
  assert.equal(citedText(s.data, 'missing'), '');
  assert.equal(years('2012-01', '2015-12'), '2012–2015');
  assert.equal(years('2024-02', '2024-09'), '2024');
});
```

`game/test/postmortem.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtClock, noteBudget, log, summarize, loadBest, saveBest } from '../src/postmortem.js';
import { fixtureState } from './helpers.js';

test('fmtClock', () => {
  assert.equal(fmtClock(0), '0:00');
  assert.equal(fmtClock(61.9), '1:01');
  assert.equal(fmtClock(-3), '0:00');
});

test('time to restore is measured from first loss to full budget', () => {
  const s = fixtureState();
  s.t = 10; s.budget = 19; noteBudget(s);
  s.t = 14; s.budget = 20; noteBudget(s);
  assert.deepEqual(s.stats.restores, [4]);
});

test('budget thresholds log once until recovered', () => {
  const s = fixtureState();
  s.budget = 14; noteBudget(s);
  s.budget = 13; noteBudget(s);
  assert.equal(s.stats.timeline.filter((e) => e.kind === 'budget').length, 1);
  s.budget = 17; noteBudget(s);
  s.budget = 14; noteBudget(s);
  assert.equal(s.stats.timeline.filter((e) => e.kind === 'budget').length, 2);
});

test('summary: change failure rate, filtered timeline, grouped picks', () => {
  const s = fixtureState();
  s.outcome = 'met';
  s.stats.shots = 8; s.stats.balls = 10; s.stats.misses = 3;
  log(s, 'stage', 'Stage 1');
  log(s, 'card', 'Merged');
  s.picks = ['b1'];
  const sum = summarize(s);
  assert.equal(sum.deploys, 8);
  assert.equal(sum.changeFailureRate, 0.3);
  assert.deepEqual(sum.timeline.map((e) => e.text), ['Stage 1']);
  assert.deepEqual(sum.picks, [{ role: 'Engineer', employer: 'Acme (contract)', bullets: ['Did a thing'] }]);
  s.mods.docs = 1;
  assert.equal(summarize(s).timeline.length, 2);
});

test('best-run storage keeps the better run', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveBest(storage, { outcome: 'breached', stageReached: 2 });
  saveBest(storage, { outcome: 'breached', stageReached: 1 });
  assert.deepEqual(loadBest(storage), { outcome: 'breached', stageReached: 2 });
  saveBest(storage, { outcome: 'met', stageReached: 4 });
  assert.equal(loadBest(storage).outcome, 'met');
});

test('best-run storage survives a throwing storage', () => {
  const storage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(loadBest(storage), null);
  assert.deepEqual(saveBest(storage, { outcome: 'met', stageReached: 4 }), { outcome: 'met', stageReached: 4 });
  assert.equal(loadBest(null), null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd game && node --test test/cards.test.js test/postmortem.test.js`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`game/src/cards.js`:

```js
import { MAX_LEVEL, MAX_KINDS, kindInfo, rebuildSlots } from './balls.js';
import { eligibleFusions, applyFusion } from './fusion.js';

export const newMods = (design) => Object.fromEntries(Object.keys(design.mods).map((k) => [k, 0]));

export function tagEffects(tags, weight, design) {
  const out = {};
  for (const tag of tags) {
    for (const [mod, per] of Object.entries(design.tag_effects[tag] ?? {})) out[mod] = (out[mod] ?? 0) + per * weight;
  }
  return out;
}

const FORMATS = {
  pct: (v) => `+${Math.round(v * 100)}%`,
  rate: (v) => `+${v.toFixed(2)}/s`,
  px: (v) => `+${Math.round(v)}px`,
  num: (v) => `+${Math.round(v * 10) / 10}`,
  frac: (v) => `+${v.toFixed(1)}`,
};

export function describeEffects(effects, design) {
  return Object.entries(effects).map(([mod, v]) => {
    const { label, format } = design.mods[mod];
    return format === 'flag' ? label : `${FORMATS[format](v)} ${label}`;
  });
}

export function applyEffects(state, effects) {
  for (const [mod, v] of Object.entries(effects)) state.mods[mod] += v;
  if (effects.maxBudget) {
    state.maxBudget += effects.maxBudget;
    state.budget += effects.maxBudget;
  }
}

export function ballOffers(state) {
  const full = Object.keys(state.inventory).length >= MAX_KINDS;
  return state.design.balls
    .filter((b) => b.offer !== false)
    .map((b) => ({ b, lvl: state.inventory[b.id] ?? 0 }))
    .filter(({ lvl }) => lvl < MAX_LEVEL && (lvl > 0 || !full))
    .map(({ b, lvl }) => ({ type: 'ball', kind: b.id, level: lvl + 1 }));
}

export function bulletPool(state) {
  const make = (roles) => roles.flatMap((role) => role.bullets
    .filter((b) => !state.picks.includes(b.id) && !(b.alt && state.pickedAlts.includes(b.alt)))
    .map((bullet) => ({ type: 'bullet', bullet, role, effects: tagEffects(bullet.tags, bullet.weight, state.design) })));
  const pool = make(state.data.roles.filter((r) => state.stageDef.roles.includes(r.id)));
  return pool.length >= 2 ? pool : make(state.data.roles);
}

const take = (arr, rng) => arr.splice(Math.floor(rng.next() * arr.length), 1)[0];

export function drawCards(state, rng) {
  const cards = [];
  const fusions = eligibleFusions(state);
  if (fusions.length && rng.next() < 0.8) cards.push({ type: 'fusion', fusion: rng.pick(fusions) });
  const balls = ballOffers(state);
  if (balls.length && (state.cardsPicked === 0 || rng.next() < 0.45)) cards.push(take(balls, rng));
  const pool = bulletPool(state);
  while (cards.length < 3 && pool.length) {
    const c = rng.weighted(pool, (x) => x.bullet.weight);
    pool.splice(pool.indexOf(c), 1);
    if (c.bullet.alt && cards.some((x) => x.type === 'bullet' && x.bullet.alt === c.bullet.alt)) continue;
    cards.push(c);
  }
  while (cards.length < 3 && balls.length) cards.push(take(balls, rng));
  return cards;
}

export function applyCard(state, card) {
  if (card.type === 'bullet') {
    applyEffects(state, card.effects);
    state.picks.push(card.bullet.id);
    if (card.bullet.alt) state.pickedAlts.push(card.bullet.alt);
  } else if (card.type === 'ball') {
    state.inventory[card.kind] = card.level;
  } else if (card.type === 'fusion') {
    applyFusion(state, card.fusion);
  }
  state.cardsPicked += 1;
  rebuildSlots(state);
}

export function cardTitle(card, state) {
  if (card.type === 'bullet') return `Merged a PR: ${card.role.title}`;
  if (card.type === 'fusion') return `Designed ${card.fusion.name}`;
  const { name } = kindInfo(card.kind, state.design);
  return card.level > 1 ? `Upgraded ${name} to level ${card.level}` : `Adopted ${name}`;
}

export function years(start, end) {
  const y = (s) => (s === 'present' ? 'present' : s.slice(0, 4));
  return y(start) === y(end) ? y(start) : `${y(start)}–${y(end)}`;
}

export function citedText(data, id) {
  for (const r of data.roles) for (const b of r.bullets) if (b.id === id) return b.text;
  const p = data.projects.find((x) => x.id === id);
  return p ? `${p.name}: ${p.text}` : '';
}

export function cardView(card, state) {
  if (card.type === 'bullet') {
    return {
      kicker: 'Merge a PR',
      title: `${card.role.title}, ${card.role.employer.split(' (')[0]}`,
      sub: years(card.role.start, card.role.end),
      text: card.bullet.text,
      quote: null,
      chips: describeEffects(card.effects, state.design),
    };
  }
  if (card.type === 'fusion') {
    const f = card.fusion;
    const parts = f.parts.map((p) => kindInfo(p, state.design).name).join(' + ');
    return { kicker: 'System design', title: f.name, sub: parts, text: f.blurb, quote: citedText(state.data, f.cites[0]), chips: [] };
  }
  const info = kindInfo(card.kind, state.design);
  return {
    kicker: card.level > 1 ? 'Upgrade a tool' : 'Adopt a tool',
    title: `${info.name} · level ${card.level}`,
    sub: null, text: info.blurb, quote: null, chips: [],
  };
}
```

`game/src/postmortem.js`:

```js
const THRESHOLDS = [0.75, 0.5, 0.25];
const HEADLINE = new Set(['stage', 'boss', 'fusion', 'outcome']);
const BEST_KEY = 'error-budget.best';

export function newStats() {
  return { shots: 0, balls: 0, misses: 0, kills: 0, firstBossAt: null, degradedSince: null, restores: [], crossed: [], timeline: [] };
}

export function log(state, kind, text) {
  state.stats.timeline.push({ t: state.t, kind, text });
}

export function noteBudget(state) {
  const s = state.stats;
  const f = state.budget / state.maxBudget;
  const full = f >= 1 - 1e-9;
  if (!full && s.degradedSince === null) s.degradedSince = state.t;
  if (full && s.degradedSince !== null) {
    s.restores.push(state.t - s.degradedSince);
    s.degradedSince = null;
  }
  for (const th of THRESHOLDS) {
    const key = String(th);
    if (f < th && !s.crossed.includes(key)) {
      s.crossed.push(key);
      log(state, 'budget', `Error budget below ${th * 100}%`);
    } else if (f >= th + 0.05 && s.crossed.includes(key)) {
      s.crossed = s.crossed.filter((k) => k !== key);
    }
  }
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function summarize(state) {
  const s = state.stats;
  const detailed = state.mods.docs > 0;
  const events = detailed ? s.timeline : s.timeline.filter((e) => HEADLINE.has(e.kind));
  const picks = [];
  for (const role of state.data.roles) {
    const bullets = role.bullets.filter((b) => state.picks.includes(b.id)).map((b) => b.text);
    if (bullets.length) picks.push({ role: role.title, employer: role.employer, bullets });
  }
  return {
    outcome: state.outcome,
    stageReached: state.stageIndex + 1,
    stages: state.design.stages.length,
    duration: fmtClock(state.t),
    deploys: s.shots,
    changeFailureRate: s.balls ? s.misses / s.balls : 0,
    timeToRestore: s.restores.length ? s.restores.reduce((a, b) => a + b, 0) / s.restores.length : null,
    leadTime: s.firstBossAt,
    kills: s.kills,
    level: state.level,
    timeline: events.map((e) => ({ clock: fmtClock(e.t), kind: e.kind, text: e.text })),
    detailed,
    picks,
  };
}

export function loadBest(storage) {
  try {
    const raw = storage?.getItem(BEST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveBest(storage, summary) {
  const score = (x) => x.stageReached + (x.outcome === 'met' ? 10 : 0);
  const best = loadBest(storage);
  if (best && score(best) >= score(summary)) return best;
  const next = { outcome: summary.outcome, stageReached: summary.stageReached };
  try {
    storage?.setItem(BEST_KEY, JSON.stringify(next));
  } catch {
    // Private browsing or blocked storage: the run still counts, it just isn't remembered.
  }
  return next;
}
```

- [ ] **Step 4: Run**

Run: `cd game && node --test test/*.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add game/src/cards.js game/src/postmortem.js game/test/cards.test.js game/test/postmortem.test.js
git commit -m "Add résumé-bullet level-up cards and the run postmortem

Claude-Session: https://claude.ai/code/session_019Gn4ESpBQMBXM6ugLwTT3t"
```

---

### Task 7: The engine

**Files:**
- Create: `game/src/engine.js`
- Create: `game/test/engine.test.js`

**Interfaces:**
- Consumes: every pure module above.
- Produces: `BASE_BUDGET=20`, `FIRE_INTERVAL=0.14`, `INTRO_TIME=2.5`, `CLEAR_TIME=2.5`, `newRun(data, seed) -> state`, `step(state, dt, input)`, `chooseCard(state, index)`.
- `input`: `{ aim?: {x,y}, moveX?: number|null, moveDir?: -1|0|1, fire?: boolean (default true) }`.
- `state.phase`: `'intro' | 'play' | 'levelup' | 'clear' | 'over'`. `state.outcome`: `null | 'met' | 'breached'`.
- `state.events` (drained by the caller): `stage{index}`, `intro{kind|boss}`, `fire`, `hit{x,y,kind,cached}`, `block{x,y}`, `kill{x,y,kind}`, `breach{amount}`, `levelup`, `clear{index}`, `banner{text,sub}`, `over{outcome}`.

- [ ] **Step 1: Write failing tests**

`game/test/engine.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { newRun, step, chooseCard, INTRO_TIME, CLEAR_TIME } from '../src/engine.js';
import { STEP, W } from '../src/world.js';
import { fixtureData, rect } from './helpers.js';

const run = (seconds, s, input = {}) => {
  for (let t = 0; t < seconds; t += STEP) {
    step(s, STEP, input);
    if (s.phase === 'over' || s.phase === 'levelup') break;
  }
};
const playing = (seed = 1) => {
  const s = newRun(fixtureData(), seed);
  run(INTRO_TIME + 0.01, s, { fire: false });
  return s;
};

test('a run starts in the stage intro with the start ball and full budget', () => {
  const s = newRun(fixtureData(), 1);
  assert.equal(s.phase, 'intro');
  assert.deepEqual(s.slots.map((x) => x.kind), ['bash']);
  assert.equal(s.budget, 20);
  assert.deepEqual(s.events[0], { type: 'stage', index: 0 });
  run(INTRO_TIME + 0.01, s, { fire: false });
  assert.equal(s.phase, 'play');
});

test('a fired ball comes back and refills its slot; a clean miss counts as a failure', () => {
  const s = playing();
  s.stageDef = { ...s.stageDef, spawnEvery: 999 };
  s.spawnTimer = 999;
  step(s, STEP, { aim: { x: s.player.x, y: 0 } });
  assert.equal(s.balls.length, 1);
  assert.equal(s.slots[0].out, 1);
  run(3, s, { fire: false });
  assert.equal(s.balls.length, 0);
  assert.equal(s.slots[0].out, 0);
  assert.equal(s.stats.misses, 1);
});

test('an expired slotted ball frees its slot', () => {
  const s = playing();
  s.spawnTimer = 999;
  step(s, STEP, {});
  s.balls[0].ttl = STEP / 2;
  step(s, STEP, { fire: false });
  assert.equal(s.balls.length, 0);
  assert.equal(s.slots[0].out, 0);
});

test('hitting an enemy damages it, and a kill grants XP', () => {
  const s = playing();
  s.spawnTimer = 999;
  s.enemies.push(rect(s, { x: s.player.x - 26, y: 300, hp: 5, maxHp: 5 }));
  step(s, STEP, { aim: { x: s.player.x, y: 0 } });
  run(1, s, { fire: false });
  assert.equal(s.stats.kills, 1);
  assert.ok(s.xp > 0);
});

test('the player moves toward moveX at a bounded speed and stays on screen', () => {
  const s = playing();
  step(s, 0.1, { moveX: W, fire: false });
  assert.ok(s.player.x > W / 2 && s.player.x < W / 2 + 40);
  run(3, s, { moveDir: 1, fire: false });
  assert.equal(s.player.x, W - 16);
});

test('a player who never fires breaches the SLO', () => {
  const s = playing();
  run(600, s, { fire: false });
  assert.equal(s.phase, 'over');
  assert.equal(s.outcome, 'breached');
  assert.equal(s.budget, 0);
  assert.equal(s.events.at(-1).type, 'over');
});

test('a level-up pauses play for three cards; picking resumes', () => {
  const s = playing();
  s.pendingLevels = 1;
  step(s, STEP, { fire: false });
  assert.equal(s.phase, 'levelup');
  assert.equal(s.cards.length, 3);
  const t = s.t;
  step(s, STEP, {});
  assert.equal(s.t, t);
  chooseCard(s, 0);
  assert.equal(s.phase, 'play');
  assert.equal(s.cardsPicked, 1);
});

test('a level-up with nothing to offer does not pause', () => {
  const s = playing();
  s.inventory = { bash: 3, lambda: 3, datadog: 3, oidc: 3, cypress: 3 };
  s.picks = ['b1', 'b2', 'b3'];
  s.cardsPicked = 3;
  s.pendingLevels = 1;
  step(s, STEP, { fire: false });
  assert.equal(s.phase, 'play');
  assert.equal(s.pendingLevels, 0);
});

test('the boss arrives after the stage duration; killing it clears the stage', () => {
  const s = playing();
  s.stageTime = s.stageDef.duration;
  step(s, STEP, { fire: false });
  const boss = s.enemies.find((e) => e.boss);
  assert.ok(boss);
  assert.equal(s.stats.firstBossAt, s.t);
  boss.hp = 1;
  boss.canSplit = false;
  s.enemies = [boss];
  step(s, STEP, { aim: { x: s.player.x, y: 0 } });
  run(2, s, { fire: false });
  assert.equal(s.phase, 'clear');
  run(CLEAR_TIME + INTRO_TIME + 0.1, s, { fire: false });
  assert.equal(s.stageIndex, 1);
});

test('clearing the last stage meets the SLO', () => {
  const s = playing();
  s.stageIndex = s.design.stages.length - 1;
  s.stageDef = s.design.stages[s.stageIndex];
  s.stageTime = s.stageDef.duration;
  step(s, STEP, { fire: false });
  const boss = s.enemies.find((e) => e.boss);
  boss.hp = 1;
  s.enemies = [boss];
  step(s, STEP, { aim: { x: s.player.x, y: 0 } });
  run(CLEAR_TIME + 3, s, { fire: false });
  assert.equal(s.phase, 'over');
  assert.equal(s.outcome, 'met');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd game && node --test test/engine.test.js`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `game/src/engine.js`:

```js
import { W, PLAYER_Y } from './world.js';
import { makeRng } from './rng.js';
import { bounceWalls, circleRect, reflect, keepSteep, clampUp, aimVector, setSpeed } from './physics.js';
import { BASE_SPEED, makeBall, traitsFor, hitDamage, applyHitEffects, steer, rebuildSlots } from './balls.js';
import { updateEnemies, solid, immune, onKilled, lowestTarget } from './enemies.js';
import { updateSpawner } from './stages.js';
import { spawnBoss, updateBosses, afterBossHit, onBossKilled } from './bosses.js';
import { newMods, drawCards, applyCard, cardTitle } from './cards.js';
import { newStats, log, noteBudget } from './postmortem.js';

export const BASE_BUDGET = 20;
export const FIRE_INTERVAL = 0.14;
export const INTRO_TIME = 2.5;
export const CLEAR_TIME = 2.5;
const PLAYER_SPEED = 380;
const MAX_EVENTS = 400;

export function newRun(data, seed = 1) {
  const design = data.design;
  const start = design.balls.find((b) => b.start).id;
  const state = {
    data, design, seed, rng: makeRng(seed),
    t: 0, nextId: 1, phase: 'intro', phaseTimer: INTRO_TIME,
    stageIndex: 0, stageDef: design.stages[0], stageTime: 0, spawnTimer: 0, spikeTimer: 0, spikeDue: false, boss: null,
    player: { x: W / 2, aim: { x: 0, y: -1 } },
    budget: BASE_BUDGET, maxBudget: BASE_BUDGET, mods: newMods(design),
    inventory: { [start]: 1 }, slots: [], slotCursor: 0, fireTimer: 0, teamTimer: 0,
    balls: [], enemies: [], pendingRespawns: [],
    xp: 0, level: 1, xpToNext: 8, pendingLevels: 0, cards: null, cardsPicked: 0,
    picks: [], pickedAlts: [], fused: [], seen: [],
    outcome: null, events: [], stats: newStats(),
  };
  rebuildSlots(state);
  enterStage(state, 0);
  return state;
}

function enterStage(state, index) {
  state.stageIndex = index;
  state.stageDef = state.design.stages[index];
  state.stageTime = 0;
  state.spawnTimer = 0.5;
  state.spikeTimer = state.stageDef.spikeEvery || 0;
  state.spikeDue = false;
  state.boss = null;
  state.phase = 'intro';
  state.phaseTimer = INTRO_TIME;
  state.events.push({ type: 'stage', index });
  log(state, 'stage', `Stage ${index + 1}: ${state.stageDef.employer}`);
}

export function step(state, dt, input = {}) {
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
  if (state.phase === 'levelup' || state.phase === 'over') return;
  state.t += dt;
  movePlayer(state, dt, input);
  updateBalls(state, dt);
  if (state.phase === 'intro' || state.phase === 'clear') {
    state.phaseTimer -= dt;
    if (state.phaseTimer <= 0) {
      if (state.phase === 'intro') state.phase = 'play';
      else if (state.stageIndex + 1 < state.design.stages.length) enterStage(state, state.stageIndex + 1);
      else finish(state, 'met');
    }
    return;
  }

  state.stageTime += dt;
  updateSpawner(state, dt, state.rng);
  if (state.boss) updateBosses(state, dt);
  else if (state.stageTime >= state.stageDef.duration) startBoss(state);
  if (input.fire !== false) {
    fire(state, dt);
    teammates(state, dt);
  }
  const burned = updateEnemies(state, dt);
  if (burned) {
    state.budget -= burned;
    state.events.push({ type: 'breach', amount: burned });
  }
  state.budget = Math.min(state.maxBudget, state.budget + state.mods.regen * dt);
  noteBudget(state);
  if (state.budget <= 0) {
    state.budget = 0;
    finish(state, 'breached');
    return;
  }
  if (state.pendingLevels > 0 && state.phase === 'play') openLevelUp(state);
}

export function chooseCard(state, index) {
  if (state.phase !== 'levelup') return;
  const card = state.cards[index];
  if (!card) return;
  applyCard(state, card);
  log(state, card.type === 'fusion' ? 'fusion' : 'card', cardTitle(card, state));
  state.pendingLevels -= 1;
  state.cards = null;
  state.phase = 'play';
  if (state.pendingLevels > 0) openLevelUp(state);
}

function openLevelUp(state) {
  const cards = drawCards(state, state.rng);
  if (!cards.length) {
    state.pendingLevels = 0;
    return;
  }
  state.cards = cards;
  state.phase = 'levelup';
  state.events.push({ type: 'levelup' });
}

function movePlayer(state, dt, input) {
  const p = state.player;
  if (input.moveX != null) {
    const d = input.moveX - p.x;
    p.x += Math.sign(d) * Math.min(Math.abs(d), PLAYER_SPEED * dt);
  }
  if (input.moveDir) p.x += input.moveDir * PLAYER_SPEED * dt;
  p.x = Math.max(16, Math.min(W - 16, p.x));
  if (input.aim) p.aim = aimVector(p.x, PLAYER_Y, input.aim.x, input.aim.y);
}

function fire(state, dt) {
  state.fireTimer -= dt;
  if (state.fireTimer > 0) return;
  const n = state.slots.length;
  for (let i = 0; i < n; i++) {
    const slot = state.slots[(state.slotCursor + i) % n];
    if (slot.out > 0) continue;
    state.slotCursor = (state.slotCursor + i + 1) % n;
    launch(state, slot);
    state.fireTimer = FIRE_INTERVAL / (1 + state.mods.fireRate);
    return;
  }
}

function launch(state, slot) {
  const traits = traitsFor(slot.kind, state.design);
  const level = state.inventory[slot.kind] ?? 1;
  const dir = state.player.aim;
  const x = state.player.x;
  const y = PLAYER_Y - 12;
  let n = 1;
  if (traits.has('matrix')) {
    const even = traits.has('evenSplit');
    n = (2 + level) * (even ? 2 : 1);
    const spread = even ? 1.4 : 0.14 * (n - 1);
    const base = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < n; i++) {
      const a = base - spread / 2 + (spread * i) / (n - 1);
      state.balls.push(makeBall(state, slot.kind, x, y, clampUp({ x: Math.cos(a), y: Math.sin(a) }),
        { traits, level, slot, dmgScale: 0.6, r: 4 }));
    }
  } else {
    state.balls.push(makeBall(state, slot.kind, x, y, dir, { traits, level, slot }));
  }
  slot.out += n;
  state.stats.shots += 1;
  state.stats.balls += n;
  state.events.push({ type: 'fire' });
}

function teammates(state, dt) {
  const n = Math.floor(state.mods.teammates);
  if (n <= 0) return;
  state.teamTimer -= dt;
  if (state.teamTimer > 0) return;
  state.teamTimer = 1.2 / n;
  const target = lowestTarget(state);
  const x = state.player.x + (state.rng.next() < 0.5 ? -28 : 28);
  const dir = target ? aimVector(x, PLAYER_Y, target.x + target.w / 2, target.y + target.h / 2) : { x: 0, y: -1 };
  state.balls.push(makeBall(state, 'mentee', x, PLAYER_Y - 8, dir, { level: 1, child: true, ttl: 4, dmgScale: 0.6, r: 4 }));
}

function release(state, b) {
  if (b.slot) b.slot.out = Math.max(0, b.slot.out - 1);
  if (!b.child && b.hits === 0) state.stats.misses += 1;
}

function updateBalls(state, dt) {
  const keep = [];
  // Iterating the live array on purpose: children spawned mid-loop move this step too.
  for (const b of state.balls) {
    b.ttl -= dt;
    if (b.ttl <= 0) { release(state, b); continue; }
    steer(state, b, dt);
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (bounceWalls(b)) { release(state, b); continue; }
    collide(state, b);
    keep.push(b);
  }
  state.balls = keep;
}

function collide(state, b) {
  for (const [id, until] of b.cooldowns) if (until <= state.t) b.cooldowns.delete(id);
  const pierce = b.traits.has('pierce');
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (!solid(e)) {
      if (b.traits.has('trace') && !e.revealed && circleRect(b, e)) e.revealed = true;
      continue;
    }
    if (b.cooldowns.has(e.id)) continue;
    const hit = circleRect(b, e);
    if (!hit) continue;
    if (pierce) b.cooldowns.set(e.id, state.t + 0.25);
    else { reflect(b, hit); keepSteep(b); }
    if (state.mods.crossTeam) {
      b.speed = Math.min(BASE_SPEED * 1.6, b.speed * (1 + state.mods.crossTeam));
      setSpeed(b, b.speed);
    }
    b.hits += 1;
    if (immune(e)) {
      state.events.push({ type: 'block', x: b.x, y: b.y });
    } else {
      const { damage, cached } = hitDamage(state, b, e, state.rng);
      e.hp -= damage;
      state.events.push({ type: 'hit', x: b.x, y: b.y, kind: b.kind, cached });
      applyHitEffects(state, b, e, state.rng);
      if (e.hp <= 0) kill(state, e);
      else if (e.boss) afterBossHit(state, e);
    }
    b.lastEnemy = e.id;
    if (!pierce) break;
  }
}

function kill(state, e) {
  e.dead = true;
  if (e.boss) {
    if (onBossKilled(state, e)) clearStage(state);
    return;
  }
  onKilled(state, e);
  state.stats.kills += 1;
  state.xp += e.xp * state.stageDef.hpScale * (1 + state.mods.xpGain);
  state.events.push({ type: 'kill', x: e.x + e.w / 2, y: e.y + e.h / 2, kind: e.kind });
  while (state.xp >= state.xpToNext) {
    state.xp -= state.xpToNext;
    state.level += 1;
    state.xpToNext = Math.round(8 + 5 * state.level ** 1.25);
    state.pendingLevels += 1;
  }
}

function startBoss(state) {
  const e = spawnBoss(state);
  state.stats.firstBossAt ??= state.t;
  log(state, 'boss', `Boss: ${state.boss.def.name}`);
  state.events.push({ type: 'intro', boss: e.boss });
}

function clearStage(state) {
  log(state, 'boss', `Resolved: ${state.boss.def.name}`);
  for (const e of state.enemies) e.dead = true;
  state.enemies = [];
  state.pendingRespawns = [];
  state.phase = 'clear';
  state.phaseTimer = CLEAR_TIME;
  state.events.push({ type: 'clear', index: state.stageIndex });
  if (state.stageIndex + 1 < state.design.stages.length) state.pendingLevels += 1;
}

function finish(state, outcome) {
  state.outcome = outcome;
  state.phase = 'over';
  log(state, 'outcome', outcome === 'met' ? 'SLO met' : 'SLO breached');
  state.events.push({ type: 'over', outcome });
}
```

- [ ] **Step 4: Run**

Run: `cd game && node --test test/*.test.js`
Expected: all pass. If "clearing the last stage" flakes because the boss at `(W-120)/2` isn't under the player, set `boss.x = s.player.x - boss.w / 2` in the test; don't change engine behaviour to suit it.

- [ ] **Step 5: Commit**

```bash
git add game/src/engine.js game/test/engine.test.js
git commit -m "Add the game engine: firing, collisions, level-ups, stages, outcomes

Claude-Session: https://claude.ai/code/session_019Gn4ESpBQMBXM6ugLwTT3t"
```

---

### Task 8: Headless simulation and balance

**Files:**
- Create: `game/test/sim.mjs`
- Modify: `tests/test_game.py` (add simulation tests)
- Modify: `game/design.yaml` (balance numbers only)

**Interfaces:**
- Consumes: `engine.newRun`, `step`, `chooseCard`; `enemies.lowestTarget`; `world.STEP`.
- Produces: CLI `node game/test/sim.mjs <game-data.json> <bot|idle> <seed>` printing one JSON line `{outcome, stage, t, level, picks}`.

- [ ] **Step 1: Write the simulation**

`game/test/sim.mjs`:

```js
// Headless run for tests/test_game.py: node sim.mjs <game-data.json> <bot|idle> <seed>
// "bot" aims at and moves under whatever is closest to breaching, and takes
// fusions, then tools, then bullets. "idle" never fires.
import { readFileSync } from 'node:fs';
import { newRun, step, chooseCard } from '../src/engine.js';
import { lowestTarget } from '../src/enemies.js';
import { STEP } from '../src/world.js';

const [file, mode = 'bot', seedArg = '1'] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file, 'utf8'));
const state = newRun(data, Number(seedArg));
const LIMIT = 20 * 60;
const PREFERENCE = ['fusion', 'ball', 'bullet'];

while (state.phase !== 'over' && state.t < LIMIT) {
  if (state.phase === 'levelup') {
    const ranked = state.cards.map((c, i) => [PREFERENCE.indexOf(c.type), i]).sort((a, b) => a[0] - b[0]);
    chooseCard(state, ranked[0][1]);
    continue;
  }
  let input = { fire: false };
  if (mode === 'bot') {
    const target = lowestTarget(state);
    input = target
      ? { moveX: target.x + target.w / 2, aim: { x: target.x + target.w / 2, y: target.y + target.h / 2 } }
      : { aim: { x: state.player.x, y: 0 } };
  }
  step(state, STEP, input);
  state.events.length = 0;
}

console.log(JSON.stringify({ outcome: state.outcome, stage: state.stageIndex + 1, t: Math.round(state.t), level: state.level, picks: state.picks.length }));
```

- [ ] **Step 2: Add the failing pytest cases** (append to `tests/test_game.py`):

```python
import subprocess

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node not installed")


@pytest.fixture(scope="module")
def data_file(tmp_path_factory):
    path = tmp_path_factory.mktemp("sim") / "game-data.json"
    path.write_text(json.dumps(game.export(ROOT)))
    return path


def simulate(data_file: Path, mode: str, seed: int) -> dict:
    result = subprocess.run([NODE, str(ROOT / "game" / "test" / "sim.mjs"), str(data_file), mode, str(seed)],
                            capture_output=True, text=True, timeout=300, check=True)
    return json.loads(result.stdout)


@needs_node
@pytest.mark.parametrize("seed", [1, 2, 3])
def test_scripted_player_meets_the_slo(data_file, seed):
    r = simulate(data_file, "bot", seed)
    assert r["outcome"] == "met", r
    assert 240 <= r["t"] <= 720, r


@needs_node
def test_idle_player_breaches_in_stage_one(data_file):
    r = simulate(data_file, "idle", 1)
    assert (r["outcome"], r["stage"]) == ("breached", 1), r
```

- [ ] **Step 3: Run and record the baseline**

Run: `python3 -m pytest tests/test_game.py -q -k "scripted or idle"` and, for detail, `python3 build.py --game --out /tmp/eb && for s in 1 2 3 4 5; do node game/test/sim.mjs /tmp/eb/game/game-data.json bot $s; done`
Expected: the idle test passes; the bot tests may fail. Record each seed's `{outcome, stage, t}`.

- [ ] **Step 4: Tune `game/design.yaml` until the tests pass**

Change only numbers in `stages` and `bosses` (and `tag_effects` magnitudes if a single mod dominates). Levers, in order of preference:
- Bot dies in stage N → lower that stage's `hpScale` or raise `spawnEvery` by ~10%; if it dies to its boss, lower that boss `hp` or the stage `bossRate`.
- Bot wins in under 240 s → raise boss `hp` first, then stage `duration`.
- Bot wins in over 720 s → lower boss `hp`.
- Idle must still breach in stage 1: stage 1 `duration` must exceed the time 20 budget of requests takes to land (~60 s at the starting values).
Re-run all five seeds after each change; aim for seeds 1–5 all `met` with `t` between 300 and 600 so the asserted seeds have margin. Do not change engine code to pass balance tests.

- [ ] **Step 5: Run the whole suite**

Run: `make test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add game/test/sim.mjs tests/test_game.py game/design.yaml
git commit -m "Prove a run is winnable and losable with a headless simulation

Claude-Session: https://claude.ai/code/session_019Gn4ESpBQMBXM6ugLwTT3t"
```

---

### Task 9: Browser shell — HTML, CSS, renderer, UI, input

**Files:**
- Create: `game/index.html`, `game/style.css`, `game/src/render.js`, `game/src/ui.js`, `game/src/main.js`

**Interfaces:**
- Consumes: `engine.newRun/step/chooseCard`, `world.*`, `balls.kindInfo`, `cards.cardView/citedText/years`, `postmortem.summarize/loadBest/saveBest`.
- Produces: `render.createRenderer(canvas, {reducedMotion}) -> {resize(), onEvent(ev, state), draw(state, dt, paused)}`; `ui.el`, `showTitle`, `hideTitle`, `showError`, `showCards`, `hideCards`, `showBanner`, `showToast`, `showPause`, `showPostmortem`, `hidePostmortem`, `links`.

- [ ] **Step 1: `game/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Error Budget</title>
  <meta name="description" content="A roguelike built from Nathan Douglas's résumé: production is the pit, and every failure mode that lands burns error budget.">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="bar">
    <span class="brand">error_budget<span class="dim"> · a résumé you can play</span></span>
    <nav>
      <a id="pdf" class="btn" href="../resume.pdf">PDF</a>
      <button id="skip" type="button">Skip to résumé</button>
    </nav>
  </header>
  <main class="stage-wrap">
    <div class="frame">
      <canvas id="pit" aria-label="Game playfield. Card text and the résumé are available as page text."></canvas>
      <section id="title" class="overlay">
        <h1>Error Budget</h1>
        <p>Loading… If nothing happens, <a href="../resume.pdf">the résumé PDF is here</a>.</p>
      </section>
      <section id="cards" class="overlay" hidden aria-live="polite"></section>
      <section id="pause" class="overlay" hidden>
        <h1>Paused</h1>
        <p>Press <span class="kbd">P</span> or <span class="kbd">Esc</span> to resume.</p>
        <div class="actions"><button id="resume" class="primary" type="button">Resume</button></div>
      </section>
      <div id="banner" class="banner" hidden></div>
      <div id="toast" class="toast" hidden role="status"></div>
    </div>
  </main>
  <section id="postmortem" class="postmortem" hidden></section>
  <script type="module" src="src/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: `game/style.css`**

```css
:root {
  color-scheme: dark;
  --bg: #07090d;
  --panel: #0d1117;
  --panel-2: #161b22;
  --line: #30363d;
  --text: #e6edf3;
  --dim: #8b949e;
  --ok: #3fb950;
  --warn: #d29922;
  --bad: #f85149;
  --accent: #58a6ff;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); font: 14px/1.5 var(--mono); }
body { display: flex; flex-direction: column; overflow: hidden; }
a { color: var(--accent); }
.dim { color: var(--dim); font-weight: 400; }
.bar { flex: none; height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px; border-bottom: 1px solid var(--line); }
.brand { font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar nav { flex: none; display: flex; gap: 8px; }
button, .btn { font: inherit; color: var(--text); background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; cursor: pointer; text-decoration: none; display: inline-block; }
button:hover, .btn:hover, button:focus-visible, .btn:focus-visible { border-color: var(--accent); outline: none; }
button.primary { background: #1f6feb; border-color: #1f6feb; }
.stage-wrap { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 12px 16px 16px; }
.frame { position: relative; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--panel); }
canvas { display: block; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
.overlay { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center; gap: 12px; padding: 24px; background: rgba(7, 9, 13, 0.9); overflow-y: auto; }
[hidden] { display: none !important; }
.overlay h1 { margin: 0; font-size: 28px; }
.overlay p { margin: 0; color: var(--dim); }
.kbd { border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; color: var(--text); }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
#cards { justify-content: flex-start; padding-top: 44px; }
.cards-head { color: var(--ok); font-weight: 700; }
.card { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 4px; padding: 12px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; }
.card:hover, .card:focus-visible { border-color: var(--ok); }
.kicker { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; }
.card .text { font-size: 13px; }
.card q, .toast q { display: block; color: var(--dim); font-size: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { font-size: 11px; padding: 1px 6px; border-radius: 999px; border: 1px solid var(--line); color: var(--ok); }
.banner { position: absolute; left: 0; right: 0; top: 38%; padding: 12px; text-align: center; pointer-events: none; background: linear-gradient(90deg, transparent, rgba(13, 17, 23, 0.94), transparent); }
.banner strong { display: block; font-size: 20px; }
.banner span { color: var(--dim); font-size: 12px; }
.toast { position: absolute; left: 12px; right: 12px; bottom: 64px; padding: 10px 12px; font-size: 12px; pointer-events: none; background: rgba(22, 27, 34, 0.95); border: 1px solid var(--line); border-left: 3px solid var(--warn); border-radius: 6px; }
.toast strong { color: var(--warn); }
.postmortem { position: fixed; inset: 0; z-index: 10; overflow-y: auto; background: var(--bg); }
.pm { max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
.pm h2 { margin: 0 0 4px; font-size: 22px; }
.pm h3 { margin: 28px 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); }
.pm .met { color: var(--ok); }
.pm .breached { color: var(--bad); }
.dora { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.stat { padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
.stat b { display: block; font-size: 20px; }
.stat span { color: var(--dim); font-size: 12px; }
.timeline { list-style: none; margin: 0; padding: 0 0 0 12px; border-left: 1px solid var(--line); }
.timeline time { color: var(--dim); margin-right: 8px; }
.role { margin: 12px 0; }
.role .who { font-weight: 700; }
.role .when { color: var(--dim); }
.role ul { margin: 6px 0 0; padding-left: 18px; }
.role li { margin: 4px 0; }
.links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
@media (max-width: 520px) {
  .brand .dim { display: none; }
  .stage-wrap { padding: 8px; }
  .overlay { padding: 16px; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
```

- [ ] **Step 3: `game/src/render.js`**

```js
import { W, H, PLAYER_Y, DANGER_Y, REVEAL_BASE, MOVE_BAND_Y } from './world.js';
import { kindInfo } from './balls.js';

const BG = '#0d1117';
const GRID = 'rgba(240, 246, 252, 0.035)';
const BOSS = '#f0883e';
const FONT = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export function createRenderer(canvas, { reducedMotion = false } = {}) {
  const ctx = canvas.getContext('2d');
  const particles = [];
  const colors = new Map();
  let shake = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
  }

  const ballColor = (state, kind) => {
    if (!colors.has(kind)) colors.set(kind, kindInfo(kind, state.design).color);
    return colors.get(kind);
  };

  function onEvent(ev, state) {
    if (!state || reducedMotion) return;
    if (ev.type === 'breach') shake = Math.min(14, shake + 4 * ev.amount);
    if (ev.type === 'hit') burst(ev.x, ev.y, ballColor(state, ev.kind), ev.cached ? 10 : 3, ev.cached ? 160 : 90);
    if (ev.type === 'kill') burst(ev.x, ev.y, state.design.enemies[ev.kind]?.color ?? BOSS, 14, 140);
  }

  function burst(x, y, color, n, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.6);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.45, max: 0.45, color });
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
  }

  function label(text, x, y, color, align = 'left', maxWidth = 0) {
    ctx.font = FONT;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    if (maxWidth) ctx.fillText(text, x, y, maxWidth);
    else ctx.fillText(text, x, y);
  }

  function grid() {
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 30) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 0; y <= H; y += 30) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
  }

  function zones(state) {
    const top = DANGER_Y - REVEAL_BASE - state.mods.reveal;
    const g = ctx.createLinearGradient(0, top, 0, DANGER_Y);
    g.addColorStop(0, 'rgba(88, 166, 255, 0)');
    g.addColorStop(1, 'rgba(88, 166, 255, 0.08)');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, DANGER_Y - top);
    ctx.strokeStyle = 'rgba(248, 81, 73, 0.7)';
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.moveTo(0, DANGER_Y); ctx.lineTo(W, DANGER_Y); ctx.stroke();
    ctx.setLineDash([]);
    label('SLO', 6, DANGER_Y - 4, 'rgba(248, 81, 73, 0.85)');
    ctx.fillStyle = 'rgba(240, 246, 252, 0.03)';
    ctx.fillRect(0, MOVE_BAND_Y, W, H - MOVE_BAND_Y);
  }

  function boss(e) {
    ctx.fillStyle = hexA(BOSS, 0.18);
    ctx.fillRect(e.x, e.y, e.w, e.h);
    ctx.strokeStyle = BOSS;
    ctx.lineWidth = 2;
    if (e.shielded) ctx.setLineDash([6, 4]);
    ctx.strokeRect(e.x + 1, e.y + 1, e.w - 2, e.h - 2);
    ctx.setLineDash([]);
    label(e.name, e.x + e.w / 2, e.y + e.h / 2 + 4, BOSS, 'center', e.w - 8);
    ctx.fillStyle = BOSS;
    ctx.fillRect(e.x, e.y + e.h - 3, e.w * Math.max(0, e.hp / e.maxHp), 3);
  }

  function enemies(state) {
    for (const e of state.enemies) {
      if (e.dead || (e.kind === 'silent' && !e.revealed)) continue;
      if (e.boss) { boss(e); continue; }
      const def = state.design.enemies[e.kind];
      const unrevealed = e.kind === 'skipped' && !e.revealed;
      const color = unrevealed ? '#6e7681' : def.color;
      ctx.globalAlpha = e.phased ? 0.25 : 1;
      ctx.fillStyle = hexA(color, 0.16);
      ctx.fillRect(e.x, e.y, e.w, e.h);
      ctx.strokeStyle = e.traced ? '#e05cc1' : color;
      ctx.lineWidth = e.armored ? 3 : 1.5;
      if (e.phased) ctx.setLineDash([4, 3]);
      ctx.strokeRect(e.x + 0.5, e.y + 0.5, e.w - 1, e.h - 1);
      ctx.setLineDash([]);
      label(unrevealed ? '✓ PASS' : def.label, e.x + e.w / 2, e.y + e.h / 2 + 4, color, 'center');
      if (e.hp < e.maxHp) {
        ctx.fillStyle = color;
        ctx.fillRect(e.x, e.y + e.h - 2, e.w * Math.max(0, e.hp / e.maxHp), 2);
      }
      ctx.globalAlpha = 1;
      const p = e.link != null && state.enemies.find((x) => x.id === e.link && !x.dead);
      if (p && p.id > e.id) {
        ctx.strokeStyle = hexA(def.color, 0.6);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(e.x + e.w / 2, e.y + e.h / 2);
        ctx.lineTo(p.x + p.w / 2, p.y + p.h / 2);
        ctx.stroke();
      }
    }
  }

  function balls(state) {
    for (const b of state.balls) {
      ctx.globalAlpha = b.child ? 0.7 : 1;
      ctx.fillStyle = ballColor(state, b.kind);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function player(state) {
    const p = state.player;
    ctx.strokeStyle = 'rgba(240, 246, 252, 0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.moveTo(p.x, PLAYER_Y);
    ctx.lineTo(p.x + p.aim.x * 90, PLAYER_Y + p.aim.y * 90);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#e6edf3';
    ctx.fillRect(p.x - 18, PLAYER_Y - 5, 36, 10);
    const ready = state.slots.filter((s) => s.out === 0).length;
    label(`${ready}/${state.slots.length}`, p.x, PLAYER_Y + 20, '#8b949e', 'center');
  }

  function fx(dt, paused) {
    for (const p of particles) {
      if (!paused) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
  }

  function hud(state) {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0); // the HUD never shakes
    ctx.fillStyle = 'rgba(13, 17, 23, 0.85)';
    ctx.fillRect(0, 0, W, 36);
    const s = state.stageDef;
    label(`${state.stageIndex + 1}/${state.design.stages.length} ${s.employer}`, 8, 14, '#e6edf3');
    label(`LV ${state.level}`, W - 8, 14, '#e6edf3', 'right');
    const f = Math.max(0, state.budget / state.maxBudget);
    label('ERROR BUDGET', 8, 30, '#8b949e');
    ctx.fillStyle = 'rgba(240, 246, 252, 0.08)';
    ctx.fillRect(100, 22, W - 108, 8);
    ctx.fillStyle = f > 0.5 ? '#3fb950' : f > 0.25 ? '#d29922' : '#f85149';
    ctx.fillRect(100, 22, (W - 108) * f, 8);
    ctx.fillStyle = '#58a6ff';
    ctx.fillRect(0, 35, W * Math.min(1, state.xp / state.xpToNext), 1.5);
    const b = state.enemies.find((e) => e.boss && !e.dead);
    if (b) label(`${b.name} ${Math.ceil((100 * b.hp) / b.maxHp)}%`, W / 2, 52, BOSS, 'center');
    else if (state.phase === 'play') label(`boss in ${Math.ceil(Math.max(0, s.duration - state.stageTime))}s`, W - 8, 52, '#8b949e', 'right');
  }

  function draw(state, dt, paused) {
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    if (shake > 0 && !paused) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake = Math.max(0, shake - 40 * dt);
    }
    grid();
    if (!state) return;
    zones(state);
    enemies(state);
    balls(state);
    player(state);
    fx(dt, paused);
    hud(state);
  }

  return { resize, onEvent, draw };
}
```

- [ ] **Step 4: `game/src/ui.js`**

```js
import { years } from './cards.js';

const $ = (id) => document.getElementById(id);
let bannerTimer = 0;
let toastTimer = 0;

// Builds DOM from text only; résumé content never goes through innerHTML.
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

export function links(person) {
  return [
    ['Résumé (PDF)', person.pdf],
    [person.website, `https://${person.website}`],
    ['GitHub', `https://github.com/${person.github}`],
    ['LinkedIn', `https://www.linkedin.com/in/${person.linkedin}/`],
    [person.email, `mailto:${person.email}`],
  ];
}

const kbd = (k) => el('span', { class: 'kbd' }, k);

export function showTitle(data, best, onStart, onResume) {
  $('title').replaceChildren(
    el('h1', {}, 'Error Budget'),
    el('p', {}, `A roguelike built from ${data.person.name}'s résumé. Production is the pit. Failure modes fall toward your SLO line, and every one that lands burns error budget.`),
    el('p', {}, 'Level up by merging PRs. Every card is a real line from the résumé, and its tags decide what it does.'),
    el('p', {}, 'Aim with the mouse or by touching the pit. Move with ', kbd('A'), ' ', kbd('D'), ', the arrow keys, or by dragging along the bottom. ', kbd('P'), ' pauses.'),
    best ? el('p', {}, `Your best run: ${best.outcome === 'met' ? 'SLO met' : `reached stage ${best.stageReached}`}.`) : null,
    el('div', { class: 'actions' },
      el('button', { class: 'primary', type: 'button', onclick: onStart }, 'Start run'),
      el('button', { type: 'button', onclick: onResume }, 'Read the résumé instead')),
  );
  $('title').hidden = false;
  $('title').querySelector('button.primary').focus({ preventScroll: true });
}

export const hideTitle = () => { $('title').hidden = true; };

export function showError(message, href) {
  $('title').replaceChildren(
    el('h1', {}, 'Error Budget'),
    el('p', {}, message),
    el('div', { class: 'actions' }, el('a', { class: 'btn', href }, 'Open the résumé (PDF)')),
  );
  $('title').hidden = false;
}

export function showCards(views, onPick) {
  const c = $('cards');
  c.replaceChildren(
    el('div', { class: 'cards-head' }, 'Level up. Pick one.'),
    ...views.map((v, i) => el('button', { class: 'card', type: 'button', onclick: () => onPick(i) },
      el('span', { class: 'kicker' }, `${i + 1} · ${v.kicker}`),
      el('strong', {}, v.title),
      v.sub ? el('span', { class: 'kicker' }, v.sub) : null,
      el('span', { class: 'text' }, v.text),
      v.quote ? el('q', {}, v.quote) : null,
      v.chips.length ? el('span', { class: 'chips' }, v.chips.map((ch) => el('span', { class: 'chip' }, ch))) : null)),
  );
  c.hidden = false;
  c.scrollTop = 0;
  c.querySelector('button')?.focus({ preventScroll: true });
}

export const hideCards = () => { $('cards').hidden = true; };

export function showBanner(title, sub, ms = 2200) {
  const b = $('banner');
  b.replaceChildren(el('strong', {}, title), sub ? el('span', {}, sub) : null);
  b.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
}

export function showToast(title, body, quote, ms = 6000) {
  const t = $('toast');
  t.replaceChildren(el('strong', {}, title), el('div', {}, body), quote ? el('q', {}, quote) : null);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export const showPause = (on) => { $('pause').hidden = !on; };

const stat = (value, labelText) => el('div', { class: 'stat' }, el('b', {}, String(value)), el('span', {}, labelText));

export function showPostmortem(data, summary, { onRestart, onClose }) {
  const person = data.person;
  const parts = [];
  if (summary) {
    parts.push(
      el('h2', { class: summary.outcome }, summary.outcome === 'met' ? 'Postmortem: SLO met' : 'Postmortem: SLO breached'),
      el('p', { class: 'dim' }, `Reached stage ${summary.stageReached} of ${summary.stages} · ${summary.duration} · level ${summary.level} · ${summary.kills} failure modes resolved`),
      el('h3', {}, 'Delivery metrics'),
      el('div', { class: 'dora' },
        stat(summary.deploys, 'Deploys (shots fired)'),
        stat(`${Math.round(summary.changeFailureRate * 100)}%`, 'Change failure rate (balls that hit nothing)'),
        stat(summary.timeToRestore == null ? '—' : `${summary.timeToRestore.toFixed(1)}s`, 'Mean time to restore full budget'),
        stat(summary.leadTime == null ? '—' : `${Math.round(summary.leadTime)}s`, 'Lead time to first boss')),
      el('h3', {}, summary.detailed ? 'Timeline (full, because you picked documentation)' : 'Timeline'),
      el('ol', { class: 'timeline' }, summary.timeline.map((e) => el('li', {}, el('time', {}, e.clock), e.text))),
    );
    if (summary.picks.length) {
      parts.push(el('h3', {}, 'What you shipped'), ...summary.picks.map((g) => el('div', { class: 'role' },
        el('div', { class: 'who' }, g.role, el('span', { class: 'when' }, ` · ${g.employer}`)),
        el('ul', {}, g.bullets.map((b) => el('li', {}, b))))));
    }
  }
  parts.push(
    el('h3', {}, `About ${person.name}`),
    el('p', {}, person.summary),
    el('div', { class: 'links' }, links(person).map(([text, href]) => el('a', { class: 'btn', href }, text))),
    el('h3', {}, 'Experience'),
    ...data.roles.map((r) => el('div', { class: 'role' },
      el('div', { class: 'who' }, r.title),
      el('div', { class: 'when' }, `${r.employer} · ${years(r.start, r.end)}`))),
    el('h3', {}, 'Projects'),
    ...data.projects.map((p) => el('div', { class: 'role' },
      el('div', { class: 'who' }, el('a', { href: p.url }, `${p.emoji ? `${p.emoji} ` : ''}${p.name}`)),
      el('div', { class: 'when' }, p.text))),
    el('div', { class: 'actions' },
      el('button', { class: 'primary', type: 'button', onclick: onRestart }, summary ? 'Run it back' : 'Start a run'),
      el('button', { type: 'button', onclick: onClose }, 'Close')),
  );
  const pm = $('postmortem');
  pm.replaceChildren(el('div', { class: 'pm' }, parts));
  pm.hidden = false;
  pm.scrollTop = 0;
}

export const hidePostmortem = () => { $('postmortem').hidden = true; };
```

- [ ] **Step 5: `game/src/main.js`**

```js
import { newRun, step, chooseCard } from './engine.js';
import { STEP, W, H, MOVE_BAND_Y } from './world.js';
import { createRenderer } from './render.js';
import { summarize, loadBest, saveBest } from './postmortem.js';
import { cardView, citedText, years } from './cards.js';
import * as ui from './ui.js';

const canvas = document.getElementById('pit');
const frameEl = document.querySelector('.frame');
const wrapEl = document.querySelector('.stage-wrap');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const storage = (() => { try { return window.localStorage; } catch { return null; } })();

let data;
try {
  const res = await fetch('game-data.json');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  data = await res.json();
} catch (err) {
  ui.showError('The game data did not load. The résumé is still one click away.', '../resume.pdf');
  throw err;
}
document.getElementById('pdf').href = data.person.pdf;

const renderer = createRenderer(canvas, { reducedMotion });
const input = { aim: null, moveX: null };
const keys = new Set();
let movePointer = null;
let state = null;
let paused = false;
let last = performance.now();
let acc = 0;

function fit() {
  const cs = getComputedStyle(wrapEl);
  const availW = wrapEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = wrapEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const width = Math.floor(Math.min(availW, (availH * W) / H));
  frameEl.style.width = `${width}px`;
  frameEl.style.height = `${Math.floor((width * H) / W)}px`;
  renderer.resize();
}
window.addEventListener('resize', fit);
fit();

function toWorld(ev) {
  const r = canvas.getBoundingClientRect();
  return { x: ((ev.clientX - r.left) * W) / r.width, y: ((ev.clientY - r.top) * H) / r.height };
}
function route(ev) {
  const p = toWorld(ev);
  if (p.y > MOVE_BAND_Y) {
    movePointer = ev.pointerId;
    input.moveX = p.x;
  } else {
    input.aim = p;
    if (movePointer === ev.pointerId) { movePointer = null; input.moveX = null; }
  }
}
canvas.addEventListener('pointerdown', (ev) => { canvas.setPointerCapture(ev.pointerId); route(ev); });
canvas.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse' || ev.buttons) route(ev); });
const release = (ev) => { if (ev.pointerId === movePointer) { movePointer = null; input.moveX = null; } };
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
const running = () => state && state.phase !== 'over';
window.addEventListener('keydown', (ev) => {
  if (KEYS[ev.code]) { keys.add(KEYS[ev.code]); ev.preventDefault(); return; }
  if (ev.code === 'KeyP' || ev.code === 'Escape') { if (running()) setPaused(!paused); return; }
  if (/^Digit[1-3]$/.test(ev.code) && !paused) pick(Number(ev.code.slice(5)) - 1);
});
window.addEventListener('keyup', (ev) => { if (KEYS[ev.code]) keys.delete(KEYS[ev.code]); });
window.addEventListener('blur', () => { keys.clear(); if (running()) setPaused(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && running()) setPaused(true); });

function setPaused(on) {
  paused = on;
  ui.showPause(on);
}
document.getElementById('resume').addEventListener('click', () => setPaused(false));
document.getElementById('skip').addEventListener('click', openResume);

function openResume() {
  if (running()) setPaused(true);
  ui.showPostmortem(data, null, { onRestart: start, onClose: ui.hidePostmortem });
}

function start() {
  ui.hidePostmortem();
  ui.hideTitle();
  ui.hideCards();
  state = newRun(data, (Math.random() * 2 ** 32) >>> 0);
  acc = 0;
  setPaused(false);
}

function pick(i) {
  if (!state || state.phase !== 'levelup' || !state.cards[i]) return;
  ui.hideCards();
  chooseCard(state, i);
}

function showTitleScreen() {
  ui.showTitle(data, loadBest(storage), start, openResume);
}

function handle(ev) {
  switch (ev.type) {
    case 'stage': {
      const s = data.design.stages[ev.index];
      const roles = data.roles.filter((r) => s.roles.includes(r.id));
      ui.showBanner(`Stage ${ev.index + 1} · ${s.employer}`, roles.map((r) => `${r.title} (${years(r.start, r.end)})`).join(' · '), 3000);
      break;
    }
    case 'intro':
      if (ev.boss) {
        const b = data.design.bosses.find((x) => x.id === ev.boss);
        ui.showToast(`Boss: ${b.name}`, b.blurb, citedText(data, b.cites[0]));
      } else {
        const e = data.design.enemies[ev.kind];
        ui.showToast(`New failure mode: ${e.name}`, e.blurb, citedText(data, e.cites[0]));
      }
      break;
    case 'levelup':
      ui.showCards(state.cards.map((c) => cardView(c, state)), pick);
      break;
    case 'clear':
      ui.showBanner('Resolved', ev.index + 1 < data.design.stages.length ? 'Next stage incoming' : 'Every stage cleared');
      break;
    case 'banner':
      ui.showBanner(ev.text, ev.sub);
      break;
    case 'over': {
      const summary = summarize(state);
      saveBest(storage, summary);
      setTimeout(() => ui.showPostmortem(data, summary, {
        onRestart: start,
        onClose: () => { ui.hidePostmortem(); showTitleScreen(); },
      }), 900);
      break;
    }
    default:
      renderer.onEvent(ev, state);
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (state && !paused) {
    acc += dt;
    const moveDir = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    const inp = { aim: input.aim, moveX: input.moveX, moveDir };
    let n = 0;
    while (acc >= STEP && n < 12) { step(state, STEP, inp); acc -= STEP; n++; }
    if (n === 12) acc = 0;
  }
  if (state) for (const ev of state.events.splice(0)) handle(ev);
  renderer.draw(state, dt, paused);
  requestAnimationFrame(frame);
}

showTitleScreen();
requestAnimationFrame(frame);
```

- [ ] **Step 6: Confirm pure modules stay DOM-free and tests still pass**

Run: `grep -lE '\b(window|document)\b' game/src/*.js`
Expected: exactly `game/src/main.js`, `game/src/render.js`, `game/src/ui.js`.
Run: `make test`
Expected: all pass.

- [ ] **Step 7: Play it in a browser**

Run: `make serve` and open `http://localhost:8000/game/`. Check each, fixing anything that fails:
- Title screen shows; "Start run" starts stage 1 with its banner; balls fire toward the pointer and return.
- A new enemy kind shows a toast quoting its cited bullet; level-up shows three cards with verbatim bullet text; keys `1`–`3` pick.
- `P`/`Esc` pauses; switching tabs pauses; "Skip to résumé" opens the résumé view mid-run and "Close" returns to the paused game.
- Reach the postmortem (lose deliberately): metrics, timeline, picks, links render; "Run it back" restarts.
- Browser devtools at 375×667 (phone): no horizontal scroll; dragging along the bottom band moves; touching the pit aims; cards scroll.
- Rename `dist/game/game-data.json` and reload: the title overlay shows the error with a working PDF link. Restore the file.
- Open `dist/game/index.html` via `file://`: the static "If nothing happens" PDF link is visible.

- [ ] **Step 8: Commit**

```bash
git add game/index.html game/style.css game/src/render.js game/src/ui.js game/src/main.js
git commit -m "Add the browser shell: canvas renderer, overlays, input, postmortem page

Claude-Session: https://claude.ai/code/session_019Gn4ESpBQMBXM6ugLwTT3t"
```

---

### Task 10: Documentation and final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README section** (insert after `## Adding a profile` section):

```markdown
## The game

`game/` is Error Budget, a small roguelike built from this content and
published at https://ndouglas.github.io/resume/game/. Production is the pit;
failure modes fall toward the SLO line; level-up cards are real bullets whose
tags decide what they do.

    make game     # build dist/game/ (also part of build.py --all)
    make serve    # http://localhost:8000/game/

`game/design.yaml` holds the balls, enemies, bosses, fusions, stages, and the
tag-to-effect table. Every enemy, boss, and fusion cites a bullet or project
id, and every tag needs a `tag_effects` entry; `make test` fails otherwise.
Balance is checked by a headless simulation (`game/test/sim.mjs`) that must
win on fixed seeds and must lose when it never fires.
```

- [ ] **Step 2: Full verification**

Run: `make test && python3 build.py --all --no-pdf && ls dist/game`
Expected: all tests pass; `dist/game` contains `index.html`, `style.css`, `src/`, `game-data.json`, and not `design.yaml`, `test/`, or `package.json`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document the game in the README

Claude-Session: https://claude.ai/code/session_019Gn4ESpBQMBXM6ugLwTT3t"
```
