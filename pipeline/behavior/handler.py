"""Volunteer / handler requirements per dog.

Maps the handling level to an experience requirement (from config/levels.json's
``handler_map``) and adds short, template-based handling notes drawn from the dog's
events and scores. No LLM; all notes pass the guardrails.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .guardrails import sanitize
from .schemas import Scores
from .settings import CONFIG_DIR

_DEFAULT_MAP = {
    "Green":  {"min_experience": "any",         "label": "Any trained volunteer"},
    "Yellow": {"min_experience": "some",        "label": "Volunteers with 3+ months"},
    "Orange": {"min_experience": "experienced", "label": "Experienced handlers only"},
    "Red":    {"min_experience": "staff",       "label": "Behavior staff only"},
}


def load_handler_map(config_dir: Optional[Path] = None) -> dict:
    path = (config_dir or CONFIG_DIR) / "levels.json"
    try:
        cfg = json.loads(path.read_text())
        return cfg.get("handler_map", _DEFAULT_MAP)
    except Exception:
        return _DEFAULT_MAP


def _notes(events: list[dict], scores: Scores) -> list[str]:
    notes: list[str] = []
    rush = sum(1 for e in events if e.get("type") == "acceleration")
    jump = sum(1 for e in events if e.get("type") == "jump")
    calm = [e for e in events if e.get("type") == "calm"]

    if rush >= 2:
        notes.append(f"Approach slowly, rushed the front {rush} times.")
    elif rush == 1:
        notes.append("Approach slowly, rushed the front once.")
    if jump >= 1:
        notes.append("May jump up at the gate, keep a steady hold.")
    if calm:
        notes.append("Settles within a few minutes.")
    if scores.approachability >= 80 and not notes:
        notes.append("Greets new people easily.")
    if scores.energy >= 65:
        notes.append("High energy, plan an active session.")
    return notes[:3]


def compute_handler(handling_level: str, events: list[dict], scores: Scores,
                    *, config_dir: Optional[Path] = None) -> dict:
    """Return {min_experience, label, notes[]} for the dog."""
    hmap = load_handler_map(config_dir)
    base = hmap.get(handling_level, _DEFAULT_MAP.get(handling_level, _DEFAULT_MAP["Yellow"]))
    notes = _notes(events or [], scores)
    for n in notes:
        sanitize(n, _path="handler.note")
    return {
        "min_experience": base["min_experience"],
        "label": base["label"],
        "notes": notes,
    }
