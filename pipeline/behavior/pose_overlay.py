"""Optional SuperAnimal skeleton overlay for the annotated video.

This is import-safe: it has NO DeepLabCut dependency. It only reads a pose JSON that
the separate pipeline/pose stack produced (see pipeline/pose/README.md) and draws the
keypoints + a simple quadruped skeleton onto frames with OpenCV (already a dependency).

Everything here is off unless POSE_ENABLED=1 and a pose JSON is supplied. If anything
is missing or malformed, draw nothing and carry on.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import cv2

# Minimal SuperAnimal-Quadruped skeleton (subset; unknown names are skipped safely).
_EDGES = [
    ("nose", "upper_jaw"), ("nose", "left_eye"), ("nose", "right_eye"),
    ("left_eye", "left_earbase"), ("right_eye", "right_earbase"),
    ("neck_base", "neck_end"), ("neck_end", "back_base"), ("back_base", "back_middle"),
    ("back_middle", "back_end"), ("back_end", "tail_base"), ("tail_base", "tail_end"),
    ("back_base", "left_shoulder"), ("left_shoulder", "left_elbow"), ("left_elbow", "left_front_paw"),
    ("back_base", "right_shoulder"), ("right_shoulder", "right_elbow"), ("right_elbow", "right_front_paw"),
    ("back_end", "left_hip"), ("left_hip", "left_knee"), ("left_knee", "left_back_paw"),
    ("back_end", "right_hip"), ("right_hip", "right_knee"), ("right_knee", "right_back_paw"),
]
_CONF_MIN = 0.5


def load_pose(pose_json: str) -> Optional[dict]:
    try:
        data = json.loads(Path(pose_json).read_text())
        return data if data.get("frames") else None
    except Exception:
        return None


def _nearest_frame(frames: list[dict], t: float) -> Optional[dict]:
    if not frames:
        return None
    return min(frames, key=lambda f: abs(float(f.get("t", 0.0)) - t))


def draw_skeleton(frame, pose_data: Optional[dict], timestamp_s: float,
                  src_w: int, src_h: int, dst_w: int, dst_h: int) -> None:
    """Draw the skeleton for the frame nearest ``timestamp_s`` in place.

    Pose coordinates are in the pose run's own pixel space (``src_w`` x ``src_h``);
    they are scaled to the annotated frame size (``dst_w`` x ``dst_h``).
    """
    if not pose_data:
        return
    fr = _nearest_frame(pose_data.get("frames", []), timestamp_s)
    if not fr:
        return
    kps = fr.get("keypoints", {})
    sx = dst_w / src_w if src_w else 1.0
    sy = dst_h / src_h if src_h else 1.0

    def pt(name):
        v = kps.get(name)
        if not v or len(v) < 3 or v[2] < _CONF_MIN:
            return None
        return (int(v[0] * sx), int(v[1] * sy))

    for a, b in _EDGES:
        pa, pb = pt(a), pt(b)
        if pa and pb:
            cv2.line(frame, pa, pb, (80, 220, 120), 2)
    for name, v in kps.items():
        p = pt(name)
        if p:
            cv2.circle(frame, p, 3, (40, 180, 90), -1)
