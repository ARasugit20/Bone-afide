"""Tracking (stage 1): dog bounding box per sampled frame via YOLO11 + ByteTrack.

Uses pretrained YOLO11 detection filtered to the COCO "dog" class, with ByteTrack
association, to produce one :class:`~behavior.schemas.FrameTrack` per sampled frame.

Primary-track rule: we assume one dog per clip. When more than one track id appears
across the clip, the primary track is the one present in the most frames; ties break
on higher mean detection confidence. Frames with no detection (or no primary-track
detection) are kept as ``detected=False`` so the timeline stays intact for the
feature stage.

Breed is never used: detection is class-filtered to "dog" only; no breed signal
enters tracking, features, or scores.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable, Optional

from .ingest import SampledFrame
from .schemas import FrameTrack
from .settings import Settings, load_settings


def select_device() -> str:
    """Pick the best available torch device: Apple MPS, else CUDA, else CPU."""
    try:
        import torch

        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


@dataclass
class _RawDetection:
    track_id: Optional[int]
    box_px: tuple[float, float, float, float]
    conf: float


def _run_yolo(
    frames: list[SampledFrame],
    *,
    weights: str,
    dog_class_id: int,
    conf: float,
    device: str,
):
    """Run YOLO tracking frame-by-frame, yielding per-frame detections of the dog class.

    Returns a list (one entry per input frame) of lists of _RawDetection.
    Frame-by-frame ``.track(persist=True)`` keeps ByteTrack state across the clip.
    """
    from ultralytics import YOLO

    model = YOLO(weights)
    per_frame: list[list[_RawDetection]] = []

    for sf in frames:
        results = model.track(
            sf.frame,
            persist=True,
            classes=[dog_class_id],
            conf=conf,
            tracker="bytetrack.yaml",
            device=device,
            verbose=False,
        )
        dets: list[_RawDetection] = []
        if results:
            boxes = results[0].boxes
            if boxes is not None and len(boxes) > 0:
                xyxy = boxes.xyxy.tolist()
                confs = boxes.conf.tolist()
                ids = (
                    boxes.id.int().tolist()
                    if getattr(boxes, "id", None) is not None
                    else [None] * len(xyxy)
                )
                for box, c, tid in zip(xyxy, confs, ids):
                    dets.append(
                        _RawDetection(
                            track_id=int(tid) if tid is not None else None,
                            box_px=(box[0], box[1], box[2], box[3]),
                            conf=float(c),
                        )
                    )
        per_frame.append(dets)

    return per_frame


def _pick_primary_track(per_frame: list[list[_RawDetection]]) -> Optional[int]:
    """Choose the primary track id: most frames present, tie-break by mean confidence.

    Returns None when no detection carried a track id (e.g. all misses, or detections
    without ids), in which case the caller falls back to the highest-confidence
    detection per frame.
    """
    counts: dict[int, int] = defaultdict(int)
    conf_sum: dict[int, float] = defaultdict(float)
    for dets in per_frame:
        for d in dets:
            if d.track_id is not None:
                counts[d.track_id] += 1
                conf_sum[d.track_id] += d.conf
    if not counts:
        return None
    return max(
        counts,
        key=lambda tid: (counts[tid], conf_sum[tid] / counts[tid]),
    )


def _norm_box(
    box_px: tuple[float, float, float, float], w: int, h: int
) -> tuple[float, float, float, float]:
    if w <= 0 or h <= 0:
        return box_px
    return (box_px[0] / w, box_px[1] / h, box_px[2] / w, box_px[3] / h)


def track_clip(
    frames: Iterable[SampledFrame],
    *,
    frame_w: int,
    frame_h: int,
    weights: Optional[str] = None,
    conf: Optional[float] = None,
    settings: Optional[Settings] = None,
    device: Optional[str] = None,
    interp_gap_s: Optional[float] = None,
    blur_rel_threshold: Optional[float] = None,
    speed_factor: float = 1.0,
    camera_compensation: Optional[bool] = None,
) -> list[FrameTrack]:
    """Track the dog across sampled frames.

    Returns one FrameTrack per input frame, in order. Missing-detection frames are
    kept with ``detected=False``; short gaps (<= ``interp_gap_s``) between real
    detections are linearly interpolated and marked ``interpolated=True``.

    Blurry frames are marked ``blurry=True``; the threshold is relative to the clip's
    own median sharpness (a frame is blurry when its Laplacian variance is below
    ``blur_rel_threshold`` times the clip median), because absolute Laplacian values
    vary widely by camera and content. The feature stage excludes blurry frames from
    motion and they do not count as missed detections. ``speed_factor`` divides
    timestamps to correct slow-motion clips (real seconds = clip seconds / speed_factor).
    """
    settings = settings or load_settings()
    weights = weights or settings.yolo_weights
    conf = settings.detection_conf if conf is None else conf
    device = device or select_device()
    interp_gap_s = settings.max_interp_gap_s if interp_gap_s is None else interp_gap_s
    blur_rel = settings.blur_rel_threshold if blur_rel_threshold is None else blur_rel_threshold
    cam_comp = settings.camera_compensation if camera_compensation is None else camera_compensation
    sf_div = speed_factor if speed_factor and speed_factor > 0 else 1.0

    frame_list = list(frames)

    # Clip-relative blur cutoff from the sampled frames' sharpness distribution.
    blur_vars = [sf.blur_var for sf in frame_list if sf.blur_var >= 0]
    if blur_vars:
        median_var = sorted(blur_vars)[len(blur_vars) // 2]
        blur_cut = blur_rel * median_var
    else:
        blur_cut = -1.0  # no blur info -> skip nothing

    per_frame = _run_yolo(
        frame_list,
        weights=weights,
        dog_class_id=settings.dog_class_id,
        conf=conf,
        device=device,
    )

    primary = _pick_primary_track(per_frame)

    tracks: list[FrameTrack] = []
    for sf, dets in zip(frame_list, per_frame):
        ts = sf.timestamp_s / sf_div
        is_blurry = blur_cut >= 0 and sf.blur_var >= 0 and sf.blur_var < blur_cut

        chosen: Optional[_RawDetection] = None
        if primary is not None:
            for d in dets:
                if d.track_id == primary:
                    chosen = d
                    break
        if chosen is None and dets:
            # Fallback: no primary-track detection this frame; take highest conf.
            chosen = max(dets, key=lambda d: d.conf)

        if chosen is None:
            tracks.append(
                FrameTrack(timestamp_s=ts, detected=False,
                           blurry=is_blurry, blur_var=sf.blur_var)
            )
        else:
            tracks.append(
                FrameTrack(
                    timestamp_s=ts,
                    detected=True,
                    track_id=chosen.track_id,
                    box_px=chosen.box_px,
                    box_norm=_norm_box(chosen.box_px, frame_w, frame_h),
                    conf=chosen.conf,
                    blurry=is_blurry,
                    blur_var=sf.blur_var,
                )
            )
    fill_gaps(tracks, interp_gap_s)

    if cam_comp:
        from .camera import compensate
        compensate(frame_list, tracks, frame_w=frame_w, frame_h=frame_h)

    return tracks


def _lerp_box(b0: tuple, b1: tuple, t: float) -> tuple:
    return tuple(a + (b - a) * t for a, b in zip(b0, b1))


def fill_gaps(tracks: list[FrameTrack], max_gap_s: float) -> list[FrameTrack]:
    """Linearly interpolate the box across short detection gaps.

    A run of undetected frames bounded by detected frames on both sides is filled
    when the time span between those two detections is <= ``max_gap_s``. Filled
    frames are marked ``detected=True, interpolated=True`` with no confidence.
    Leading/trailing gaps (no detection on one side) are left untouched. Mutates and
    returns ``tracks``.
    """
    if max_gap_s <= 0 or not tracks:
        return tracks

    detected_idx = [i for i, t in enumerate(tracks) if t.detected and not t.interpolated]
    for a, b in zip(detected_idx, detected_idx[1:]):
        if b == a + 1:
            continue  # no gap
        left, right = tracks[a], tracks[b]
        span = right.timestamp_s - left.timestamp_s
        if span <= 0 or span > max_gap_s:
            continue
        has_px = left.box_px is not None and right.box_px is not None
        has_norm = left.box_norm is not None and right.box_norm is not None
        if not (has_px or has_norm):
            continue
        for k in range(a + 1, b):
            frac = (tracks[k].timestamp_s - left.timestamp_s) / span
            tracks[k].detected = True
            tracks[k].interpolated = True
            tracks[k].track_id = left.track_id
            if has_px:
                tracks[k].box_px = _lerp_box(left.box_px, right.box_px, frac)
            if has_norm:
                tracks[k].box_norm = _lerp_box(left.box_norm, right.box_norm, frac)
            tracks[k].conf = None
    return tracks


def blurry_rate(tracks: list[FrameTrack]) -> float:
    """Fraction (0-1) of sampled frames skipped as too blurry."""
    if not tracks:
        return 0.0
    return sum(1 for t in tracks if t.blurry) / len(tracks)


def detection_rate(tracks: list[FrameTrack], *, include_interpolated: bool = False) -> float:
    """Fraction (0-1) of frames with a box.

    By default counts only real detections (excludes interpolated fills) so the rate
    reflects detector performance. Pass ``include_interpolated=True`` for coverage.
    """
    # Blurry frames are excluded from the denominator: they are skipped, not missed.
    usable = [t for t in tracks if not t.blurry]
    if not usable:
        return 0.0
    if include_interpolated:
        return sum(1 for t in usable if t.detected) / len(usable)
    return sum(1 for t in usable if t.detected and not t.interpolated) / len(usable)
