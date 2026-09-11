"""Drive lualatex and pdftotext. Everything here shells out; keep it thin."""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def have_lualatex() -> bool:
    return shutil.which("lualatex") is not None


def compile(tex_path: Path, out_dir: Path) -> Path:
    """Run lualatex twice (for cross-references) and return the PDF path."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = ["lualatex", "-interaction=nonstopmode", "-halt-on-error",
           f"-output-directory={out_dir}", str(tex_path)]
    for _ in range(2):
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=tex_path.parent)
        if r.returncode != 0:
            log = out_dir / f"{tex_path.stem}.log"
            tail = log.read_text(errors="replace")[-3000:] if log.exists() else r.stdout[-3000:]
            raise RuntimeError(f"lualatex failed for {tex_path.name}:\n{tail}")
    return out_dir / f"{tex_path.stem}.pdf"


def to_text(pdf: Path, txt: Path) -> None:
    subprocess.run(["pdftotext", "-raw", str(pdf), str(txt)], check=True)


def page_count(pdf: Path) -> int:
    from pypdf import PdfReader
    return len(PdfReader(str(pdf)).pages)
