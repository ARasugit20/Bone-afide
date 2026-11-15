"""Ingest tests: bad path error and 2 fps sampling count on a synthetic clip."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from behavior import ingest


def _make_video(path: Path, *, fps: int, seconds: int, w: int = 160, h: int = 120) -> None:
    """Write a solid-color clip of known fps/duration."""
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (w, h))
    assert writer.isOpened(), "failed to open VideoWriter"
    total = fps * seconds
    for i in range(total):
        frame = np.full((h, w, 3), (i % 256), dtype=np.uint8)
        writer.write(frame)
    writer.release()


def test_bad_path_raises():
    with pytest.raises(FileNotFoundError):
        ingest.sample_frames("does/not/exist.mp4")


def test_sampling_count_at_2fps(tmp_path):
    # 10s clip at 30 fps -> sampling at 2 fps keeps every 15th frame -> ~20 frames.
    video = tmp_path / "clip.mp4"
    _make_video(video, fps=30, seconds=10)

    info, frame_iter = ingest.sample_frames(str(video), fps=2.0)
    frames = list(frame_iter)

    assert info.src_fps == pytest.approx(30, abs=1)
    # 300 source frames, stride round(30/2)=15 -> indices 0,15,...,285 => 20 frames.
    assert len(frames) == 20
    # timestamps increase and start at 0.
    assert frames[0].timestamp_s == pytest.approx(0.0)
    assert frames[1].timestamp_s == pytest.approx(0.5, abs=0.05)
    assert all(
        b.timestamp_s > a.timestamp_s
        for a, b in zip(frames, frames[1:])
    )


def test_sampling_count_at_default_fps_differs(tmp_path):
    # Same clip at 1 fps keeps every 30th -> 10 frames.
    video = tmp_path / "clip.mp4"
    _make_video(video, fps=30, seconds=10)
    _info, it = ingest.sample_frames(str(video), fps=1.0)
    assert len(list(it)) == 10
