"""Stable, traceable catch-all addresses: one per profile, derived from its name."""
import hashlib
import random
from pathlib import Path


def load_words(path: Path) -> list[str]:
    return [w for w in path.read_text().split() if w]


def address(profile_name: str, domain: str, words: list[str]) -> str:
    seed = int.from_bytes(hashlib.sha256(profile_name.encode()).digest()[:8], "big")
    rng = random.Random(seed)
    first, second = rng.sample(words, 2)
    return f"{first}.{second}{rng.randint(0, 9999):04d}@{domain}"


def resolve(profile_email: str, profile_name: str, domain: str, words: list[str]) -> str:
    """A profile's rendered address: its literal email, or the derived one for "auto"."""
    return address(profile_name, domain, words) if profile_email == "auto" else profile_email
