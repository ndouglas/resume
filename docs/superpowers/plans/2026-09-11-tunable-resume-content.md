# Tunable Résumé Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the transcribed legacy content with bullets, summaries, projects, and skills written from the evidence files under the agreed throughline, then tune both target profiles to two pages.

**Architecture:** Content-only changes to `content/*.yaml` and `profiles/*.yaml`, plus two small tooling additions (a `core` tag for always-on sections, a formal-verification lint pattern) and one CI change (page budgets checked on pull requests). Every task keeps the full suite green, including the lualatex-backed page-budget test, by lowering profile caps in a fixed order when content grows past the budget. The YAML in this plan is the content; implementers transcribe it verbatim.

**Tech Stack:** YAML, the existing `tunable` package, pytest, lualatex.

**Spec:** `docs/superpowers/specs/2026-09-11-tunable-resume-design.md` (stages 2–3 of §12; content plan in §10; throughline in §2; sensitivity rule in §3). Tooling plan that preceded this: `docs/superpowers/plans/2026-09-11-tunable-resume-tooling.md`.

## Global Constraints

- Throughline (spec §2): identity = makes production systems safe to change; proof = finds what is silently wrong; outcome = becomes owner of record by earning trust. Tone: report what happened. No selling language, no superlatives, no aspirational claims. Formal verification, TLA+, and Lean never appear. Team size never appears.
- Sensitivity rule (spec §3), enforced by `tunable/sensitivity.py`: no dollar amounts ("significant"), no durations of defects or outages ("long-standing"), no counts of affected people, no PHI/PII incident, no blame language, no postmortem quotes.
- Evidence-file caveats: Drupal 10 was "led the program," not "performed the upgrade"; the Lagoon migration did not ship and is not claimed; cost figures are never stated; the Cypress ~60% figure is stated as approximate.
- Every bullet: unique kebab-case `id`, non-empty `tags` from `content/tags.yaml`, integer `weight` 1–5, non-empty `evidence`. Bullets from roles without evidence files use `evidence: "from memory; discuss in interview"`.
- Each tuned profile must render to at most 2 pages (`tests/test_build.py::test_page_budget`, which runs locally because lualatex is installed) and must select at least one `leadership` bullet for roles `cie`, `cms-tl`, `cms-sse`.
- Cap-reduction order when a profile exceeds 2 pages (apply one step at a time, re-test after each): `projects 6→5`, `cms-sse 5→4`, `ain 4→3`, `cie 7→6`, `cms-tl 4→3`, `devon 2→1`, `projects 5→4`, `cms-sse 4→3`.
- Run tests as `.venv/bin/python -m pytest -q` from the repo root (`.venv` exists on main; if missing: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`). Test output must be pristine.
- Commit after every task. Write each commit message to a file and use `git commit -F <file>`; the last line is exactly `Claude-Session: https://claude.ai/code/session_01TpGrt9ccJLFdFPpQEzqrbT`. Never use `--no-verify`.

## File Structure

| Path | Change |
|---|---|
| `content/tags.yaml` | Add `core` tag |
| `content/education.yaml`, `content/languages.yaml` | Retag to `core` |
| `content/summary.yaml` | Three variants replace the legacy one |
| `content/projects.yaml` | Rewrite projects and note |
| `content/skills.yaml` | Regroup by evidence |
| `content/experience.yaml` | Rewrite every role's bullets; product suffix on Agile Six titles |
| `profiles/commercial-senior-swe.yaml`, `profiles/govtech-platform.yaml` | Add `core` tag; govtech uses `govtech` summary; caps tuned; explicit include/exclude where needed |
| `tunable/sensitivity.py` | Add formal-verification pattern |
| `tests/test_content.py` | Content-shape assertions added per task |
| `tests/test_profiles.py` | Remove the `cie` xfail once its leadership bullet exists |
| `tests/test_sensitivity.py` | Cases for the new pattern |
| `.github/workflows/continuous_delivery.yaml` | Build job runs on PRs; upload/deploy gated on push |

---

### Task 1: `core` tag for always-on sections

**Files:**
- Modify: `content/tags.yaml`, `content/education.yaml`, `content/languages.yaml`, `profiles/commercial-senior-swe.yaml`, `profiles/govtech-platform.yaml`
- Test: `tests/test_content.py`

**Interfaces:**
- Produces: tag `core` in the vocabulary; every tuned profile lists `core` in `tags`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_content.py`:
```python
def test_core_tag_keeps_education_in_every_tuned_profile():
    from tunable.select import select
    content = load_content(ROOT / "content")
    for p in sorted((ROOT / "profiles").glob("*.yaml")):
        profile = load_profile(p, content)
        if profile.tags is None:
            continue
        assert "core" in profile.tags, f"{p.name} must list the core tag"
        sel = select(content, profile)
        if "education" in profile.sections:
            assert sel.education, f"{p.name} dropped education"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest -q tests/test_content.py::test_core_tag_keeps_education_in_every_tuned_profile`
Expected: FAIL, `commercial-senior-swe.yaml must list the core tag`.

- [ ] **Step 3: Add the tag and retag**

Append to `content/tags.yaml`:
```yaml
core: Always-on sections (education, languages); every tuned profile lists it
```

`content/education.yaml`:
```yaml
education:
  - institution: University of Nevada, Las Vegas
    location: Las Vegas, NV
    degree: Bachelor of Arts in Computer Science
    date: 2011-12
    tags: [core]
```

`content/languages.yaml`:
```yaml
languages:
  - {name: English, level: Native, tags: [core]}
  - {name: French, level: "B1 (in progress)", tags: [core]}
```

In both `profiles/commercial-senior-swe.yaml` and `profiles/govtech-platform.yaml`, add `core` as the first entry of the `tags` list.

- [ ] **Step 4: Run the full suite**

Run: `.venv/bin/python -m pytest -q`
Expected: all pass (2 xfailed, 1 skipped as before).

- [ ] **Step 5: Commit**

Message: `Add core tag so education and languages survive every profile` + trailer.

---

### Task 2: Summary variants

**Files:**
- Modify: `content/summary.yaml`, `profiles/govtech-platform.yaml`
- Test: `tests/test_content.py`

**Interfaces:**
- Produces: summary variants `commercial`, `govtech`, `short`; govtech profile uses `govtech`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_content.py`:
```python
def test_summary_variants_exist_and_are_assigned():
    content = load_content(ROOT / "content")
    assert set(content.summaries) == {"commercial", "govtech", "short"}
    for text in content.summaries.values():
        assert "TLA" not in text and "formal verification" not in text.lower()
    govtech = load_profile(ROOT / "profiles" / "govtech-platform.yaml", content)
    assert govtech.summary == "govtech"
    commercial = load_profile(ROOT / "profiles" / "commercial-senior-swe.yaml", content)
    assert commercial.summary == "commercial"
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest -q tests/test_content.py::test_summary_variants_exist_and_are_assigned`
Expected: FAIL on the variant set.

- [ ] **Step 3: Write `content/summary.yaml`**

```yaml
clearance: "U.S. Public Trust (Tier 2, active) · Prior Top Secret clearance"
variants:
  commercial: >-
    Senior software engineer with 14 years in production systems. Makes
    systems safe to change: tests as the gate for every migration, legacy
    code deleted only after parity, monitors that fail loud, CI with no
    long-lived credentials. Most recently the engineer of record for four
    production healthcare services at ~1.8M requests/day, owning application
    code, infrastructure, delivery pipeline, and on-call.
  govtech: >-
    Senior software engineer with 14 years in production systems, six of
    them on VA.gov. Makes systems safe to change: tests as the gate for every
    migration, legacy code deleted only after parity, monitors that fail
    loud, CI with no long-lived credentials. Most recently the engineer of
    record for the VA.gov Check-In platform (~1.8M requests/day) in AWS
    GovCloud, owning application code, infrastructure, delivery pipeline,
    and on-call under ATO and FedRAMP constraints.
  short: >-
    Senior software engineer, 14 years. Makes production systems safe to
    change and ends up owning them: code, infrastructure, delivery, and
    on-call.
```

Set `summary: govtech` in `profiles/govtech-platform.yaml`.

- [ ] **Step 4: Run the full suite**

Expected: all pass.

- [ ] **Step 5: Commit**

Message: `Write the three summary variants under the throughline` + trailer.

---

### Task 3: Projects and open-source note

**Files:**
- Modify: `content/projects.yaml`
- Test: `tests/test_content.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_content.py`:
```python
def test_projects_reframed():
    content = load_content(ROOT / "content")
    ids = {p.id for p in content.projects}
    assert {"goldentooth", "hornvale", "wiz6", "bitwit", "blackpool", "longtable", "greenstone", "clork", "whispers", "distillation"} <= ids
    gold = next(p for p in content.projects if p.id == "goldentooth")
    assert "TLA" not in gold.text and "TLA+" not in gold.stack
    note = content.project_notes[0]
    assert "OpenTofu" not in note.text and "Couchbase" not in note.text
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, `hornvale` missing.

- [ ] **Step 3: Write `content/projects.yaml`**

```yaml
projects:
  - id: goldentooth
    name: Goldentooth
    emoji: "🦷"
    url: https://github.com/goldentooth/
    text: >-
      17-node Talos Linux Kubernetes cluster run entirely through Flux
      GitOps: Cilium, cert-manager with an internal ACME CA, SeaweedFS,
      Prometheus/Loki/Tempo observability, Chaos Mesh fault injection,
      Falco runtime security, and a 117-entry engineering journal of what
      broke and why
    stack: [Talos, Kubernetes, Flux CD, Cilium]
    tags: [kubernetes, observability, platform, security]
    weight: 5
    evidence: ~/Projects/goldentooth (gitops, cluster, clog)
  - id: hornvale
    name: Hornvale
    emoji: "🏔️"
    url: https://github.com/hornvale/
    text: >-
      Large Rust world simulation whose guardrails are the point:
      architecture rules and documentation invariants enforced as tests,
      byte-identical deterministic output verified across CPU
      architectures, a serialized merge queue, and mutation tooling written
      after false-green results
    stack: [Rust]
    tags: [rust, testing, architecture]
    weight: 4
    evidence: ~/Projects/hornvale/hornvale (cli/tests/suite, docs/decisions, scripts/mutate.py)
  - id: wiz6
    name: Wiz6
    emoji: "🧙"
    url: https://wiz6.goldentooth.net/
    text: >-
      Reverse-engineering a 1990 DOS RPG into typed decoders, a CLI, and a
      data explorer, with pristine fixtures kept separate from the mutable
      emulator workspace
    stack: [TypeScript, Ghidra]
    tags: [typescript, research, backend]
    weight: 3
    evidence: ~/Projects/ndouglas/wiz6
  - id: bitwit
    name: Bitwit
    emoji: "📚"
    url: https://bit-wit.com/
    text: >-
      Spaced repetition platform for CS education with time-based grading
      and parameterized card generation
    stack: [TypeScript, AWS Lambda, DynamoDB]
    tags: [typescript, serverless, backend]
    weight: 3
    evidence: https://bit-wit.com/
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
      Rule-based simulation engine with a LISP DSL, immutable world state,
      and time-travel debugging
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
  - id: whispers
    name: Whispers
    emoji: "🗣️"
    url: https://github.com/ndouglas/whispers/
    text: >-
      Gossip-based mesh network with fraud-resistant distributed
      optimization via audited CRDTs
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
notes:
  - id: open-source-note
    text: >-
      Occasional upstream contributor: Ansible community.general, Lando,
      Datadog serverless functions, Drupal Console, the Drupal core issue
      queue, ReactiveCocoa; documentation fixes to Terraform and Argo CD
    tags: [open-source]
    weight: 1
    evidence: "gh search prs --author ndouglas --merged, verified 2026-09-11; drupal.org schemata patch committed upstream 2024"
```

- [ ] **Step 4: Run the full suite**

Expected: all pass.

- [ ] **Step 5: Commit**

Message: `Reframe projects: drop TLA+, add Hornvale and Wiz6, honest open-source line` + trailer.

---

### Task 4: Formal-verification lint pattern

**Files:**
- Modify: `tunable/sensitivity.py`
- Test: `tests/test_sensitivity.py`

- [ ] **Step 1: Write the failing tests**

Add to the `test_flags_sensitive_text` parametrize list in `tests/test_sensitivity.py`:
```python
    "exploring TLA+ for distributed systems",
    "formal verification of the pipeline",
    "proved in Lean 4",
```
and to `test_allows_ordinary_text`:
```python
    "verified across CPU architectures",
    "lean startup",
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest -q tests/test_sensitivity.py`
Expected: the three new flag cases FAIL.

- [ ] **Step 3: Add the pattern**

Append to `PATTERNS` in `tunable/sensitivity.py`:
```python
    ("formal-verification claim", re.compile(r"\bTLA\+|\bformal verification\b|\bLean\s?4\b|\bproof assistant\b", re.I)),
```

- [ ] **Step 4: Run the full suite**

Expected: all pass (Tasks 2 and 3 already removed TLA+ from content; `test_every_profile_is_clean` stays green).

- [ ] **Step 5: Commit**

Message: `Lint against formal-verification claims` + trailer.

---

### Task 5: Skills regrouped by evidence

**Files:**
- Modify: `content/skills.yaml`
- Test: `tests/test_content.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_content.py`:
```python
def test_skills_groups_in_evidence_order():
    content = load_content(ROOT / "content")
    assert [g.name for g in content.skills] == [
        "Languages", "AWS", "Infrastructure as Code", "Delivery",
        "Observability", "Testing", "Platforms", "Domain",
    ]
    all_items = {i.text for g in content.skills for i in g.items}
    assert "TLA+" not in all_items
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL on group names.

- [ ] **Step 3: Write `content/skills.yaml`**

```yaml
groups:
  - name: Languages
    items:
      - {text: "TypeScript/JavaScript (Node.js)", tags: [typescript, node, backend]}
      - {text: PHP, tags: [php, drupal]}
      - {text: Python, tags: [backend]}
      - {text: Rust, tags: [rust]}
      - {text: Bash, tags: [platform, ci-cd]}
      - {text: HCL, tags: [terraform]}
      - {text: Objective-C, tags: [macos]}
      - {text: Clojure, tags: [research]}
      - {text: Go, tags: [research]}
      - {text: C, tags: [research]}
  - name: AWS
    items:
      - {text: "Lambda (aliases, provisioned concurrency, layers, extensions)", tags: [serverless, aws]}
      - {text: "API Gateway (private, OpenAPI import, authorizers, usage plans)", tags: [serverless, aws]}
      - {text: DynamoDB, tags: [serverless, aws, backend]}
      - {text: AppConfig, tags: [serverless, aws]}
      - {text: "IAM (OIDC federation, permissions boundaries, tag-conditioned policies)", tags: [security, aws]}
      - {text: KMS, tags: [security, aws]}
      - {text: EC2/Auto Scaling, tags: [aws, platform]}
      - {text: ElastiCache, tags: [aws, backend]}
      - {text: CloudFormation/SAM, tags: [aws]}
      - {text: GovCloud, tags: [govcloud, federal]}
  - name: Infrastructure as Code
    items:
      - {text: "Terraform (native tests, import/moved/removed blocks, preconditions)", tags: [terraform]}
      - {text: Terragrunt, tags: [terraform]}
      - {text: Ansible, tags: [platform]}
      - {text: Packer, tags: [platform]}
  - name: Delivery
    items:
      - {text: "GitHub Actions (composite and reusable workflows, OIDC, matrix sharding, self-hosted runners)", tags: [ci-cd]}
      - {text: Jenkins, tags: [ci-cd]}
      - {text: Dependabot and Renovate, tags: [ci-cd, security]}
      - {text: CodeQL, tags: [security, ci-cd]}
      - {text: CodeBuild, tags: [ci-cd, aws]}
  - name: Observability
    items:
      - {text: "Datadog (APM, monitors-as-code, synthetics, log pipelines, CI Visibility)", tags: [observability]}
      - {text: Prometheus, tags: [observability]}
      - {text: Grafana, tags: [observability]}
      - {text: Loki and Tempo, tags: [observability, kubernetes]}
      - {text: CloudWatch, tags: [observability, aws]}
      - {text: PagerDuty, tags: [observability, incident-response]}
  - name: Testing
    items:
      - {text: Jest, tags: [testing, node]}
      - {text: Cypress, tags: [testing]}
      - {text: PHPUnit, tags: [testing, php]}
      - {text: PHPStan, tags: [testing, php]}
      - {text: "axe / WCAG 2.1", tags: [testing]}
      - {text: MSW, tags: [testing, node]}
      - {text: "terraform test", tags: [testing, terraform]}
      - {text: shellcheck, tags: [testing, platform]}
  - name: Platforms
    items:
      - {text: "Kubernetes (Talos, Flux CD, Cilium, Helm)", tags: [kubernetes]}
      - {text: Docker, tags: [platform]}
      - {text: "Drupal 8–10", tags: [drupal, php]}
      - {text: "React / Next.js", tags: [typescript]}
  - name: Domain
    items:
      - {text: "EHR integration (VistA RPCs)", tags: [healthcare]}
      - {text: "HIPAA / PHI handling", tags: [healthcare, security]}
      - {text: "FedRAMP and ATO", tags: [fedramp, ato, federal]}
```

- [ ] **Step 4: Run the full suite**

Expected: all pass.

- [ ] **Step 5: Commit**

Message: `Regroup skills by evidence` + trailer.

---

### Task 6: Check-In role bullets

**Files:**
- Modify: `content/experience.yaml` (the `cie` role only), `tests/test_profiles.py`
- Test: `tests/test_content.py`

**Interfaces:**
- Consumes: role id `cie` (unchanged). Produces: bullets with the ids listed below; the `cie` leadership xfail removed.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_content.py`:
```python
def _bullets(content, role_id):
    for e in content.employers:
        for r in e.roles:
            if r.id == role_id:
                return {b.id: b for b in r.bullets}
    raise KeyError(role_id)


def test_cie_bullets():
    content = load_content(ROOT / "content")
    b = _bullets(content, "cie")
    assert len(b) >= 14
    assert any("leadership" in x.tags for x in b.values())
    assert "two-person" not in " ".join(x.text for x in b.values())
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, `len(b) >= 14`.

- [ ] **Step 3: Replace the `cie` role in `content/experience.yaml`**

Change the role title to `Senior Platform Engineer, VA.gov Check-In` and replace its `bullets:` list with:

```yaml
        bullets:
          - id: cie-ownership
            text: >-
              Engineer of record for the four production services behind
              VA.gov patient check-in (~1.8M requests/day): Node.js Lambdas
              behind private API Gateways, DynamoDB, and the integration
              layer to the VA's electronic health record; owned application
              code, infrastructure, delivery pipeline, and on-call
            tags: [ownership, backend, serverless, aws, healthcare, govcloud]
            weight: 5
            evidence: "checkin-devops 74% of commits; chip 58%; lorota 64%; 15 CIE repos, ~5,970 commits Feb 2024–Sep 2026"
          - id: cie-platform-founded
            text: >-
              Founded the team's internal developer platform: Terraform and
              Terragrunt for a new AWS GovCloud account, 41 reusable modules
              integration-tested against live AWS on every pull request, 18
              composite GitHub Actions, and one OIDC role per repository so
              no long-lived AWS credentials exist anywhere in CI
            tags: [platform, terraform, aws, ci-cd, security, architecture]
            weight: 5
            evidence: "cie-terraform-modules, cie-github-actions, cie-iam-manager founded 2024-08-28; cd#533"
          - id: cie-account-cutover
            text: >-
              Led a multi-year migration of four production services to a
              new AWS account through a hard cutover, then decommissioned
              the legacy estate with evidence-gated, dry-run-default
              tooling and deleted the teardown tooling itself
            tags: [migration, aws, terraform, ownership, leadership]
            weight: 5
            evidence: "cutover 2026-07-29; chip#2532; cd#1912, cd#1958, cd#2002"
          - id: cie-silent-defect
            text: >-
              Found and fixed a long-standing silent authorization defect in
              one afternoon after noticing a sub-0.01% error rate while
              triaging old tickets; wrote the team's first postmortem and
              established its 24-hour postmortem policy; all 27 action items
              closed, three of them became new services
            tags: [incident-response, backend, healthcare, leadership, documentation]
            weight: 5
            evidence: "checkin-devops#575; cd#420 (policy)"
          - id: cie-upstream-api
            text: >-
              Founded a 26-function integration layer between the check-in
              services and the VA's EHR, text-messaging, and facilities
              systems, with pluggable per-endpoint backends selected by
              runtime configuration; used it to migrate 13 EHR integrations
              to a new provider endpoint by endpoint with zero downtime, then
              deleted the legacy path
            tags: [architecture, backend, healthcare, migration, node]
            weight: 5
            evidence: "cie-upstream-api (201 PRs, 764 tests); cd#1393–1403; upstream#468"
          - id: cie-self-describing-lambda
            text: >-
              Designed the self-describing Lambda convention (package
              manifest → Terraform autodiscovery → generated OpenAPI) adopted
              across four services, so adding an endpoint means adding a
              directory
            tags: [architecture, serverless, terraform, backend]
            weight: 4
            evidence: "chip#2085 (Dec 2024); upstream-api lambda_functions module"
          - id: cie-system-tests
            text: >-
              Built the end-to-end system-test suite (213 tests) that
              exercises real EHR appointment flows against deployed
              infrastructure, with trace context propagated into every
              service so a failing assertion links to the traces behind it;
              one codebase runs against mocks locally and real AWS in CI
            tags: [testing, healthcare, observability, aws]
            weight: 4
            evidence: "cie-system-tests (76 suites; 30-PR stabilization Aug–Nov 2025)"
          - id: cie-cost
            text: >-
              Identified and eliminated significant idle serverless capacity
              using a reproducible cost model, including two tiers of
              provisioned Lambda capacity that had never served a request;
              sized production concurrency from measured peaks with Little's
              Law
            tags: [cost, serverless, aws, observability]
            weight: 4
            evidence: "docs/chip-idle-capacity-cost-analysis.md; cd#1687; upstream#542; chip#2572"
          - id: cie-monitors-as-code
            text: >-
              Monitors-as-code across two Datadog organizations (46
              monitors, 7 dashboards) with dead-man switches on both
              check-in activity and the monitoring itself, cutover-aware
              queries, and thresholds derived from 30 days of measured error
              rates; adopted 21 hand-built monitors by import without
              changing their IDs
            tags: [observability, terraform, incident-response]
            weight: 4
            evidence: "cie-datadog-monitoring (Nov 2025–Aug 2026)"
          - id: cie-credentials
            text: >-
              Eliminated long-lived credentials from CI/CD: OIDC-assumed
              roles in every repository, GitHub App tokens replacing stored
              bot tokens, SHA-pinned actions from day one, and an hourly
              poller publishing vulnerability-alert counts with a dead-man
              monitor so a broken poller can never read as clean
            tags: [security, ci-cd, aws, observability]
            weight: 4
            evidence: "cd#514, cd#520, cd#1953, cd#1955"
          - id: cie-dependency-hygiene
            text: >-
              Closed the GitHub auto-merge hole where a skipped required
              check counted as a pass, then safely automated over a thousand
              dependency updates across 15 repositories with per-advisory
              security PRs and reachability analysis
            tags: [security, ci-cd]
            weight: 3
            evidence: "cd#1933, cd#1939; if: always() aggregating gate"
          - id: cie-cross-team
            text: >-
              Drove the platform-API side of the account migration across
              eight merged pull requests in another team's Rails service,
              plus reverse-proxy, manifest, and forward-proxy changes owned
              by three other teams, documenting and proposing rather than
              changing systems uninvited
            tags: [cross-team, leadership, backend]
            weight: 3
            evidence: "vets-api#23348, #28346, #28723, #28809, #29137; vsp-platform-revproxy#1281"
          - id: cie-structural-fixes
            text: >-
              Wrote four production postmortems with minute-level timelines
              and ticketed action items, then made the structural fixes:
              removed a flaky deploy-time dependency on an internal
              certificate server across seven repositories by moving
              certificate bundles to S3, and added a post-deploy health gate
              that caught a gateway Terraform had reported green
            tags: [incident-response, documentation, aws]
            weight: 3
            evidence: "cd#1570–1578; cd#1919; lorota#585"
          - id: cie-modernization
            text: >-
              Upgraded every service from Node 18 to 22 and the frontends
              across major React, MUI, and router versions; moved system
              tests off CodeBuild onto GitHub-hosted runners with a proxy
              client that let 198 tests reach private APIs with zero test
              edits
            tags: [migration, node, typescript, ci-cd]
            weight: 3
            evidence: "cd#1515–1521; cie-system-tests#196"
          - id: cie-ai-workflow
            text: >-
              Adopted spec-then-plan AI-assisted engineering with design
              specs and plans committed alongside the code, paired every
              time with hand-verified evidence: hashes of deployed
              configuration, CloudWatch tables, red-to-green test counts
            tags: [documentation, architecture]
            weight: 2
            evidence: "~200 Co-Authored-By commits, ~90 PR footers, Aug 2025 onward; chip#2514 hash proof"
```

- [ ] **Step 4: Remove the `cie` xfail**

In `tests/test_profiles.py`, change the parametrize entry
```python
    pytest.param("cie", marks=pytest.mark.xfail(strict=True, reason="cie leadership bullet arrives with the content rewrite")),
```
to plain `"cie",`. (Strict xfail would otherwise fail now that the bullet exists.)

- [ ] **Step 5: Run the full suite, tune caps if needed**

Run: `.venv/bin/python -m pytest -q`
If `test_page_budget` fails for a profile, apply the cap-reduction order from Global Constraints one step at a time to that profile and re-run until it passes. Record the final caps in the commit message.
Expected: all pass, 0 xfailed.

- [ ] **Step 6: Commit**

Message: `Write the Check-In role from the evidence file` + trailer.

---

### Task 7: CMS roles (Technical Lead and Senior Software/DevOps Engineer)

**Files:**
- Modify: `content/experience.yaml` (roles `cms-tl` and `cms-sse`)
- Test: `tests/test_content.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_content.py`:
```python
def test_cms_bullets():
    content = load_content(ROOT / "content")
    tl = _bullets(content, "cms-tl")
    sse = _bullets(content, "cms-sse")
    assert len(tl) >= 6 and len(sse) >= 12
    assert any("leadership" in x.tags for x in tl.values())
    assert any("leadership" in x.tags for x in sse.values())
    joined = " ".join(x.text for x in list(tl.values()) + list(sse.values()))
    assert "performed the upgrade" not in joined
    assert "Lagoon" not in joined
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL on counts.

- [ ] **Step 3: Replace the `cms-tl` role**

Title `Technical Lead, VA.gov CMS`; bullets:

```yaml
        bullets:
          - id: cms-tl-content-release
            text: >-
              Designed and executed a zero-downtime re-architecture of the
              VA.gov publishing pipeline into five tested Drupal modules with
              a plugin and resolver design, shipping ~15 pull requests
              alongside the legacy path and deleting it only after test
              parity (legacy module: 0 test files; replacement: 56)
            tags: [architecture, drupal, php, testing, migration]
            weight: 5
            evidence: "va.gov-cms#13844 (problem statement), #14160/#14191/#14212, #14157, #14424, #14478, #14794 (deletion)"
          - id: cms-tl-drupal10
            text: >-
              Led the Drupal 10 program for a multi-vendor CMS with ~30
              active contributors: seeded it 20 months early with a
              60-module checklist, opened 24 per-module compatibility
              tickets in a day for other teams to pick up, and de-risked the
              final 100-commit branch by backporting discrete concerns to
              main before it landed
            tags: [drupal, migration, leadership, cross-team]
            weight: 5
            evidence: "va.gov-cms#8159 (epic), #11014, #14852; D10 shipped 2023-11-29 by teammates with me as program owner"
          - id: cms-tl-cypress-parallel
            text: >-
              Cut end-to-end test wall time by roughly 60% with weighted
              three-way parallelization, and retired the last of the legacy
              Behat suite after a scenario-by-scenario audit (−3,170 lines)
            tags: [testing, ci-cd]
            weight: 4
            evidence: "va.gov-cms#14540, #14834, #14340"
          - id: cms-tl-incidents
            text: >-
              Ran and wrote up the team's production incidents with
              minute-level timelines and ticketed action items; diagnosed an
              autoscaling self-configuration flaw and proposed the PagerDuty
              routing, incident-response process, and on-call rotation
              changes that followed
            tags: [incident-response, documentation, leadership]
            weight: 4
            evidence: "va.gov-team-sensitive#1255, #1310, #1354; va.gov-cms#14923, #14920, #14319, #15086"
          - id: cms-tl-pre-refinement
            text: >-
              Ran Engineering Pre-Refinement with a published review rubric
              and estimation guide, keeping unrefined tickets out of sprint
              refinement; wrote the CODEOWNERS taxonomy for a ~10-team
              repository as an open request for comments
            tags: [leadership, documentation, cross-team]
            weight: 4
            evidence: "va.gov-cms#15581 (CODEOWNERS RfC); pre-refinement Q4 2023"
          - id: cms-tl-recruiting
            text: >-
              Recruited senior engineers and a QA architect to remediate
              systemic technical debt and flaky tests
            tags: [leadership, testing]
            weight: 3
            evidence: "from memory; discuss in interview"
          - id: cms-tl-ato
            text: >-
              Maintained Authority to Operate (ATO) for EHR-integrated
              systems handling protected health information, resolving
              regulatory identity gaps through audits and tabletop exercises
            tags: [ato, federal, security, healthcare]
            weight: 3
            evidence: "from memory; discuss in interview"
```

- [ ] **Step 4: Replace the `cms-sse` role**

Title `Senior Software/DevOps Engineer, VA.gov CMS`; bullets:

```yaml
        bullets:
          - id: cms-sse-quality-program
            text: >-
              Hired as a backend engineer; started and led the quality
              program that became the team's written test strategy: owned
              the Behat-to-Cypress migration from first port to removal,
              grew PHPUnit from 20 to 106 classes, introduced PHPStan with a
              committed baseline cut from 288 to 100 findings, and added
              axe-based WCAG 2.1 checks to the create and view flow of every
              content type; 62% of the test codebase by blame at exit
            tags: [testing, leadership, mentoring, drupal, php]
            weight: 5
            evidence: "va.gov-cms#4589, #8746, #6026, #10737, #12620, #14133; #9882 (QA & Testing Strategy)"
          - id: cms-sse-ci-unification
            text: >-
              Moved CI from preview-environment scripts into GitHub Actions
              and unified every check into one command surface that runs
              identically on a laptop, in previews, on the deploy platform,
              and in CI (−4,081 lines); added a set-pending action so status
              can never read green before tests run
            tags: [ci-cd, platform, architecture]
            weight: 5
            evidence: "va.gov-cms#12192, #10712, #10715, #4880"
          - id: cms-sse-scope
            text: >-
              Top human committer on the Drupal platform behind VA.gov
              content for 39 months, across ~30 active contributors from
              several vendors: 532 merged pull requests, 743 issues
              authored, and 1,068 code reviews across 12 repositories,
              reviewing roughly twice as many changes as I wrote
            tags: [ownership, drupal, php, backend, cross-team]
            weight: 4
            evidence: "git and GitHub counts as of 2026-09-11; 580 non-merge commits vs next 263"
          - id: cms-sse-dora
            text: >-
              Built DORA-style delivery metrics from scratch (lead time,
              change failure rate, time to restore) by walking Git history
              and GitHub commit statuses, emitted from the deploy pipeline
              even when tests fail, into Datadog dashboards
            tags: [observability, ci-cd, backend, node]
            weight: 4
            evidence: "va.gov-cms#13948 → #14089; devops#13155; preceded by 13-ticket QA-metrics epic #11070"
          - id: cms-sse-supply-chain
            text: >-
              Hardened GitHub Actions as a supply-chain surface: SHA-pinned
              every action, wrote the hardening guide, built an action that
              posts a security checklist on any workflow edit, and responded
              the same day to a CISA advisory; wrote a risk-based
              dependency-alert policy and triaged 545 dependency PRs
            tags: [security, ci-cd, documentation]
            weight: 4
            evidence: "va.gov-cms#10617, #11199, #10955, #13622, #10703; content-build#1291"
          - id: cms-sse-drupal9
            text: >-
              Drove the Drupal 8 to 9 upgrade end to end: compatibility
              sweep across every custom module, removed ~14 blocking contrib
              modules, replaced a task runner with a framework conflict, and
              kept core current through ~16 bumps including same-day security
              releases
            tags: [drupal, migration, php]
            weight: 4
            evidence: "va.gov-cms#4321, #5259, #5667, #5350–#5354"
          - id: cms-sse-observability
            text: >-
              Built the CMS's Datadog observability layer as Terraform in the
              platform team's repository: synthetics with PagerDuty routing,
              load-balancer log forwarding, application and web-server log
              shipping, latency and error dashboards; then deliberately
              un-Terraformed the dashboards, with written reasoning, to keep
              small tweaks fast
            tags: [observability, terraform, cross-team]
            weight: 4
            evidence: "devops Oct 2021–Apr 2023; devops#12444, #12761"
          - id: cms-sse-guest
            text: >-
              Sustained a guest-contributor role in seven other teams'
              repositories for three years, 121 merged pull requests and 219
              reviews, from early Ansible fixes to platform-wide corrections
              in autoscaling lifecycle and machine-image build code; every PR
              stated blast radius, testing done, and merge ordering
            tags: [cross-team, aws, platform, leadership]
            weight: 4
            evidence: "devops#10930, #12461, #8305; content-build#965"
          - id: cms-sse-flaky
            text: >-
              Ran a systematic flaky-test program with 20+ root-cause fixes,
              including cross-suite epoch timestamps so concurrent test logs
              could be merged to locate database deadlocks; every disabled
              test got a re-enable issue, several closed a year later
            tags: [testing, incident-response]
            weight: 4
            evidence: "va.gov-cms#11238, #12633, #12418, #11527"
          - id: cms-sse-release-safety
            text: >-
              Caught a release-safety hole where auto-deploy consulted
              combined status before checks had reported and shipped a
              commit whose tests had failed; fixed it at the
              status-reporting layer
            tags: [ci-cd, testing, incident-response]
            weight: 4
            evidence: "va.gov-cms#12851 → #14668; devops#13306"
          - id: cms-sse-data-repair
            text: >-
              Repaired a content-cloning defect that had attached paragraphs
              to multiple pages using idempotent, transactional scripts with
              a built-in correctness oracle (serialize, replace,
              re-serialize, diff, throw on any unexpected change), promoted
              from local through preview and test to production with
              published logs
            tags: [backend, drupal, php]
            weight: 3
            evidence: "va.gov-cms#3497, #3592, #5852; later #11719"
          - id: cms-sse-new-team-tests
            text: >-
              Wrote the test strategy, reference suite, and example-test
              curriculum for a newly created Next.js team two months after
              its repository existed (Jest, axe, TypeScript, coverage
              thresholds)
            tags: [testing, mentoring, documentation, typescript]
            weight: 3
            evidence: "next-build#15, #41, #54 (May–Jul 2022)"
          - id: cms-sse-performance
            text: >-
              Introduced Memcache across every environment with a kill
              switch, benchmarked it under load and reported the modest
              gains honestly, and diagnosed a connection-exhaustion problem
              (512 → 13 connections) that unblocked a 640-test suite;
              appended trace IDs to every application log line and exported
              content-health metrics to Prometheus
            tags: [backend, drupal, observability]
            weight: 3
            evidence: "va.gov-cms#5065–#5083, #6745, #8898, #5386, #12856"
          - id: cms-sse-runner-lifecycle
            text: >-
              Wrote the lifecycle service that retires aging self-hosted CI
              runner instances using GitHub's own view of runner idleness,
              with dry-run and threshold controls
            tags: [ci-cd, aws, node]
            weight: 2
            evidence: "content-build#1676, #1687; devops#13366"
```

- [ ] **Step 5: Run the full suite, tune caps if needed**

Same procedure as Task 6 Step 5. Expected: all pass.

- [ ] **Step 6: Commit**

Message: `Write the CMS roles from the evidence file` + trailer.

---

### Task 8: Convention News and DEVONtechnologies roles

**Files:**
- Modify: `content/experience.yaml` (roles `ain` and `devon`)
- Test: `tests/test_content.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_content.py`:
```python
def test_earlier_roles_make_the_arc_explicit():
    content = load_content(ROOT / "content")
    ain = _bullets(content, "ain")
    assert "ain-arc" in ain and ain["ain-arc"].weight == 5
    assert all(b.evidence == "from memory; discuss in interview" for b in ain.values())
    devon = _bullets(content, "devon")
    assert len(devon) == 3
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL, `ain-arc` missing.

- [ ] **Step 3: Replace the `ain` role bullets**

```yaml
        bullets:
          - id: ain-arc
            text: >-
              Joined to improve developer experience (local environments,
              small fixes) and left owning the platform: migrated every
              service off a managed Drupal host onto AWS, cutting annual
              infrastructure cost by about 70%, and built the backend,
              subscription platform, and public APIs
            tags: [ownership, migration, aws, platform, backend]
            weight: 5
            evidence: "from memory; discuss in interview"
          - id: ain-headless-architecture
            text: >-
              Engineered a headless Drupal and Next.js architecture on AWS,
              integrating Stripe and AWS Cognito for subscription services
              with independent scaling
            tags: [architecture, backend, aws, drupal, typescript]
            weight: 4
            evidence: "from memory; discuss in interview"
          - id: ain-ci-cd
            text: >-
              Established CI/CD pipelines and containerized development
              environments, taking deployments from occasional to multiple
              times daily
            tags: [ci-cd, platform]
            weight: 4
            evidence: "from memory; discuss in interview"
          - id: ain-lambda-services
            text: >-
              Built Lambda-based subscriber services and data pipelines with
              CloudWatch and Slack for real-time monitoring; improved
              performance with Varnish and Redis caching
            tags: [serverless, backend, observability, aws]
            weight: 3
            evidence: "from memory; discuss in interview"
          - id: ain-mentoring
            text: >-
              Mentored junior engineers on clean code and peer review,
              improving ticket turnaround and codebase maintainability
            tags: [mentoring, leadership]
            weight: 3
            evidence: "from memory; discuss in interview"
          - id: ain-devex
            text: >-
              Built the Vagrant-based local development environment every
              engineer used, later containerized, so the team ran one stack
            tags: [platform, ci-cd]
            weight: 2
            evidence: "from memory; discuss in interview"
```

- [ ] **Step 4: Replace the `devon` role bullets**

```yaml
        bullets:
          - id: devon-sync-ownership
            text: >-
              Took ownership of a complex sync subsystem during a high-risk
              engineer transition, supporting release stabilization, defect
              resolution, and customer issue triage
            tags: [ownership, backend, macos]
            weight: 4
            evidence: "from memory; discuss in interview"
          - id: devon-sync-features
            text: >-
              Developed client-side features and synchronization for
              DEVONthink across macOS and iOS, spanning cloud-storage and
              peer-to-peer sync backends
            tags: [backend, macos]
            weight: 3
            evidence: "from memory; discuss in interview"
          - id: devon-legacy-objc
            text: >-
              Contributed to release engineering and iterative debugging in
              a legacy Objective-C codebase with significant performance,
              reliability, and memory-management constraints
            tags: [backend, macos, ci-cd]
            weight: 2
            evidence: "from memory; discuss in interview"
```

- [ ] **Step 5: Run the full suite, tune caps if needed**

Same procedure as Task 6 Step 5. Expected: all pass.

- [ ] **Step 6: Commit**

Message: `Write the Convention News and DEVONtechnologies roles` + trailer.

---

### Task 9: Deliberate profile tuning

**Files:**
- Modify: `profiles/commercial-senior-swe.yaml`, `profiles/govtech-platform.yaml`
- Test: `tests/test_profiles.py`

The tag rule picks by relevance and weight; this task checks the result against the throughline and pins it with `include`/`exclude` where the rule chose wrong.

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_profiles.py`:
```python
def _selected_ids(name):
    sel = _sel(name)
    return {b.id for e in sel.employers for r in e.roles for b in r.bullets}


@pytest.mark.parametrize("name", ["commercial-senior-swe", "govtech-platform"])
def test_tuned_profiles_carry_the_throughline(name):
    ids = _selected_ids(name)
    # identity: safe to change
    assert "cie-platform-founded" in ids
    assert "cms-tl-content-release" in ids
    assert "cms-sse-quality-program" in ids
    # proof: finds what is silently wrong
    assert "cie-silent-defect" in ids
    assert "cms-sse-release-safety" in ids or "cms-sse-flaky" in ids
    # outcome: owner of record
    assert "cie-ownership" in ids
    assert "ain-arc" in ids
    assert "devon-sync-ownership" in ids


def test_commercial_hides_federal_only_bullets():
    ids = _selected_ids("commercial-senior-swe")
    assert "cms-tl-ato" not in ids


def test_govtech_shows_ato():
    ids = _selected_ids("govtech-platform")
    assert "cms-tl-ato" in ids
```

- [ ] **Step 2: Run to see which fail**

Run: `.venv/bin/python -m pytest -q tests/test_profiles.py`
Some assertions may already pass via the tag rule; note which fail.

- [ ] **Step 3: Pin with include/exclude**

For each failing assertion, add the bullet id to that profile's `include:` list (or `exclude:` for `cms-tl-ato` on commercial if the tag rule selected it). Prefer `include` over raising caps. If an `include` pushes a profile over its page budget, remove the lowest-weight selected bullet from that role via `exclude` rather than lowering the cap.

- [ ] **Step 4: Build both profiles and inspect**

Run: `.venv/bin/python build.py --all && .venv/bin/python -c "from tunable.pdf import page_count; from pathlib import Path; [print(p.name, page_count(p)) for p in sorted(Path('dist').glob('resume-*.pdf'))]"`
Expected: both tuned profiles at 2 pages or fewer. Open `dist/resume-commercial-senior-swe.pdf` and `dist/resume-govtech-platform.pdf`; confirm no orphaned section heading at a page break (a heading alone at the bottom of page 1). If one exists, exclude the last bullet of the preceding role and re-check.

- [ ] **Step 5: Run the full suite**

Expected: all pass.

- [ ] **Step 6: Commit**

Message: `Tune commercial and govtech profiles to the throughline and page budget` + trailer, listing the final caps and any include/exclude ids in the body.

---

### Task 10: Page budgets checked on pull requests

**Files:**
- Modify: `.github/workflows/continuous_delivery.yaml`

- [ ] **Step 1: Split the build job's guard**

Remove `if: github.event_name == 'push'` from the `build` job itself. Add `if: github.event_name == 'push'` to the "Upload Pages artifact" and "Deploy to GitHub Pages" steps. Change the job's `environment:` block so it only applies on push: since a step-level `if` cannot gate `environment`, move deployment into a third job:

```yaml
  build:
    needs: test
    runs-on: ubuntu-latest
    container:
      image: texlive/texlive:latest
    steps:
      # ... checkout, apt, venv, pytest, build.py --all, glyph check unchanged ...
      - name: Upload Pages artifact
        if: github.event_name == 'push'
        uses: actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b # v4.0.0
        with:
          path: dist

  deploy:
    needs: build
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e # v4.0.5
```

Remove `permissions` and `environment` from the `build` job (it only needs `contents: read`, inherited from the top level).

- [ ] **Step 2: Validate**

Run: `yq '.jobs | keys' .github/workflows/continuous_delivery.yaml`
Expected: `- build`, `- deploy`, `- test`.

- [ ] **Step 3: Commit**

Message: `Check page budgets on pull requests; deploy only on push` + trailer.

---

## Self-review against the spec

- §2 throughline: summaries (Task 2), bullets (Tasks 6–8), pinned by `test_tuned_profiles_carry_the_throughline` (Task 9). Leadership per Agile Six role: `cie-account-cutover`, `cie-silent-defect`, `cie-cross-team`; `cms-tl-*` several; `cms-sse-quality-program`, `cms-sse-guest`. Team size absent (`test_cie_bullets`). No TLA+/formal verification (Task 4 lint plus tests in Tasks 2, 3, 5).
- §3 sensitivity: no dollar figures ("significant" in `cie-cost`), no defect/outage durations ("long-standing" in `cie-silent-defect`; incidents bullet carries no durations), no impact counts, no PHI incident, no blame. The existing lint covers the regex classes; the new pattern covers formal verification.
- §10 content plan: master inventory sizes met (cie 15, cms-tl 7, cms-sse 14, ain 6, devon 3); Convention News arc explicit (`ain-arc`); self-initiated QA program explicit (`cms-sse-quality-program`); Goldentooth reframed, Hornvale added, Whispers/Distillation tagged `research`/`ml`; honest open-source note without OpenTofu; skills regrouped, TLA+ removed; three summary variants.
- Evidence caveats: Drupal 10 bullet says "led the program" and its evidence notes teammates landed it; Lagoon absent; Cypress figure "roughly 60%"; no cost figures.
- Deferred items from the tooling review picked up here: `core` tag (Task 1), TLA+ lint (Task 4), PR page-budget builds (Task 10). Still open, deliberately: whether `--all` should publish `resume-master.pdf`.
- Type consistency: `_bullets` helper defined in Task 6 and reused in Tasks 7 and 8 within the same test file; `_sel` already exists in `tests/test_profiles.py`; `page_count` is `tunable.pdf.page_count`.
- Placeholders: none.
