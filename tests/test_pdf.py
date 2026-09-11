from pathlib import Path
import pytest
from tunable import pdf

MINIMAL_TEX = r"""
\documentclass{article}
\begin{document}
Hello. \newpage Second page.
\end{document}
"""


def test_have_lualatex_is_bool():
    assert isinstance(pdf.have_lualatex(), bool)


@pytest.mark.skipif(not pdf.have_lualatex(), reason="lualatex not installed")
def test_compile_and_count_pages(tmp_path: Path):
    tex = tmp_path / "min.tex"
    tex.write_text(MINIMAL_TEX)
    out = pdf.compile(tex, tmp_path / "out")
    assert out.exists() and out.suffix == ".pdf"
    assert pdf.page_count(out) == 2
    txt = tmp_path / "min.txt"
    pdf.to_text(out, txt)
    assert "Hello" in txt.read_text()
