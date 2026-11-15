"""Tests for handler mapping and passport field allowlist."""

from __future__ import annotations

from behavior.handler import compute_handler, load_handler_map
from behavior.passport import build_passport, PASSPORT_FIELDS
from behavior.guardrails import find_banned
from behavior.schemas import Scores


def _scores(**kw):
    base = dict(energy=40, stress=20, approachability=80, confidence=70, arousal_spikes=1)
    base.update(kw)
    return Scores(**base)


def test_handler_map_levels():
    m = load_handler_map()
    assert m["Green"]["min_experience"] == "any"
    assert m["Yellow"]["min_experience"] == "some"
    assert m["Orange"]["min_experience"] == "experienced"
    assert m["Red"]["min_experience"] == "staff"


def test_handler_for_orange_has_notes():
    events = [
        {"type": "acceleration", "start_s": 1, "end_s": 1.2, "label": "Rushed toward the front"},
        {"type": "acceleration", "start_s": 2, "end_s": 2.2, "label": "Rushed toward the front"},
        {"type": "calm", "start_s": 3, "end_s": 9, "label": "Calm and settled"},
    ]
    h = compute_handler("Orange", events, _scores())
    assert h["min_experience"] == "experienced"
    assert h["label"] == "Experienced handlers only"
    assert any("rushed the front" in n.lower() for n in h["notes"])
    assert len(h["notes"]) <= 3
    for n in h["notes"]:
        assert find_banned(n) == []


def test_handler_unknown_level_falls_back():
    h = compute_handler("Purple", [], _scores())
    assert h["min_experience"] in ("any", "some", "experienced", "staff")


# --- passport allowlist ---

def _full_doc():
    return {
        "dog_id": "luna-01", "name": "Lola", "day": 4,
        "energy": 100, "stress": 49, "approachability": 99, "confidence": 100,
        "arousal_spikes": 7, "handling_level": "Orange", "trend": "stable",
        "needs": ["active home with daily exercise"],
        "photo": "http://p", "video_url": "http://v",
        "fit_notes": ["Calm in 1 of 1 sessions."], "not_suited_for": ["homes with very young children"],
        "events": [{"type": "jump", "start_s": 1.0, "end_s": 1.3,
                    "label": "Jumped up at the fence"}],
        "evidence": {"sessions_observed": 4},
        "expert_reviewed": False, "updated_at": "2026-11-15T00:00:00Z",
        # fields that MUST NOT leak:
        "staff_notes": [{"author": "Sam", "note": "secret"}],
        "vet_review": {"vet_name": "Dr X"}, "photo_key": "thumbnails/luna-01.jpg",
        "video_key": "videos/luna-01_day1.mp4", "history": [{"day": 1}],
    }


def test_passport_only_allowlisted_fields():
    p = build_passport(_full_doc())
    assert set(p.keys()) <= set(PASSPORT_FIELDS)
    # explicit: none of the private keys leak
    for banned_key in ("staff_notes", "vet_review", "photo_key", "video_key", "history"):
        assert banned_key not in p


def test_passport_has_no_breed_or_banned_words():
    p = build_passport(_full_doc())
    import json
    blob = json.dumps(p).lower()
    assert "breed" not in blob
    assert find_banned(json.dumps(p)) == []


def test_passport_events_reduced_to_labels_and_times():
    p = build_passport(_full_doc())
    for e in p["events"]:
        assert set(e.keys()) == {"type", "start_s", "end_s", "label"}


def test_passport_sessions_from_evidence():
    p = build_passport(_full_doc())
    assert p["sessions_observed"] == 4
