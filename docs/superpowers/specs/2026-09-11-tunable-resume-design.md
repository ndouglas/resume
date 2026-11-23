# Tunable Résumé: Design

Date: 2026-09-11
Status: Approved in discussion; awaiting review of this document

## 1. Purpose

Replace the single hand-edited `resume.tex` with a content database, a set of
target profiles, and a generator, so that a résumé tuned to a specific job can
be produced by editing one small profile file while every bullet remains
traceable to evidence.

Motivation: the current contract recompetes in February 2027. The goal is to
be robustly marketable to two markets at once, commercial senior/staff
software or platform roles and other govtech contractors, without maintaining
divergent copies.

## 2. The throughline the content must carry

Agreed in discussion and to be preserved in every profile:

- **Identity:** a senior software engineer who makes production systems safe
  to change. Tests as the gate for every migration, legacy deleted only after
  parity, monitors that fail loud, CI with no long-lived credentials.
- **Proof:** finds what is silently wrong. A long-standing silent
  authorization defect, idle capacity that never served a request, a release
  pipeline that shipped failed commits.
- **Outcome:** becomes the owner of record wherever he works, by earning trust
  over time rather than arriving as a disruptor. This happened at
  DEVONtechnologies, Convention News, and twice at Agile Six.

Tone: report what happened. No selling language, no superlatives, no
aspirational claims. Formal verification (TLA+, Lean) is an interest, not a
skill, and does not appear.

Leadership must be visible without claiming a title: recruiting, running
refinement, decomposing work for others, reviewing more than authoring,
sustained guest work in other teams' repositories. Each tuned profile
requires at least one leadership-tagged bullet per Agile Six role. The
résumé does not mention team size.

## 3. Sensitivity rule

Applies to all content, now and later, and is enforced by a lint test:

- No dollar amounts. Use "significant."
- No durations of defects or outages. Use "long-standing."
- No counts of affected people.
- No mention of the PHI/PII logging incident.
- No blame language toward Agile Six, the VA, or prior teams. No quotes from
  postmortems.
- Private repository names and PR or issue numbers are acceptable in evidence
  fields; they are not rendered.

## 4. Repository layout

```
content/
  tags.yaml          # the tag vocabulary; unknown tags fail the build
  summary.yaml       # named summary variants
  experience.yaml    # employers → roles → bullets
  projects.yaml
  skills.yaml
  education.yaml
  languages.yaml
profiles/
  master.yaml
  commercial-senior-swe.yaml
  govtech-platform.yaml
templates/
  resume.tex.j2      # today's LaTeX styling with content slots
build.py
tests/
  test_schema.py, test_selection.py, test_render.py,
  test_sensitivity.py, test_pages.py
Makefile             # test, build, build-all, clean
requirements.txt     # pyyaml, jinja2, pytest (pypdf for page counts)
dist/                # CI output only; git-ignored
build/               # intermediate .tex and logs; git-ignored
docs/superpowers/specs/, docs/superpowers/plans/
```

`resume.tex`, `resume.pdf`, `resume.txt`, the `.aux/.log/.out` files, and
`generate_resume.sh` are removed once the generator reproduces the current
document from content. The README is rewritten to describe the new workflow.

## 5. Data model

### 5.1 Bullet

```yaml
- id: cie-account-cutover
  text: >-
    Led a multi-year AWS account migration of four production services to a
    hard cutover, then decommissioned the legacy estate with evidence-gated,
    dry-run-default tooling
  tags: [aws, terraform, migration, ownership, platform]
  weight: 5
  evidence: "checkin-devops#1958, chip#2532; cutover 2026-07-29"
```

- `id`: unique across the whole content set, kebab-case.
- `text`: plain text; the generator escapes LaTeX special characters. Unicode
  arrows and similar are allowed (the template already uses lualatex with
  fontspec).
- `tags`: non-empty, every entry present in `content/tags.yaml`.
- `weight`: integer 1 to 5, assigned by hand.
- `evidence`: non-empty free text. For roles without evidence files
  (Convention News, DEVONtechnologies) the value is
  `"from memory; discuss in interview"`.

### 5.2 Experience

```yaml
employers:
  - name: Agile Six Applications, Inc (contract to U.S. Department of Veterans Affairs)
    location: ""            # optional
    start: 2020-10
    end: present
    roles:
      - id: cie
        title: Senior Platform Engineer, VA.gov Check-In
        start: 2024-02
        end: present
        bullets: [...]
      - id: cms-tl
        title: Technical Lead, VA.gov CMS
        ...
      - id: cms-sse
        title: Senior Software/DevOps Engineer, VA.gov CMS
        ...
```

