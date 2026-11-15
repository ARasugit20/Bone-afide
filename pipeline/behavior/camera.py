"""Camera motion compensation for handheld clips.

These stock clips are shot handheld, so the dog's box moves partly because the
camera moves. Left uncorrected, that camera motion shows up as phantom pacing and
jumps (e.g. a dog sitting still). This module estimates per-frame camera motion from
background feature points (outside the dog box) and exposes it so the feature stage
can measure the dog's motion relative to the scene rather than to the frame.

Method, per consecutive sampled-frame pair:
  1. Mask out the dog box (with a 10% margin) and find background corners with
     ``cv2.goodFeaturesToTrack``.
  2. Track them into the next frame with ``cv2.calcOpticalFlowPyrLK``.
  3. Fit a partial-affine transform (translation + rotation + uniform scale) with
     ``cv2.estimateAffinePartial2D`` (RANSAC).
The translation (normalized by frame size) and scale are stored on the frame. A real
fixed kennel camera needs none of this; the ``camera_compensation`` flag disables it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

from .ingest import SampledFrame
from .schemas import FrameTrack

_MARGIN = 0.10          # expand the dog box by 10% when masking it out
_MAX_CORNERS = 200
_QUALITY = 0.01
_MIN_DIST = 8


@dataclass
class CameraMotion:
    dx: float       # normalized translation x (fraction of frame width)
    dy: float       # normalized translation y (fraction of frame height)
    scale: float    # uniform scale change (1.0 = none)
    ok: bool        # whether an estimate was obtained


def _background_mask(shape, box_px) -> np.ndarray:
    h, w = shape[:2]
    mask = np.full((h, w), 255, dtype=np.uint8)
    if box_px is not None:
        x1, y1, x2, y2 = box_px
        bw, bh = (x2 - x1), (y2 - y1)
        mx, my = bw * _MARGIN, bh * _MARGIN
        ax1 = max(0, int(x1 - mx)); ay1 = max(0, int(y1 - my))
        ax2 = min(w, int(x2 + mx)); ay2 = min(h, int(y2 + my))
        mask[ay1:ay2, ax1:ax2] = 0
    return mask


def estimate_pair(prev_gray, cur_gray, prev_box_px, frame_w, frame_h) -> CameraMotion:
    """Estimate camera motion from ``prev_gray`` to ``cur_gray``."""
    mask = _background_mask(prev_gray.shape, prev_box_px)
    pts = cv2.goodFeaturesToTrack(
        prev_gray, maxCorners=_MAX_CORNERS, qualityLevel=_QUALITY,
        minDistance=_MIN_DIST, mask=mask,
    )
    if pts is None or len(pts) < 6:
        return CameraMotion(0.0, 0.0, 1.0, ok=False)

    nxt, status, _err = cv2.calcOpticalFlowPyrLK(prev_gray, cur_gray, pts, None)
    if nxt is None or status is None:
        return CameraMotion(0.0, 0.0, 1.0, ok=False)
    good_prev = pts[status.ravel() == 1]
    good_nxt = nxt[status.ravel() == 1]
    if len(good_prev) < 6:
        return CameraMotion(0.0, 0.0, 1.0, ok=False)

    m, _inliers = cv2.estimateAffinePartial2D(good_prev, good_nxt, method=cv2.RANSAC)
    if m is None:
        return CameraMotion(0.0, 0.0, 1.0, ok=False)

    # m = [[a, -b, tx], [b, a, ty]]; scale = sqrt(a^2 + b^2).
    a, b = m[0, 0], m[1, 0]
    scale = float(np.hypot(a, b)) or 1.0
    tx, ty = float(m[0, 2]), float(m[1, 2])
    return CameraMotion(dx=tx / frame_w, dy=ty / frame_h, scale=scale, ok=True)


def compensate(
    frames: list[SampledFrame],
    tracks: list[FrameTrack],
    *,
    frame_w: int,
    frame_h: int,
) -> list[FrameTrack]:
    """Estimate per-frame camera motion and store it on each FrameTrack.

    Uses each frame's own dog box to mask the foreground. Mutates and returns
    ``tracks``. The first frame has zero motion by definition.
    """
    if not frames:
        return tracks
    grays = [
        cv2.cvtColor(sf.frame, cv2.COLOR_BGR2GRAY) if sf.frame is not None else None
        for sf in frames
    ]
    for i in range(1, len(frames)):
        if grays[i - 1] is None or grays[i] is None:
            continue  # no image data (e.g. synthetic tracks) -> leave motion at zero
        prev_box = tracks[i - 1].box_px if i - 1 < len(tracks) else None
        cm = estimate_pair(grays[i - 1], grays[i], prev_box, frame_w, frame_h)
        tracks[i].cam_dx = cm.dx
        tracks[i].cam_dy = cm.dy
        tracks[i].cam_scale = cm.scale
    return tracks


def camera_shake(tracks: list[FrameTrack], duration_s: float) -> float:
    """Mean camera translation magnitude per second (normalized frame units/sec)."""
    if duration_s <= 0 or len(tracks) < 2:
        return 0.0
    total = sum((t.cam_dx ** 2 + t.cam_dy ** 2) ** 0.5 for t in tracks)
    return total / duration_s
