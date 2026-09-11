from pathlib import Path
import subprocess
import sys
import pytest
from tunable import pdf
from tunable.loader import load_content, load_profile
import build as build_mod

ROOT = Path(__file__).resolve().parent.parent
PROFILES = sorted(p.stem for p in (ROOT / "profiles").glob("*.yaml"))


@pytest.mark.parametrize("name", PROFILES)
def test_render_only(tmp_path: Path, name):
    tex = build_mod.build(name, root=ROOT, out_dir=tmp_path, pdf=False)
    assert tex.name == f"resume-{name}.tex"
    assert r"\end{document}" in tex.read_text()


def test_email_override(tmp_path: Path):
    tex = build_mod.build("master", root=ROOT, out_dir=tmp_path, email="me@example.com", pdf=False)
    assert "me@example.com" in tex.read_text()


def test_auto_email_is_stable(tmp_path: Path):
    a = build_mod.build("master", root=ROOT, out_dir=tmp_path / "a", pdf=False).read_text()
    b = build_mod.build("master", root=ROOT, out_dir=tmp_path / "b", pdf=False).read_text()
    assert a == b
    assert "@tenesm.us" in a


def test_cli_reports_validation_errors(tmp_path: Path):
    bad = tmp_path / "profiles"
    bad.mkdir()
    (bad / "broken.yaml").write_text("name: broken\nsummary: nope\nclearance_line: false\nemail: auto\nsections: [experience]\n")
    for name in ("content", "templates", "resume.yaml"):
        target = tmp_path / name
        src = ROOT / name
        if src.is_dir():
            import shutil
            shutil.copytree(src, target)
        else:
            target.write_text(src.read_text())
    r = subprocess.run([sys.executable, str(ROOT / "build.py"), "--profile", "broken", "--no-pdf", "--root", str(tmp_path)],
                       capture_output=True, text=True)
    assert r.returncode == 1
    assert "unknown summary variant 'nope'" in r.stderr


@pytest.mark.skipif(not pdf.have_lualatex(), reason="lualatex not installed")
def test_build_with_relative_out_dir(tmp_path: Path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    build_mod.build("master", root=ROOT, out_dir=Path("relative-out-dir"), pdf=True)
    assert (tmp_path / "relative-out-dir" / "resume-master.pdf").exists()


@pytest.mark.skipif(not pdf.have_lualatex(), reason="lualatex not installed")
@pytest.mark.parametrize("name", PROFILES)
def test_page_budget(tmp_path: Path, name):
    content = load_content(ROOT / "content")
    profile = load_profile(ROOT / "profiles" / f"{name}.yaml", content)
    if profile.page_limit is None:
        pytest.skip("no page limit")
    tex = build_mod.build(name, root=ROOT, out_dir=tmp_path, pdf=True)
    out = tmp_path / f"resume-{name}.pdf"
    assert out.exists()
    assert pdf.page_count(out) <= profile.page_limit
