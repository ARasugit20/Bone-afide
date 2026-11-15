"""Shared data contracts for the behavior pipeline.

These types are the stable seams between stages. The pose seam is visible here as
``ClipFeatures.pose`` — always ``None`` in stage 1, reserved for a future keypoint
stage so ``scores.py`` need not change when pose is added.

``Summary`` is the exact output contract the teammate's /app depends on. Build it
only through :func:`build_summary`, which enforces the key set, order, integer
ranges, and allowed enum values.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

from .guardrails import HANDLING_LEVELS, TREND_VALUES, sanitize

HandlingLevel = Literal["Green", "Yellow", "Orange", "Red"]
Trend = Literal["improving", "stable", "worsening"]

# Pixel / normalized box as (x1, y1, x2, y2).
Box = tuple[float, float, float, float]


@dataclass
class FrameTrack:
    """One sampled frame's tracking result. Missing detections are kept in place
    (``detected=False``) so the timeline stays intact."""

    timestamp_s: float
    detected: bool
    track_id: Optional[int] = None
    box_px: Optional[Box] = None
    box_norm: Optional[Box] = None
    conf: Optional[float] = None
    interpolated: bool = False  # box linearly filled across a short detection gap
    blurry: bool = False        # frame too blurry to trust; excluded from motion
    blur_var: float = -1.0      # Laplacian variance carried from the sampled frame
    # Camera motion from the previous sampled frame, in normalized frame units:
    cam_dx: float = 0.0         # camera translation x (fraction of frame width)
    cam_dy: float = 0.0         # camera translation y (fraction of frame height)
    cam_scale: float = 1.0      # camera scale change (zoom); 1.0 = none


@dataclass
class ClipFeatures:
    """Motion features for one clip plus frame metadata.

    ``pose`` is the reserved pose seam: ``None`` in stage 1. A later ``pose.py``
    can populate it with keypoint-derived values without changing callers.
    """

    mean_speed: float = 0.0           # body lengths per second
    pct_time_moving: float = 0.0
    pct_time_front_zone: float = 0.0  # polygon zone (real kennel cameras)
    pct_close_camera: float = 0.0     # box large (near max apparent size)
    pct_centered: float = 0.0         # box center in the middle 60% horizontally
    reversals_per_min: float = 0.0    # pacing
    circling: float = 0.0             # turns per minute
    jumps_per_min: float = 0.0        # vertical bursts / rearing
    vertical_motion: float = 0.0      # body lengths/sec of vertical movement
    hw_ratio_mean: float = 0.0
    hw_ratio_series: list[float] = field(default_factory=list)
    sudden_accel_front: int = 0
    detection_coverage: float = 0.0
    frame_w: int = 0
    frame_h: int = 0
    duration_s: float = 0.0
    pose: Optional[dict] = None  # reserved pose seam (stage 2)


@dataclass
class Scores:
    """Integer 0-100 scores plus a non-negative arousal-spike count."""

    energy: int
    stress: int
    approachability: int
    confidence: int
    arousal_spikes: int


# Exact contract key order the teammate's /app depends on.
SUMMARY_KEYS: tuple[str, ...] = (
    "dog_id",
    "day",
    "energy",
    "stress",
    "approachability",
    "confidence",
    "arousal_spikes",
    "handling_level",
    "trend",
    "needs",
)


def _as_score_int(name: str, value: Any) -> int:
    """Coerce to int and require the 0-100 range."""
    ivalue = int(value)
    if not 0 <= ivalue <= 100:
        raise ValueError(f"{name} must be an integer 0-100, got {value!r}")
    return ivalue


def build_summary(
    *,
    dog_id: str,
    day: int,
    scores: Scores,
    handling_level: str,
    trend: str,
    needs: list[str],
) -> dict:
    """Build the output-contract summary dict, validated and guardrail-checked.

    Enforces: exact key order, integer 0-100 scores, non-negative integer
    ``arousal_spikes``, allowed ``handling_level`` and ``trend`` values, and no
    banned words anywhere in the result.
    """
    if not isinstance(dog_id, str) or not dog_id:
        raise ValueError("dog_id must be a non-empty string")
    if not isinstance(day, int) or isinstance(day, bool):
        raise ValueError("day must be an integer")
    if handling_level not in HANDLING_LEVELS:
        raise ValueError(
            f"handling_level must be one of {HANDLING_LEVELS}, got {handling_level!r}"
        )
    if trend not in TREND_VALUES:
        raise ValueError(f"trend must be one of {TREND_VALUES}, got {trend!r}")
    spikes = int(scores.arousal_spikes)
    if spikes < 0:
        raise ValueError(f"arousal_spikes must be >= 0, got {spikes!r}")
    if not isinstance(needs, list) or not all(isinstance(n, str) for n in needs):
        raise ValueError("needs must be a list of strings")

    summary = {
        "dog_id": dog_id,
        "day": day,
        "energy": _as_score_int("energy", scores.energy),
        "stress": _as_score_int("stress", scores.stress),
        "approachability": _as_score_int("approachability", scores.approachability),
        "confidence": _as_score_int("confidence", scores.confidence),
        "arousal_spikes": spikes,
        "handling_level": handling_level,
        "trend": trend,
        "needs": list(needs),
    }
    # Guarantee the exact key order of the contract.
    ordered = {k: summary[k] for k in SUMMARY_KEYS}
    assert tuple(ordered.keys()) == SUMMARY_KEYS
    return sanitize(ordered)


def validate_summary(summary: dict) -> dict:
    """Validate an already-built summary against the contract. Returns it on success."""
    if tuple(summary.keys()) != SUMMARY_KEYS:
        raise ValueError(
            f"summary keys/order must be {SUMMARY_KEYS}, got {tuple(summary.keys())}"
        )
    scores = Scores(
        energy=summary["energy"],
        stress=summary["stress"],
        approachability=summary["approachability"],
        confidence=summary["confidence"],
        arousal_spikes=summary["arousal_spikes"],
    )
    return build_summary(
        dog_id=summary["dog_id"],
        day=summary["day"],
        scores=scores,
        handling_level=summary["handling_level"],
        trend=summary["trend"],
        needs=summary["needs"],
    )
