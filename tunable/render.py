"""Render a Selection into LaTeX source using the Jinja2 template.

Jinja delimiters are chosen so they never collide with LaTeX braces:
  \\BLOCK{ ... }   statements
  \\VAR{ ... }     expressions
  \\#{ ... }       comments
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