Role ids are unique across employers (`cie`, `cms-tl`, `cms-sse`, `ain`,
`devon`) and are what profiles refer to. Titles are the actual titles held.
Dates render as "Mon. YYYY".

### 5.3 Projects, skills, education, languages

Projects: `id`, `name`, `emoji` (optional), `url`, `text`, `stack` (list),
`tags`, `weight`, `evidence` (repo path or URL).

Skills: groups in order, each with `name` and `items`; each item has `text`
and `tags`. A profile's tag list trims items; a group with no surviving items
is omitted.

Education and languages: static lists with `tags` so a profile can drop the
languages section entirely.

### 5.4 Summary

`summary.yaml` holds named variants. Initial set:

- `commercial`: identity, then the most recent ownership scope in commercial
  terms ("four production healthcare services at ~1.8M requests/day").
- `govtech`: same identity, last sentence in VA terms, followed by the
  clearance line.
- `short`: two lines, identity only, for profiles that need the space.

### 5.5 Tags

`content/tags.yaml` is a flat list with a one-line description per tag.
Initial vocabulary, to be refined while authoring content:

```
backend platform aws kubernetes terraform serverless drupal php node typescript rust
testing ci-cd security observability incident-response cost migration
architecture ownership leadership mentoring documentation cross-team
federal ato fedramp govcloud healthcare
open-source ml research
```

### 5.6 Profile

```yaml
name: commercial-senior-swe
summary: commercial
clearance_line: false
email: auto                 # or a literal address
page_limit: 2
sections: [experience, skills, projects, education]
tags: [backend, platform, aws, terraform, serverless, testing, ci-cd,
       security, observability, migration, architecture, ownership, leadership]
caps:
  default: 5
  roles: {cie: 7, cms-tl: 4, cms-sse: 5, ain: 4, devon: 2}
  projects: 6
include: []                 # bullet or project ids that must appear (never more than the cap)
exclude: []                 # ids forced out
require:                    # per-role minimums for a tag, applied before the cap
  - {tag: leadership, min: 1, roles: [cie, cms-tl, cms-sse]}
```

`master.yaml` has no caps, no page limit, no tag filter, and every section.

## 6. Selection

For each role (and for projects, and for each skills group):

1. Start from all items. If the profile has a tag list, keep items sharing at
   least one tag with it.
2. Apply `exclude`, then `include` (an included item is kept even if the tag
   rule dropped it; the loader rejects an id in both lists).
3. Sort by number of shared tags descending, then weight descending, then
   original order.
4. Keep one form per `alt` key: an included form if the profile names one
   (the best-ranked of them if it names several), otherwise the best-ranked.
5. Truncate to the cap.
6. Promote every included item the cap left out, each evicting the
   lowest-ranked item that is neither included nor already promoted.
7. For each `require` entry that names this role, ensure at least `min`
   items with the tag are present by promoting the highest-ranked such
   items the same way; included and required items are never evicted.

`exclude` beats `include` beats the tag rule; `include` means the item
appears. No other scoring. The reason a bullet appears is predictable from
the profile file alone. The reason a bullet disappeared may be a promotion
elsewhere in the same role, so a profile author who pins with `include`
should expect the weakest tag-selected bullet in that role to drop out.

## 7. Generator

`build.py`, Python 3.11+, dependencies PyYAML and Jinja2.

```
python build.py --profile commercial-senior-swe [--email ADDR] [--no-pdf]
python build.py --all
```

- Loads content and profile, validates (same checks as the tests, so a bad
  file fails before rendering), selects, renders `build/resume-<profile>.tex`.
- Runs `lualatex` twice into `build/`, copies the PDF to
  `dist/resume-<profile>.pdf`, writes `dist/resume-<profile>.txt` via
  `pdftotext -raw`.
- The default profile (named in a top-level `resume.yaml` config) is also
  copied to `dist/resume.pdf` so existing links keep working.
- Jinja2 uses LaTeX-safe delimiters (`\BLOCK{...}`, `\VAR{...}`,
  `\#{...}` comments) so template braces never collide.
- Escaper handles `& % $ # _ { } ~ ^ \`.

Email: profile `email: auto` derives a `word.word####@tenesm.us` address from
a seeded RNG keyed on the profile name, using a small committed word list, so
each profile has a stable traceable address. `--email` overrides for a single
application. A literal `email:` value in the profile is used verbatim.

