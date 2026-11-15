"""Welfare (kennel-decline) alert tests, from synthetic Tiger trend rows."""

from __future__ import annotations

from behavior.welfare import compute_welfare


def _rows(stresses):
    return [{"bucket": f"2026-11-0{i+1}T00:00:00Z", "avg_stress": s}
            for i, s in enumerate(stresses)]


def test_fewer_than_3_sessions_is_stable_with_message():
    w = compute_welfare(_rows([20, 30]))
    assert w["status"] == "stable"
    assert w["sessions"] == 2
    assert w["message"] == "Not enough sessions yet"
    assert w["stress_change"] == 0


def test_rising_stress_flagged():
    w = compute_welfare(_rows([30, 40, 48]))  # +18 over last 3
    assert w["status"] == "rising_stress"
    assert w["sessions"] == 3
    assert w["stress_change"] == 18
    assert "18 points" in w["message"]
    assert "quieter kennel" in w["message"] or "foster" in w["message"]


def test_improving_flagged():
    w = compute_welfare(_rows([60, 50, 45]))  # -15 over last 3
    assert w["status"] == "improving"
    assert w["stress_change"] == -15


def test_small_change_is_stable():
    w = compute_welfare(_rows([30, 32, 35]))  # +5, under threshold
    assert w["status"] == "stable"
    assert w["stress_change"] == 5


def test_uses_only_last_3_sessions():
    # 5 sessions; last 3 are 40->50->58 = +18 rising, earlier ones ignored.
    w = compute_welfare(_rows([10, 20, 40, 50, 58]))
    assert w["status"] == "rising_stress"
    assert w["sessions"] == 5
    assert w["stress_change"] == 18


def test_none_rows_stable():
    w = compute_welfare(None)
    assert w["status"] == "stable"
    assert w["message"] == "Not enough sessions yet"
