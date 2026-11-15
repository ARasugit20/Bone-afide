"""Grounded match evidence, fit notes, and not-suited-for rules.

Everything here is derived from REAL observed data only: the dog's Tiger sessions
(daily stress/energy/etc. averages), its detected events, and its latest scores. No
LLM, no invented facts. All user-facing text passes the guardrails (no breed, no
diagnosis wording, no em dashes, no curly quotes).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .guardrails import sanitize
from .settings import CONFIG_DIR

CALM_SESSION_STRESS = 30   # a session with avg stress below this is a "calm session"


def _event_counts(events: list[dict]) -> dict:
    jump = sum(1 for e in events if e.get("type") == "jump")
    rush = sum(1 for e in events if e.get("type") == "acceleration")
    reversal = sum(1 for e in events if e.get("type") == "reversal")
    calm_seconds = sum(max(0.0, e.get("end_s", 0) - e.get("start_s", 0))
                       for e in events if e.get("type") == "calm")
    clip_seconds = max((e.get("end_s", 0) for e in events), default=0.0)
    return {"jump": jump, "rush": rush, "reversal": reversal,
            "calm_seconds": round(calm_seconds, 1), "clip_seconds": round(clip_seconds, 1)}


def compute_evidence(trend_rows: Optional[list[dict]], events: list[dict],
                     scores, *, trend: str = "stable") -> dict:
    """Build the evidence object from Tiger rows, events, and the latest scores."""
    rows = sorted(trend_rows or [], key=lambda r: str(r.get("bucket")))
    stresses = [float(r.get("avg_stress", 0) or 0) for r in rows]
    sessions = len(rows)
    calm_sessions = sum(1 for v in stresses if v < CALM_SESSION_STRESS)
    ec = _event_counts(events or [])
    clip = ec["clip_seconds"] or 0.0
    pct_calm = round(100.0 * ec["calm_seconds"] / clip, 1) if clip > 0 else 0.0

    return {
        "sessions_observed": sessions,
        "calm_sessions": calm_sessions,
        "max_stress": int(round(max(stresses))) if stresses else int(scores.stress),
        "latest_stress": int(round(stresses[-1])) if stresses else int(scores.stress),
        "jump_count": ec["jump"],
        "rush_count": ec["rush"],
        "calm_seconds": ec["calm_seconds"],
        "clip_seconds": clip,
        "pct_time_calm": pct_calm,
        "trend": trend,
    }


def compute_fit_notes(evidence: dict, events: list[dict]) -> list[str]:
    """Up to 3 short factual sentences, each only if the data supports it."""
    notes: list[str] = []
    ev = evidence
    s = ev["sessions_observed"]

    if s >= 1 and ev["calm_sessions"] == s:
        notes.append(f"Calm in {s} of {s} sessions.")
    elif s >= 1 and ev["calm_sessions"] >= 1:
        notes.append(f"Calm in {ev['calm_sessions']} of {s} sessions.")

    if ev["jump_count"] == 1 and ev["clip_seconds"] > 0:
        notes.append(f"Jumped at the fence once in {int(ev['clip_seconds'])} seconds.")
    elif ev["jump_count"] >= 2:
        notes.append(f"Jumped at the fence {ev['jump_count']} times.")

    if ev["trend"] == "worsening":
        notes.append("Stress rose over the last 3 sessions.")
    elif ev["trend"] == "improving":
        notes.append("Stress eased over the last 3 sessions.")

    if len(notes) < 3 and ev["pct_time_calm"] >= 50:
        notes.append(f"Settled for {ev['pct_time_calm']:.0f} percent of the clip.")

    notes = notes[:3]
    for n in notes:
        sanitize(n, _path="fit_note")
    return notes


def _rising(trend: str) -> int:
    return 1 if trend == "worsening" else 0


def load_fit_rules(config_dir: Optional[Path] = None) -> dict:
    path = (config_dir or CONFIG_DIR) / "fit_rules.json"
    return json.loads(path.read_text())


def compute_not_suited_for(evidence: dict, scores, *,
                           config_dir: Optional[Path] = None) -> list[str]:
    """Rule-based list of situations this dog is not suited for (from config)."""
    cfg = load_fit_rules(config_dir)
    values = {
        "latest_stress": evidence["latest_stress"],
        "max_stress": evidence["max_stress"],
        "jump_count": evidence["jump_count"],
        "rush_count": evidence["rush_count"],
        "pct_time_calm": evidence["pct_time_calm"],
        "sessions_observed": evidence["sessions_observed"],
        "rising_stress": _rising(evidence["trend"]),
        "energy": scores.energy,
        "stress": scores.stress,
        "approachability": scores.approachability,
        "confidence": scores.confidence,
    }
    out: list[str] = []
    for rule in cfg.get("rules", []):
        ok = True
        for field, bounds in rule.get("when", {}).items():
            v = values.get(field)
            if v is None:
                ok = False
                break
            if "min" in bounds and v < bounds["min"]:
                ok = False
                break
            if "max" in bounds and v > bounds["max"]:
                ok = False
                break
        if ok:
            text = rule.get("text", "").strip()
            if text and text not in out:
                out.append(text)
    for t in out:
        sanitize(t, _path="not_suited_for")
    return out