The template preserves the current LaTeX styling (fonts, margins, section
rules, emoji fallback). Content slots: header, optional clearance line,
summary, then sections in profile order.

## 8. Tests

pytest, `make test`. No TeX required except where noted.

- **Schema:** unique ids; required fields present; weight in 1–5; tags in
  vocabulary; evidence non-empty; dates parse and roles are in reverse
  chronological order.
- **Profiles:** every include/exclude id exists; summary variant exists;
  section names valid; tags in vocabulary; role ids in `caps` and `require` exist.
- **Selection:** deterministic; caps respected; exclude beats include beats
  tags; `require` minimums honoured; master selects everything.
- **Sensitivity lint:** rendered text for every profile matches none of:
  `\$\s?\d`, `\d[\d,]*\s*(veterans|patients|users)`,
  `\d+(\.\d+)?[-\s](minute|hour|day|month|year)s?\s+(outage|defect|bug)`,
  the strings "PHI leak", "PII leak". The pattern list lives in one place
  and is easy to extend.
- **Render:** every profile renders to `.tex` without error; escaper unit
  tests.
- **Page budget:** skipped when `lualatex` is absent; otherwise builds each
  profile with a `page_limit` and asserts the page count with pypdf.

## 9. CI

One workflow, two triggers:

- **Pull request:** install Python deps, `make test` (page-budget tests skip).
- **Push to main:** `make test`, then build every profile inside a full TeX
  Live container with the Noto emoji font installed via apt, run the
  page-budget tests against the real PDFs, and publish `dist/` to GitHub
  Pages. `dist/resume.pdf` remains the stable URL.

If the emoji font cannot be made to work in the container, the project emoji
become a template option (`emoji: false` in the profile) rather than a reason
to keep committing PDFs. Actions stay SHA-pinned with version comments.

## 10. Content plan

Bullets are authored from the two evidence files (CMS 2020–2024 and CIE
2024–2026), respecting each file's "caveats to keep you honest" section, and
from the current résumé for the two earlier employers.

Master inventory targets:

| Role | Master bullets | Tuned cap |
|---|---|---|
| Senior Platform Engineer, VA.gov Check-In (2024–) | ~14 | 7 |
| Technical Lead, VA.gov CMS (2023–2024) | ~6 | 4 |
| Senior Software/DevOps Engineer, VA.gov CMS (2020–2023) | ~12 | 5 |
| Convention News Company (2016–2020) | ~6 | 4 |
| DEVONtechnologies (2012–2015) | ~3 | 2 |

Convention News bullets make the arc explicit: started on developer
experience (local environments, small fixes), left having migrated every
service off Acquia to AWS, introduced CI/CD, and built the backend,
subscription platform, and APIs. The 2020–2023 CMS bullets make clear the
testing and CI program was self-initiated by a backend engineer, not an
assigned QA role.

Projects: Goldentooth reframed without TLA+ (17-node Talos/Kubernetes cluster
run through Flux GitOps with full observability, chaos testing, and a
117-entry engineering journal). Hornvale added, framed around guardrails
(architecture rules enforced as tests, byte-identical determinism verified
across platforms, hand-built serialized merge queue). Bitwit, Blackpool,
Greenstone, Longtable, Clork retained. Whispers and Distillation retained
with `research`/`ml` tags so the commercial profile drops them.

Open-source line: one modest sentence naming verified contributions (Ansible
community.general, Lando, Datadog serverless functions, Drupal Console,
Drupal, ReactiveCocoa, Terraform and Argo CD documentation), tagged
`open-source` with weight 1, off in tuned profiles by default. OpenTofu is
dropped; nothing was found.

Skills: TLA+ removed. Groups ordered by evidence weight: languages, cloud,
infrastructure as code, delivery, observability, testing. Every item tagged.

## 11. Out of scope

- Cover letters, LinkedIn text, the GitHub profile README (noted as stale;
  separate effort).
- A job-description-to-profile generator. Profiles are written by hand, with
  or without LLM assistance, and reviewed line by line.
- Rendering to formats other than PDF and text.

## 12. Migration

1. Tooling first: generator, template, tests, CI, with content transcribed
   from the current `resume.tex` unchanged, so the first build reproduces
   today's document from data.
2. Then content: rewrite bullets from the evidence files under the
   throughline and the sensitivity rule; add Hornvale; fix projects and
   skills; write the three summary variants.
3. Then profiles: tune the two target profiles against the two-page budget.
4. Remove the legacy files and rewrite the README.
