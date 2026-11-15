"""Ingest: turn a kennel video (local path or S3 key) into sampled frames.

A clip is sampled at a fixed rate (default 2 fps). Each sampled frame carries its
timestamp in seconds from clip start so downstream stages share one timeline. The
source may be a local path or an S3 key; S3 keys are downloaded via boto3 using
credentials from ``pipeline/.env``.

Breed is never read here. ``dog_id`` and ``day`` are plain identifiers carried
through to outputs; any structured source metadata is checked by
``guardrails.assert_no_breed`` so a breed field can never enter the pipeline.
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional

import cv2

from .settings import Settings, load_settings


@dataclass
class SampledFrame:
    """One sampled frame: the BGR image and its timestamp from clip start."""

    index: int          # sequential index among sampled frames (0-based)
    timestamp_s: float  # seconds from clip start
    frame: "any"        # numpy ndarray (H, W, 3) BGR; typed loosely to avoid np import here
    blur_var: float = -1.0  # Laplacian variance (sharpness); lower = blurrier. -1 = unset


@dataclass
class ClipInfo:
    """Metadata about the opened clip.

    ``width``/``height`` are the effective (possibly downscaled) sampled-frame size;
    ``src_width``/``src_height`` are the original dimensions.
    """

    path: str
    width: int
    height: int
    src_fps: float
    frame_count: int
    duration_s: float
    src_width: int = 0
    src_height: int = 0


def _looks_like_s3(source: str) -> bool:
    return source.startswith("s3://")


def resolve_source(source: str, settings: Optional[Settings] = None) -> str:
    """Return a local filesystem path for ``source``.

    Local paths are returned as-is (after existence check). ``s3://bucket/key`` (or a
    bare key when ``S3_BUCKET`` is set) is downloaded to a temp file via boto3.
    """
    settings = settings or load_settings()

    if _looks_like_s3(source):
        import boto3  # local import so non-S3 runs need no AWS stack

        without_scheme = source[len("s3://"):]
        bucket, _, key = without_scheme.partition("/")
        if not key:
            raise ValueError(f"S3 source missing key: {source!r}")
        fd, tmp = tempfile.mkstemp(suffix=Path(key).suffix or ".mp4")
        os.close(fd)
        boto3.client("s3", region_name=settings.aws_region).download_file(
            bucket, key, tmp
        )
        return tmp

    path = Path(source)
    if not path.exists():
        raise FileNotFoundError(f"Video source not found: {source!r}")
    if not path.is_file():
        raise ValueError(f"Video source is not a file: {source!r}")
    return str(path)


def open_clip(path: str) -> tuple[cv2.VideoCapture, ClipInfo]:
    """Open a video and return the capture plus its metadata.

    Raises ``RuntimeError`` if the video cannot be opened or has no frames.
    """
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {path!r}")

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    # Guard against containers that report no fps/frames.
    if src_fps <= 0:
        src_fps = 30.0  # reasonable default; sampling still works by frame index
    duration_s = frame_count / src_fps if frame_count else 0.0

    # Probe: an unopenable-but-"opened" or empty clip should fail clearly.
    ok, _ = cap.read()
    if not ok:
        cap.release()
        raise RuntimeError(f"Video has no readable frames: {path!r}")
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # rewind after probe

    return cap, ClipInfo(
        path=path,
        width=width,
        height=height,
        src_fps=src_fps,
        frame_count=frame_count,
        duration_s=duration_s,
    )


def laplacian_variance(frame) -> float:
    """Sharpness measure: variance of the Laplacian. Lower = blurrier."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _downscale(frame, max_width: int):
    """Downscale a BGR frame to at most ``max_width`` px wide, keeping aspect ratio."""
    if max_width <= 0:
        return frame
    h, w = frame.shape[:2]
    if w <= max_width:
        return frame
    scale = max_width / w
    new_size = (max_width, max(1, round(h * scale)))
    return cv2.resize(frame, new_size, interpolation=cv2.INTER_AREA)


def sample_frames(
    source: str,
    *,
    fps: Optional[float] = None,
    max_width: Optional[int] = None,
    settings: Optional[Settings] = None,
) -> tuple[ClipInfo, Iterator[SampledFrame]]:
    """Open ``source`` and return (ClipInfo, iterator of SampledFrame) at ``fps``.

    Sampling keeps every Nth source frame where N = round(src_fps / target_fps),
    never below 1. Timestamps come from the source frame position so they stay
    accurate even when N is rounded. Frames are downscaled to at most ``max_width``
    px wide (default from settings; 0 disables); ``ClipInfo.width/height`` reflect
    the downscaled size so downstream normalization is correct.
    """
    settings = settings or load_settings()
    target_fps = fps if fps is not None else settings.sample_fps
    if target_fps <= 0:
        raise ValueError(f"fps must be positive, got {target_fps!r}")
    max_width = settings.max_frame_width if max_width is None else max_width

    local = resolve_source(source, settings)
    cap, info = open_clip(local)
    stride = max(1, round(info.src_fps / target_fps))

    # Compute effective (downscaled) dimensions for ClipInfo.
    info.src_width, info.src_height = info.width, info.height
    if max_width and info.width > max_width:
        scale = max_width / info.width
        info.width = max_width
        info.height = max(1, round(info.height * scale))

    def _iter() -> Iterator[SampledFrame]:
        sampled_index = 0
        src_index = 0
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                if src_index % stride == 0:
                    timestamp_s = src_index / info.src_fps
                    scaled = _downscale(frame, max_width)
                    yield SampledFrame(
                        index=sampled_index,
                        timestamp_s=timestamp_s,
                        frame=scaled,
                        blur_var=laplacian_variance(scaled),
                    )
                    sampled_index += 1
                src_index += 1
        finally:
            cap.release()

    return info, _iter()
