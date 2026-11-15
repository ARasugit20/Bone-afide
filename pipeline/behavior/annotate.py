"""Annotated MP4: box, smoothed track trail, live scores, and a JUMP flash.

Re-reads the sampled frames (same fps/downscale as analysis) and draws, per frame:
  - the current bounding box,
  - a fading trail of recent smoothed box centers,
  - a panel with the five scores and the handling level,
  - a flashing "JUMP" label on frames where a jump/rear was detected.

Never renders the banned words; only score names, numbers, and the handling level.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import cv2

from .features import jump_frame_flags
from .ingest import sample_frames
from .schemas import FrameTrack, Scores
from .settings import Settings, load_settings

_TRAIL_LEN = 15
_PANEL_W = 230


def _smooth_centers_px(tracks, w, h, window=3):
    pts = []
    for t in tracks:
        if t.box_norm is not None:
            x1, y1, x2, y2 = t.box_norm
            pts.append((int((x1 + x2) / 2 * w), int((y1 + y2) / 2 * h)))
        else:
            pts.append(None)
    return pts


def annotate_clip(
    video: str,
    tracks: list[FrameTrack],
    scores: Scores,
    *,
    handling_level: str,
    out_path: str,
    fps: Optional[float] = None,
    speed_factor: float = 1.0,
    settings: Optional[Settings] = None,
) -> str:
    """Write an annotated MP4 to ``out_path``. Returns the path."""
    settings = settings or load_settings()
    info, frame_iter = sample_frames(video, fps=fps, settings=settings)
    frames = list(frame_iter)
    w, h = info.width, info.height

    jumps = jump_frame_flags(tracks)
    centers = _smooth_centers_px(tracks, w, h)

    out_fps = (fps if fps is not None else settings.sample_fps)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), out_fps, (w, h))

    score_lines = [
        ("energy", scores.energy),
        ("stress", scores.stress),
        ("approachability", scores.approachability),
        ("confidence", scores.confidence),
        ("arousal_spikes", scores.arousal_spikes),
    ]

    for i, sf in enumerate(frames):
        frame = sf.frame.copy()
        t = tracks[i] if i < len(tracks) else None

        # Trail.
        trail = [centers[j] for j in range(max(0, i - _TRAIL_LEN), i + 1) if j < len(centers)]
        trail = [p for p in trail if p is not None]
        for a, b in zip(trail, trail[1:]):
            cv2.line(frame, a, b, (0, 220, 255), 2)

        # Box.
        if t is not None and t.box_px is not None:
            x1, y1, x2, y2 = (int(v) for v in t.box_px)
            color = (0, 200, 0) if not t.interpolated else (0, 160, 200)
            cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
        if t is not None and t.blurry:
            cv2.putText(frame, "blurry (skipped)", (10, h - 15),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 165, 255), 2)

        # Score panel.
        cv2.rectangle(frame, (0, 0), (_PANEL_W, 150), (30, 30, 30), -1)
        cv2.putText(frame, f"level: {handling_level}", (8, 20),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)
        for k, (name, val) in enumerate(score_lines):
            cv2.putText(frame, f"{name}: {val}", (8, 45 + k * 22),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 220, 220), 1)

        # JUMP flash.
        if i < len(jumps) and jumps[i]:
            cv2.putText(frame, "JUMP", (w // 2 - 70, 60),
                        cv2.FONT_HERSHEY_SIMPLEX, 1.6, (0, 0, 255), 4)

        # Camera-motion arrow (bottom-right corner): shows compensation working.
        if t is not None:
            ox, oy = w - 60, h - 60
            gain = 2500.0  # amplify small normalized motion for visibility
            ex = int(ox + t.cam_dx * gain)
            ey = int(oy + t.cam_dy * gain)
            cv2.circle(frame, (ox, oy), 3, (200, 200, 200), -1)
            cv2.arrowedLine(frame, (ox, oy), (ex, ey), (255, 255, 0), 2, tipLength=0.3)
            cv2.putText(frame, "cam", (ox - 40, oy + 25),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1)

        writer.write(frame)

    writer.release()

    # OpenCV writes MPEG-4 Part 2 ("mp4v"), which browsers reject. Transcode the
    # finished file in place to browser-safe H.264 (yuv420p, +faststart) so every
    # caller (run-all, segments, /analyze) gets a playable video.
    from .transcode import transcode_in_place
    transcode_in_place(out_path)
    return out_path
