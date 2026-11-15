"""Guardrail enforcement for the behavior pipeline.

Two rules, enforced in code rather than by convention:

1. Banned words. The strings "aggressive", "dangerous", and "menace" must never
   appear in any output, label, need, log line, or stored record. ``sanitize``
   walks any output object and raises if a banned word is found (case-insensitive,
   whole-word). Risk is communicated only through handling levels
   (Green/Yellow/Orange/Red) and plain-English needs.

2. Breed exclusion. Breed is never an input to any model, feature, score, or rule.
   ``assert_no_breed`` rejects any mapping that carries a breed-like key, so a
   source record can be checked at the ingest boundary before it flows downstream.
"""

from __future__ import annotations

import re
from typing import Any

# Communicated risk vocabulary — the only allowed way to express handling risk.
HANDLING_LEVELS = ("Green", "Yellow", "Orange", "Red")
TREND_VALUES = ("improving", "stable", "worsening")

BANNED_WORDS = ("aggressive", "dangerous", "menace")
_BANNED_RE = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in BANNED_WORDS) + r")\b",
    re.IGNORECASE,
)

# Keys that would smuggle breed into the pipeline. Checked at the ingest boundary.
_BREED_KEYS = {"breed", "breeds", "breed_name", "dog_breed", "primary_breed"}


class GuardrailViolation(ValueError):
    """Raised when output would break a guardrail (banned word or breed input)."""


def find_banned(text: str) -> list[str]:
    """Return the banned words present in ``text`` (lowercased, deduped, ordered)."""
    found: list[str] = []
    for match in _BANNED_RE.findall(text or ""):
        word = match.lower()
        if word not in found:
            found.append(word)
    return found


def sanitize(obj: Any, *, _path: str = "output") -> Any:
    """Recursively verify no banned word appears anywhere in ``obj``.

    Walks strings inside dicts, lists, tuples, and sets. Returns ``obj`` unchanged
    on success so it can wrap a value inline. Raises ``GuardrailViolation`` on the
    first banned word, naming where it was found.
    """
    if isinstance(obj, str):
        hits = find_banned(obj)
        if hits:
            raise GuardrailViolation(
                f"Banned word(s) {hits} found at {_path!r}: {obj!r}"
            )
        return obj
    if isinstance(obj, dict):
        for key, value in obj.items():
            # Keys are usually literals, but check them too for safety.
            if isinstance(key, str):
                sanitize(key, _path=f"{_path}.<key>")
            sanitize(value, _path=f"{_path}.{key}")
        return obj
    if isinstance(obj, (list, tuple, set)):
        for i, value in enumerate(obj):
            sanitize(value, _path=f"{_path}[{i}]")
        return obj
    # Numbers, bools, None, and other non-string scalars cannot carry banned words.
    return obj


def assert_no_breed(record: Any, *, _path: str = "source") -> Any:
    """Reject any mapping carrying a breed-like key.

    Called at the ingest boundary so breed never flows into features or scores.
    Returns ``record`` unchanged on success.
    """
    if isinstance(record, dict):
        for key in record:
            if isinstance(key, str) and key.strip().lower() in _BREED_KEYS:
                raise GuardrailViolation(
                    f"Breed is not an allowed input; found key {key!r} at {_path!r}"
                )
        for key, value in record.items():
            assert_no_breed(value, _path=f"{_path}.{key}")
    elif isinstance(record, (list, tuple, set)):
        for i, value in enumerate(record):
            assert_no_breed(value, _path=f"{_path}[{i}]")
    return record
