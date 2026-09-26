#!/usr/bin/env python3
"""Render one or all résumé profiles.

  python build.py --profile commercial-senior-swe [--email ADDR] [--no-pdf]
  python build.py --all
  python build.py --game
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from tunable import pdf as pdfmod
from tunable import game as gamemod
from tunable.emailgen import load_words, resolve
from tunable.loader import ContentError, load_config, load_content, load_profile
from tunable.render import render
from tunable.select import select

ROOT = Path(__file__).resolve().parent


def build(profile_name: str, *, root: Path = ROOT, out_dir: Path | None = None,
          email: str | None = None, pdf: bool = True) -> Path:
    """Render a profile. Returns the .tex path; the PDF and .txt sit beside it in out_dir."""
    out_dir = (out_dir or root / "dist").resolve()
    build_dir = (root / "build").resolve()
    config = load_config(root / "resume.yaml")
    content = load_content(root / "content")
    profile = load_profile(root / "profiles" / f"{profile_name}.yaml", content)

    if email is None:
        email = resolve(profile.email, profile.name, config.email_domain, load_words(root / "content" / "words.txt"))

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
    g.add_argument("--game", action="store_true", help="build only the game into <out>/game")
    ap.add_argument("--email", help="override the rendered email address")
    ap.add_argument("--no-pdf", action="store_true", help="render .tex only")
    ap.add_argument("--out", type=Path, help="output directory (default: dist/)")
    ap.add_argument("--root", type=Path, default=ROOT, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)

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


if __name__ == "__main__":
    sys.exit(main())
