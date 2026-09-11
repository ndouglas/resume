from pathlib import Path
from tunable.loader import load_content, load_profile, load_config

ROOT = Path(__file__).resolve().parent.parent


def test_real_content_loads():
    content = load_content(ROOT / "content")
    assert {"cie", "cms-tl", "cms-sse", "ain", "devon"} <= content.role_ids()
    assert "commercial" in content.summaries


def test_every_profile_loads():
    content = load_content(ROOT / "content")
    paths = sorted((ROOT / "profiles").glob("*.yaml"))
    assert paths, "no profiles found"
    for p in paths:
        profile = load_profile(p, content)
        assert profile.name == p.stem, f"{p.name}: name must match filename"


def test_config_loads():
    cfg = load_config(ROOT / "resume.yaml")
    assert (ROOT / "profiles" / f"{cfg.default_profile}.yaml").exists()


def test_words_list_is_usable():
    words = [w for w in (ROOT / "content" / "words.txt").read_text().split() if w]
    assert len(words) >= 50
    assert all(w.isalpha() and w.islower() for w in words)
