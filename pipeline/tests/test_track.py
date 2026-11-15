"""Tracking tests: no-dog frames handled, primary-track selection, detection rate.

These exercise the pure tracking logic (``_assemble`` path via monkeypatched YOLO
output) without loading real model weights, so they run fast and offline.
"""

from __future__ import annotations

import pytest

from behavior import track
from behavior.ingest import SampledFrame
from behavior.track import _RawDetection, _pick_primary_track, detection_rate


def _frames(n: int):
    return [SampledFrame(index=i, timestamp_s=i * 0.5, frame=None) for i in range(n)]


def test_no_dog_frames_are_kept_as_undetected(monkeypatch):
    # Frame 0: dog; frame 1: no detection; frame 2: dog. Interpolation disabled here
    # so we assert the raw per-frame detection behavior.
    per_frame = [
        [_RawDetection(track_id=1, box_px=(10, 10, 50, 80), conf=0.9)],
        [],
        [_RawDetection(track_id=1, box_px=(12, 10, 52, 82), conf=0.8)],
    ]
    monkeypatch.setattr(track, "_run_yolo", lambda *a, **k: per_frame)

    tracks = track.track_clip(
        _frames(3), frame_w=100, frame_h=100, weights="x.pt", conf=0.25,
        device="cpu", interp_gap_s=0, camera_compensation=False,
    )

    assert len(tracks) == 3
    assert [t.detected for t in tracks] == [True, False, True]
    # Timeline preserved: undetected frame keeps its timestamp, no box.
    assert tracks[1].timestamp_s == pytest.approx(0.5)
    assert tracks[1].box_px is None and tracks[1].box_norm is None
    # Normalized box computed for detected frame.
    assert tracks[0].box_norm == pytest.approx((0.1, 0.1, 0.5, 0.8))


def test_short_gap_is_interpolated_in_track_clip(monkeypatch):
    # Same miss, but interpolation on (0.5s gap <= 1.0s) fills frame 1.
    per_frame = [
        [_RawDetection(track_id=1, box_px=(10, 10, 50, 80), conf=0.9)],
        [],
        [_RawDetection(track_id=1, box_px=(20, 10, 60, 80), conf=0.8)],
    ]
    monkeypatch.setattr(track, "_run_yolo", lambda *a, **k: per_frame)
    tracks = track.track_clip(
        _frames(3), frame_w=100, frame_h=100, weights="x.pt", conf=0.25,
        device="cpu", interp_gap_s=1.0, camera_compensation=False,
    )
    assert tracks[1].detected and tracks[1].interpolated
    # Real-detection rate excludes the fill; coverage includes it.
    assert detection_rate(tracks) == pytest.approx(2 / 3)
    assert detection_rate(tracks, include_interpolated=True) == pytest.approx(1.0)


def test_detection_rate(monkeypatch):
    per_frame = [
        [_RawDetection(track_id=1, box_px=(0, 0, 10, 10), conf=0.9)],
        [],
        [_RawDetection(track_id=1, box_px=(0, 0, 10, 10), conf=0.9)],
        [],
    ]
    monkeypatch.setattr(track, "_run_yolo", lambda *a, **k: per_frame)
    tracks = track.track_clip(
        _frames(4), frame_w=100, frame_h=100, weights="x.pt", conf=0.25, device="cpu", camera_compensation=False,
    )
    assert detection_rate(tracks) == pytest.approx(0.5)


def test_detection_rate_empty():
    assert detection_rate([]) == 0.0


def test_primary_track_prefers_most_persistent():
    # track 2 appears in 3 frames, track 1 in 1 frame -> primary = 2.
    per_frame = [
        [_RawDetection(track_id=1, box_px=(0, 0, 1, 1), conf=0.95)],
        [_RawDetection(track_id=2, box_px=(0, 0, 1, 1), conf=0.5)],
        [_RawDetection(track_id=2, box_px=(0, 0, 1, 1), conf=0.5)],
        [_RawDetection(track_id=2, box_px=(0, 0, 1, 1), conf=0.5)],
    ]
    assert _pick_primary_track(per_frame) == 2


def test_primary_track_tie_breaks_on_confidence():
    # both tracks appear twice; track 7 has higher mean conf.
    per_frame = [
        [_RawDetection(track_id=3, box_px=(0, 0, 1, 1), conf=0.4)],
        [_RawDetection(track_id=3, box_px=(0, 0, 1, 1), conf=0.4)],
        [_RawDetection(track_id=7, box_px=(0, 0, 1, 1), conf=0.9)],
        [_RawDetection(track_id=7, box_px=(0, 0, 1, 1), conf=0.9)],
    ]
    assert _pick_primary_track(per_frame) == 7


def test_primary_track_none_when_no_ids():
    per_frame = [[_RawDetection(track_id=None, box_px=(0, 0, 1, 1), conf=0.5)]]
    assert _pick_primary_track(per_frame) is None


def test_fallback_to_highest_conf_when_no_track_ids(monkeypatch):
    # No track ids at all -> primary is None -> pick highest-conf detection per frame.
    per_frame = [
        [
            _RawDetection(track_id=None, box_px=(0, 0, 1, 1), conf=0.3),
            _RawDetection(track_id=None, box_px=(5, 5, 9, 9), conf=0.8),
        ],
    ]
    monkeypatch.setattr(track, "_run_yolo", lambda *a, **k: per_frame)
    tracks = track.track_clip(
        _frames(1), frame_w=10, frame_h=10, weights="x.pt", conf=0.25, device="cpu", camera_compensation=False,
    )
    assert tracks[0].detected
    assert tracks[0].conf == pytest.approx(0.8)
