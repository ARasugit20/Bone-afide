"""Plain-English needs from scores (and a few features), using config/needs.json.

Rules are evaluated in order; each rule whose conditions all hold contributes its
plain-English need text. Duplicates are removed and the list is capped at
``max_needs``. Every emitted string is passed through ``guardrails.sanitize`` so a
banned word can never reach a stored record. If no rule matches, a neutral fallback
is used.

Fields a rule may test: the five score fields plus ``jumps_per_min`` (from the clip
features), so a jumping dog can get an excitability-related need.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .guardrails import sanitize
from .schemas import ClipFeatures, Scores
from .settings import CONFIG_DIR


def _values(scores: Scores, features: Optional[ClipFeatures]) -> dict:
    v = {
        "energy": scores.energy,
        "stress": scores.stress,
        "approachability": scores.approachability,
        "confidence": scores.confidence,
        "arousal_spikes": scores.arousal_spikes,
    }
    if features is not None:
        v["jumps_per_min"] = features.jumps_per_min
    return v


def _matches(values: dict, when: dict) -> bool:
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
    path = (config_dir or CONFIG_DIR) / "needs.json"
    return json.loads(path.read_text())


def derive_needs(
    scores: Scores,
    features: Optional[ClipFeatures] = None,
    *,
    config_dir: Optional[Path] = None,
) -> list[str]:
    """Return 2-4 plain-English needs for the dog. Every string is sanitized."""
    cfg = load_rules(config_dir)
    values = _values(scores, features)
    max_needs = int(cfg.get("max_needs", 4))

    needs: list[str] = []
    for rule in cfg.get("rules", []):
        if _matches(values, rule.get("when", {})):
            text = rule.get("need", "").strip()
            if text and text not in needs:
                needs.append(text)

    if not needs:
        needs = list(cfg.get("fallback", ["needs further observation"]))

    needs = needs[:max_needs]
    # Guardrail: reject any banned word before this leaves the pipeline.
    for n in needs:
        sanitize(n, _path="needs")
    return needs
