"""Thumbnail extraction: the clearest frame where the dog is clearly detected.

Picks the sampled frame with the highest detection confidence among non-blurry,
really-detected (not interpolated) frames, and writes it as a JPEG. Falls back to
the sharpest detected frame if confidences are unavailable.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import cv2

from .ingest import SampledFrame
from .schemas import FrameTrack


def best_frame_index(tracks: list[FrameTrack]) -> Optional[int]:
    """Index of the clearest, highest-confidence real detection, or None."""
    candidates = [
        i for i, t in enumerate(tracks)
        if t.detected and not t.interpolated and not t.blurry
    ]
    if not candidates:
        # relax: allow blurry if nothing else
        candidates = [i for i, t in enumerate(tracks) if t.detected and not t.interpolated]
    if not candidates:
        return None

    def key(i):
        t = tracks[i]
        conf = t.conf if t.conf is not None else -1.0
        return (conf, t.blur_var)

    return max(candidates, key=key)


def save_thumbnail(
    frames: list[SampledFrame], tracks: list[FrameTrack], out_path: str
) -> Optional[str]:
    """Write the clearest detected frame to ``out_path`` as JPEG. Returns path or None.

    Draws the dog's bounding box so the thumbnail shows what was detected.
    """
    idx = best_frame_index(tracks)
    if idx is None or idx >= len(frames):
        return None
    sf = frames[idx]
    if sf.frame is None:
        return None
    img = sf.frame.copy()
    t = tracks[idx]
    if t.box_px is not None:
        x1, y1, x2, y2 = (int(v) for v in t.box_px)
        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 200, 0), 2)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(out_path, img, [cv2.IMWRITE_JPEG_QUALITY, 90])
    return out_path
