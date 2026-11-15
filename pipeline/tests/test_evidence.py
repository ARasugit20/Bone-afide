"""Tests for evidence math, fit_notes, fit_rules loading, and not_suited_for."""

from __future__ import annotations

from behavior.evidence import (compute_evidence, compute_fit_notes,
                               compute_not_suited_for, load_fit_rules)
from behavior.guardrails import find_banned
from behavior.schemas import Scores


def _rows(stresses):
    return [{"bucket": f"2026-11-0{i+1}T00:00:00Z", "avg_stress": s, "avg_energy": 50,
             "avg_approachability": 80, "avg_confidence": 70, "total_spikes": 0}
            for i, s in enumerate(stresses)]


def _events():
    return [
        {"type": "calm", "start_s": 0.0, "end_s": 6.0, "label": "Calm and settled"},
        {"type": "jump", "start_s": 7.0, "end_s": 7.3, "label": "Jumped up at the fence"},
        {"type": "acceleration", "start_s": 8.0, "end_s": 8.2, "label": "Rushed toward the front"},
        {"type": "acceleration", "start_s": 9.0, "end_s": 9.2, "label": "Rushed toward the front"},
    ]


def _scores(**kw):
    base = dict(energy=40, stress=20, approachability=80, confidence=70, arousal_spikes=1)
    base.update(kw)
    return Scores(**base)


def test_evidence_math():
    ev = compute_evidence(_rows([10, 20, 25]), _events(), _scores(), trend="stable")
    assert ev["sessions_observed"] == 3
    assert ev["calm_sessions"] == 3          # all under 30
    assert ev["max_stress"] == 25
    assert ev["latest_stress"] == 25
    assert ev["jump_count"] == 1
    assert ev["rush_count"] == 2
    assert ev["calm_seconds"] == 6.0
    assert ev["clip_seconds"] == 9.2
    # pct_time_calm = 6.0 / 9.2 * 100
    assert abs(ev["pct_time_calm"] - 65.2) < 0.2


def test_calm_sessions_partial():
    ev = compute_evidence(_rows([10, 40, 50]), [], _scores(), trend="stable")
    assert ev["calm_sessions"] == 1          # only the first under 30
    assert ev["max_stress"] == 50


def test_fit_notes_supported_only():
    ev = compute_evidence(_rows([10, 15, 20]), _events(), _scores(), trend="stable")
    notes = compute_fit_notes(ev, _events())
    assert len(notes) <= 3
    assert any("Calm in 3 of 3 sessions" in n for n in notes)
    for n in notes:
        assert find_banned(n) == []


def test_fit_rules_config_loads():
    cfg = load_fit_rules()
    assert "rules" in cfg and isinstance(cfg["rules"], list)
    assert all("when" in r and "text" in r for r in cfg["rules"])


def test_not_suited_for_rules_fire():
    # latest_stress 45 -> very young children; jump_count>=2 -> first-time owners
    ev = compute_evidence(_rows([30, 40, 45]), _events() + [
        {"type": "jump", "start_s": 10.0, "end_s": 10.3, "label": "Jumped up at the fence"}],
        _scores(), trend="worsening")
    out = compute_not_suited_for(ev, _scores(stress=45))
    assert "homes with very young children" in out
    assert "first-time owners without a trainer" in out
    assert "busy multi-pet homes until stress settles" in out  # rising_stress
    for t in out:
        assert find_banned(t) == []


def test_not_suited_for_empty_when_calm():
    ev = compute_evidence(_rows([5, 5, 5]), [], _scores(stress=5, approachability=90),
                          trend="improving")
    assert compute_not_suited_for(ev, _scores(stress=5, approachability=90)) == []
