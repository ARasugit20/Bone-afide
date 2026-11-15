"""Event-timeline extraction tests on synthetic tracks."""

from __future__ import annotations

from behavior.events import extract_events, CALM_MIN_S
from behavior.guardrails import find_banned
from behavior.schemas import FrameTrack


def _t(ts, box):
    return FrameTrack(timestamp_s=ts, detected=True, track_id=1, box_norm=box, conf=0.9)


def _box(cx, cy, w=0.3, h=0.4):
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def test_calm_stretch_detected():
    # 8 s of a near-motionless dog -> one calm event spanning most of it.
    tracks = [_t(i * 0.1, _box(0.5, 0.6)) for i in range(80)]
    evs = extract_events(tracks)
    calm = [e for e in evs if e["type"] == "calm"]
    assert calm, evs
    assert (calm[0]["end_s"] - calm[0]["start_s"]) >= CALM_MIN_S


def test_jump_event_detected_and_labeled():
    tracks = []
    for i in range(120):
        phase = i % 12
        box = _box(0.5, 0.75, 0.16, 0.14) if phase < 7 else _box(0.5, 0.55, 0.1, 0.56)
        tracks.append(_t(i * 0.1, box))
    evs = extract_events(tracks)
    jumps = [e for e in evs if e["type"] == "jump"]
    assert jumps
    assert jumps[0]["label"] == "Jumped up at the fence"


def test_events_have_required_shape_and_order():
    tracks = [_t(i * 0.1, _box(0.5, 0.6)) for i in range(80)]
    evs = extract_events(tracks)
    for e in evs:
        assert set(e) == {"type", "start_s", "end_s", "label"}
        assert e["end_s"] >= e["start_s"]
    starts = [e["start_s"] for e in evs]
    assert starts == sorted(starts)


def test_event_labels_are_guardrail_clean():
    tracks = [_t(i * 0.1, _box(0.5, 0.6)) for i in range(80)]
    for e in extract_events(tracks):
        assert find_banned(e["label"]) == []


def test_empty_tracks_no_events():
    assert extract_events([]) == []
