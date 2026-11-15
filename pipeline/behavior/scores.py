"""Scores: map clip features to 0-100 behavior scores plus an arousal-spike count.

Stage 1 uses hand-tuned formulas (``FormulaModel``). The ``ScoreModel`` interface
lets a later scikit-learn model, trained on hand labels, replace or calibrate the
formulas behind the same call. Breed is never an input here.

Score meanings (all 0-100, higher = more of the named quality):
  energy         - how much the dog moves (speed, time moving, bursts).
  stress         - pacing and repetitive circling; repetitive motion raises it.
  approachability- oriented to the front/door and not highly stressed.
  confidence     - upright posture and steady (non-pacing) movement.
  arousal_spikes - count of sudden accelerations toward the front (not a 0-100 score).
"""

from __future__ import annotations

from typing import Protocol

from .schemas import ClipFeatures, Scores


def _clamp_int(value: float, lo: int = 0, hi: int = 100) -> int:
    return int(max(lo, min(hi, round(value))))


class ScoreModel(Protocol):
    """Strategy for turning features into scores. Swappable for a trained model."""

    def score(self, features: ClipFeatures) -> Scores: ...


def _lerp_scale(value: float, lo: float, hi: float) -> float:
    """Map ``value`` from the range [lo, hi] onto [0, 100], clamped."""
    if hi <= lo:
        return 0.0
    return max(0.0, min(100.0, (value - lo) / (hi - lo) * 100.0))


class FormulaModel:
    """Hand-tuned formulas over the clip features. Default stage-1 model.

    Each raw feature is mapped onto 0-100 across a realistic operating range, then
    blended. Calibration ranges (point 8 of the spec pass):
      - speed (body lengths/sec): < 0.1 low energy, > 1.0 high.
      - pacing (reversals/min): < 2 low stress, 5-20 high.
      - jumping (jumps/min): > 6 high arousal.
    A later SklearnModel can replace this behind the same interface.
    """

    def score(self, features: ClipFeatures) -> Scores:
        f = features

        # --- component scales (0-100) ---
        speed_s = _lerp_scale(f.mean_speed, 0.1, 1.0)         # body lengths/sec
        vert_s = _lerp_scale(f.vertical_motion, 0.05, 0.8)    # vertical bl/sec
        moving_s = f.pct_time_moving                          # already 0-100
        jump_s = _lerp_scale(f.jumps_per_min, 0.0, 6.0)       # >6/min saturates
        pace_s = _lerp_scale(f.reversals_per_min, 2.0, 20.0)  # 5-20/min = high
        circle_s = _lerp_scale(f.circling, 0.5, 4.0)          # turns/min

        # Energy: horizontal speed + vertical movement + jumping, so a dog jumping
        # in place still reads high energy.
        energy = _clamp_int(0.45 * speed_s + 0.25 * vert_s + 0.30 * jump_s)

        # Stress: pacing + jumping + restlessness (fraction of time moving).
        stress = _clamp_int(0.5 * pace_s + 0.3 * jump_s + 0.2 * moving_s)

        # Approachability: close to AND centered on the camera.
        approachability = _clamp_int(0.6 * f.pct_close_camera + 0.4 * f.pct_centered)

        # Confidence: upright posture (h/w ratio) + steady (non-pacing) presence.
        posture = _lerp_scale(f.hw_ratio_mean, 0.6, 1.6)  # lying/wide -> upright/tall
        steady = max(0.0, 100.0 - pace_s)
        confidence = _clamp_int(0.6 * posture + 0.4 * steady)

        return Scores(
            energy=energy,
            stress=stress,
            approachability=approachability,
            confidence=confidence,
            arousal_spikes=int(f.sudden_accel_front),
        )


class SklearnModel:
    """Reserved slot for a trained scikit-learn calibrator (stage 2).

    Will load a saved estimator and map features to scores behind ``ScoreModel``.
    Not implemented in stage 1.
    """

    def __init__(self, *_args, **_kwargs):
        raise NotImplementedError("SklearnModel is reserved for stage 2 calibration.")

    def score(self, features: ClipFeatures) -> Scores:  # pragma: no cover
        raise NotImplementedError


_DEFAULT_MODEL: ScoreModel = FormulaModel()


def compute_scores(features: ClipFeatures, model: ScoreModel | None = None) -> Scores:
    """Score ``features`` with ``model`` (defaults to the hand-tuned FormulaModel)."""
    return (model or _DEFAULT_MODEL).score(features)
