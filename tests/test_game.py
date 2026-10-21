from pathlib import Path
import json
import shutil

import pytest

import build as build_mod
from tunable import game
from tunable.emailgen import resolve
from tunable.loader import ContentError, load_config, load_content

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


def test_unknown_start_mod_is_reported():
    design, content = real()
    design["start_mods"] = {"luck": 1}
    assert "start_mods: unknown mod 'luck'" in game.validate(design, content)


def test_unknown_mod_format_is_reported():
    design, content = real()
    design["mods"]["fireRate"]["format"] = "percent"
    assert "mods.fireRate: unknown format 'percent'" in game.validate(design, content)


def test_missing_mentee_ball_is_reported():
    design, content = real()
    design["balls"] = [b for b in design["balls"] if b["id"] != "mentee"]
    assert "balls: a 'mentee' ball is required (teammates fire it)" in game.validate(design, content)


def test_cite_of_a_project_note_is_reported():
    design, content = real()
    design["enemies"]["request"]["cites"] = ["open-source-note"]
    assert "enemies.request: cites unknown id 'open-source-note'" in game.validate(design, content)


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
    default = load_config(ROOT / "resume.yaml").default_profile
    tex = build_mod.build(default, root=ROOT, out_dir=tmp_path, pdf=False).read_text()
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
