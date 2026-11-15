"""Handling level (Green/Yellow/Orange/Red) from scores, using config/levels.json.

Rules are ordered; the first whose conditions all hold wins. Each condition maps a
score field to inclusive {min, max} bounds. Risk is communicated only through these
four level names (never the banned words). Thresholds live in config so they can be
tuned without code changes.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .guardrails import HANDLING_LEVELS
from .schemas import Scores
from .settings import CONFIG_DIR

_VALID = set(HANDLING_LEVELS)


def _matches(scores: Scores, when: dict) -> bool:
    values = {
        "energy": scores.energy,
        "stress": scores.stress,
        "approachability": scores.approachability,
        "confidence": scores.confidence,
        "arousal_spikes": scores.arousal_spikes,
    }
    for field, bounds in when.items():
        v = values.get(field)
        if v is None:
            return False
        if "min" in bounds and v < bounds["min"]:
            return False
        if "max" in bounds and v > bounds["max"]:
            return False
    return True


def load_rules(config_dir: Optional[Path] = None) -> dict:
    path = (config_dir or CONFIG_DIR) / "levels.json"
    return json.loads(path.read_text())


def assign_level(scores: Scores, *, config_dir: Optional[Path] = None) -> str:
    """Return the handling level for ``scores`` (first matching rule wins)."""
    cfg = load_rules(config_dir)
    for rule in cfg.get("rules", []):
        level = rule.get("level")
        if level in _VALID and _matches(scores, rule.get("when", {})):
            return level
    default = cfg.get("default", "Yellow")
    return default if default in _VALID else "Yellow"
