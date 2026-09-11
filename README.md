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

A bullet may carry `alt: <key>`. Bullets sharing a key are alternative forms
of the same line (say, one emphasizing security, one emphasizing testing);
a profile renders only the best-ranked form, so tags decide which reading a
given job sees. To force the other form, `exclude` the one you do not want.

## Design

See `docs/superpowers/specs/2026-09-11-tunable-resume-design.md`.

![How a Programmer Reads Your Résumé](./images/resume_comic.png)
Credit: [Steve Hanov](http://stevehanov.ca/blog/index.php?id=56).
