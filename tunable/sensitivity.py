"""Patterns that must never appear in rendered résumé text.

Encodes the sensitivity rule from the design spec (§3, §8). Add a pattern here
and it applies to every profile, present and future.
"""
import re

PATTERNS: list[tuple[str, re.Pattern]] = [
    ("dollar amount", re.compile(r"\$\s?\d[\d,.]*[KkMm]?")),
    ("people count", re.compile(r"\d[\d,]*\s*(veterans|patients|users)\b", re.I)),
    ("incident duration", re.compile(
        r"\d+(\.\d+)?[-\s](minute|hour|day|month|year)s?\s+(outage|defect|bug)\b", re.I)),
    ("PHI/PII incident", re.compile(r"\bP[HI]I leak\b", re.I)),
]


def violations(text: str) -> list[str]:
    found = []
    for name, pattern in PATTERNS:
        for m in pattern.finditer(text):
            found.append(f"{name}: {m.group(0)}")
    return found
