"""Features + scores tests on synthetic tracks.

Scenarios assert the intended behavior of the hand-tuned formulas:
  - a dog pacing back and forth -> high stress
  - a dog sitting at the front -> high approachability
  - a dog barely moving -> low energy
Also covers gap interpolation and the pose seam passthrough.
"""

from __future__ import annotations

from behavior.features import extract_features
from behavior.scores import compute_scores
from behavior.schemas import FrameTrack
from behavior.zones import DEFAULT_FRONT_ZONE
from behavior.track import fill_gaps


def _track(ts, box):
    return FrameTrack(timestamp_s=ts, detected=True, track_id=1, box_px=None,
                      box_norm=box, conf=0.9)


def _box(cx, cy, w=0.12, h=0.14):
    return (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)


def pacing_tracks(n=120, dt=0.1):
    """Dog oscillates left<->right, dwelling ~0.6 s each side so reversals sustain."""
    tracks = []
    for i in range(n):
        cx = 0.3 if (i // 6) % 2 == 0 else 0.7  # flip every 6 frames (0.6 s)
        tracks.append(_track(i * dt, _box(cx, 0.5)))
    return tracks


def sitting_front_tracks(n=120, dt=0.1):
    """Dog large (close to camera) and centered, barely moving."""
    tracks = []
    for i in range(n):
        tracks.append(_track(i * dt, _box(0.5, 0.65, w=0.35, h=0.45)))  # area ~16%
    return tracks


def still_tracks(n=120, dt=0.1):
    """Dog essentially motionless in the middle of the frame."""
    tracks = []
    for i in range(n):
        tracks.append(_track(i * dt, _box(0.5, 0.45, w=0.12, h=0.14)))  # area ~1.7%
    return tracks


def _scores_for(tracks):
    feats = extract_features(tracks, list(DEFAULT_FRONT_ZONE), frame_w=1280, frame_h=720,
                             duration_s=tracks[-1].timestamp_s)
    return feats, compute_scores(feats)


def test_pacing_gives_high_stress():
    _f, pacing = _scores_for(pacing_tracks())
    _f, still = _scores_for(still_tracks())
    assert pacing.stress >= 60, pacing
    assert pacing.stress > still.stress


def test_sitting_front_gives_high_approachability():
    _f, front = _scores_for(sitting_front_tracks())
    _f, pacing = _scores_for(pacing_tracks())
    assert front.approachability >= 70, front
    assert front.approachability > pacing.approachability


def test_barely_moving_gives_low_energy():
    _f, still = _scores_for(still_tracks())
    _f, pacing = _scores_for(pacing_tracks())
    assert still.energy <= 20, still
    assert still.energy < pacing.energy


def test_scores_are_ints_in_range():
    _f, s = _scores_for(pacing_tracks())
    for v in (s.energy, s.stress, s.approachability, s.confidence):
        assert isinstance(v, int) and 0 <= v <= 100
    assert isinstance(s.arousal_spikes, int) and s.arousal_spikes >= 0


def test_detection_coverage_counts_real_only():
    tracks = [
        _track(0.0, _box(0.5, 0.5)),
        FrameTrack(timestamp_s=0.5, detected=False),
        _track(1.0, _box(0.5, 0.5)),
        FrameTrack(timestamp_s=1.5, detected=False),
    ]
    feats = extract_features(tracks, list(DEFAULT_FRONT_ZONE))
    assert feats.detection_coverage == 0.5


def test_gap_fill_interpolates_short_gap():
    tracks = [
        _track(0.0, _box(0.2, 0.5)),
        FrameTrack(timestamp_s=0.5, detected=False),
        _track(1.0, _box(0.4, 0.5)),
    ]
    fill_gaps(tracks, max_gap_s=1.0)
    assert tracks[1].detected and tracks[1].interpolated
    # Linear midpoint of cx 0.2 -> 0.4 is 0.3.
    x1, _y1, x2, _y2 = tracks[1].box_norm
    assert abs((x1 + x2) / 2 - 0.3) < 1e-6


def test_gap_fill_skips_long_gap():
    tracks = [
        _track(0.0, _box(0.2, 0.5)),
        FrameTrack(timestamp_s=0.5, detected=False),
        FrameTrack(timestamp_s=1.0, detected=False),
        _track(1.5, _box(0.4, 0.5)),  # 1.5s gap > 1.0s max
    ]
    fill_gaps(tracks, max_gap_s=1.0)
    assert not tracks[1].detected and not tracks[2].detected


def test_pose_seam_passthrough():
    feats = extract_features(still_tracks(), list(DEFAULT_FRONT_ZONE), pose={"stub": True})
    assert feats.pose == {"stub": True}


def jumping_tracks(n=120, dt=0.1):
    """Dog repeatedly rears at the fence, mostly grounded with periodic rears.

    Grounded most of the time (so the grounded baseline is well-defined), rearing for
    ~0.5 s every ~1.2 s. Reared: box top high in frame and h/w ratio much larger.
    """
    tracks = []
    period = 12  # 1.2 s cycle
    for i in range(n):
        phase = i % period
        if phase < 7:
            box = (0.42, 0.72, 0.58, 0.86)   # grounded: h/w ~0.875
        else:
            box = (0.45, 0.28, 0.55, 0.86)   # reared ~0.5 s: top high, h/w ~5.8
        tracks.append(_track(i * dt, box))
    return tracks


def test_jumping_raises_energy_and_arousal():
    feats, jump = _scores_for(jumping_tracks())
    _f, still = _scores_for(still_tracks())
    assert feats.jumps_per_min >= 5, feats.jumps_per_min
    assert jump.arousal_spikes >= 3, jump
    assert jump.energy > still.energy


def test_jumping_is_not_counted_as_pacing():
    jt = jumping_tracks()
    feats = extract_features(jt, list(DEFAULT_FRONT_ZONE), duration_s=jt[-1].timestamp_s)
    # vertical rearing should not inflate horizontal reversals
    assert feats.reversals_per_min < feats.jumps_per_min


def test_blurry_frames_excluded_from_motion():
    # Two sharp frames far apart, with a "blurry" frame carrying a wild box between:
    # the blurry box must not create spurious speed.
    good = [
        FrameTrack(timestamp_s=0.0, detected=True, box_norm=_box(0.5, 0.5), conf=0.9),
        FrameTrack(timestamp_s=0.5, detected=True, box_norm=_box(0.99, 0.01),
                   conf=0.4, blurry=True),
        FrameTrack(timestamp_s=1.0, detected=True, box_norm=_box(0.52, 0.5), conf=0.9),
    ]
    feats = extract_features(good, list(DEFAULT_FRONT_ZONE), duration_s=1.0)
    # Only the two sharp frames contribute: small real displacement, low speed.
    assert feats.mean_speed < 0.5
