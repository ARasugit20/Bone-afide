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


def test_calm_stretch_survives_jitter():
    # A dog that stays put but jitters a little every frame (camera shake / box
    # wobble). The old per-step-speed test broke on any jitter; the net-wander test
    # should still report one calm stretch.
    import random
    random.seed(1)
    tracks = []
    for i in range(80):
        jx = random.uniform(-0.02, 0.02)  # small wobble, well under a body length
        jy = random.uniform(-0.02, 0.02)
        tracks.append(_t(i * 0.1, _box(0.5 + jx, 0.6 + jy)))
    calm = [e for e in extract_events(tracks) if e["type"] == "calm"]
    assert calm, "jittering-but-stationary dog should still produce a calm event"
    assert (calm[0]["end_s"] - calm[0]["start_s"]) >= CALM_MIN_S


def test_calm_label_is_from_allowed_set():
    tracks = [_t(i * 0.1, _box(0.5, 0.6)) for i in range(80)]
    allowed = {"Calm and settled", "Resting quietly", "Watching calmly from the back"}
    for e in extract_events(tracks):
        if e["type"] == "calm":
            assert e["label"] in allowed


def test_calm_never_overlaps_active_events():
    from behavior.events import split_calm_around_active, CALM_MIN_S
    # One long calm window with a jump in the middle and an accel near the start.
    evs = [
        {"type": "calm", "start_s": 0.0, "end_s": 20.0, "label": "Calm and settled"},
        {"type": "jump", "start_s": 9.0, "end_s": 9.4, "label": "Jumped up at the fence"},
        {"type": "acceleration", "start_s": 1.0, "end_s": 1.3, "label": "Rushed toward the front"},
    ]
    out = split_calm_around_active(evs)
    calm = [e for e in out if e["type"] == "calm"]
    active = [(e["start_s"], e["end_s"]) for e in out if e["type"] != "calm"]
    # No calm piece may overlap any active interval (with 0.5s padding).
    for c in calm:
        for a_s, a_e in active:
            assert c["end_s"] <= a_s - 0.5 + 1e-9 or c["start_s"] >= a_e + 0.5 - 1e-9
        assert (c["end_s"] - c["start_s"]) >= CALM_MIN_S


def test_calm_dropped_when_remaining_piece_too_short():
    from behavior.events import split_calm_around_active
    # A 6s calm window with an accel at 3s leaves two ~2.5s pieces -> both dropped.
    evs = [
        {"type": "calm", "start_s": 0.0, "end_s": 6.0, "label": "Calm and settled"},
        {"type": "acceleration", "start_s": 3.0, "end_s": 3.0, "label": "Rushed toward the front"},
    ]
    out = split_calm_around_active(evs)
    assert [e for e in out if e["type"] == "calm"] == []


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


def test_merge_collapses_near_same_type_events():
    from behavior.events import merge_and_cap
    # 4 acceleration events 0.05 s apart -> merged into 1 spanning all of them.
    evs = [
        {"type": "acceleration", "start_s": 1.00, "end_s": 1.05, "label": "Rushed toward the front"},
        {"type": "acceleration", "start_s": 1.10, "end_s": 1.15, "label": "Rushed toward the front"},
        {"type": "acceleration", "start_s": 1.20, "end_s": 1.25, "label": "Rushed toward the front"},
        {"type": "acceleration", "start_s": 1.30, "end_s": 1.35, "label": "Rushed toward the front"},
    ]
    out = merge_and_cap(evs)
    assert len(out) == 1
    assert out[0]["start_s"] == 1.00
    assert out[0]["end_s"] == 1.35
    assert out[0]["type"] == "acceleration"


def test_merge_keeps_distinct_when_gap_large():
    from behavior.events import merge_and_cap
    evs = [
        {"type": "jump", "start_s": 0.0, "end_s": 0.3, "label": "Jumped up at the fence"},
        {"type": "jump", "start_s": 2.0, "end_s": 2.3, "label": "Jumped up at the fence"},  # gap 1.7 s
    ]
    assert len(merge_and_cap(evs)) == 2


def test_cap_keeps_12_longest_sorted_by_start():
    from behavior.events import merge_and_cap
    # 15 well-separated jumps of increasing duration -> keep 12 longest, sorted by start.
    evs = [{"type": "jump", "start_s": i * 5.0, "end_s": i * 5.0 + (i + 1) * 0.1,
            "label": "Jumped up at the fence"} for i in range(15)]
    out = merge_and_cap(evs)
    assert len(out) == 12
    starts = [e["start_s"] for e in out]
    assert starts == sorted(starts)
    # the three shortest (i=0,1,2) should have been dropped
    assert all(e["start_s"] >= 15.0 for e in out)
