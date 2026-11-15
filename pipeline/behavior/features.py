"""Features per clip: motion measures derived from the per-frame track.

Geometry is normalized (0-1). Speed is in body lengths per second (center
displacement / box width) so it is camera-distance independent. Blurry frames are
excluded. Two corrections run before any motion is measured:

  1. Camera compensation. These clips are handheld; the per-frame camera translation
     and scale (estimated in ``camera.py``) are removed so the dog's motion is
     measured relative to the scene, not the frame.
  2. Smoothing. The box center and size are filtered with a 5-frame median (kills
     detector spikes) then a short moving average (kills jitter), before velocity.

Signals kept distinct:
  - pacing: horizontal direction reversals, each requiring real displacement
    (deadband = max(0.5 body lengths, 3% of frame width)) sustained >= 0.3 s.
  - circling: accumulated trajectory turning per minute.
  - jumping / standing up: box top rises > 12% of frame height vs. its rolling
    2-second median AND h/w ratio increases > 20%, sustained >= 0.3 s; each sustained
    event counted once. Time-based so slow-motion (speed_factor) works.

Approachability "close": box area exceeds an absolute fraction of the frame
(``close_area_frac``), combined with time spent horizontally centered.

Pose seam: ``extract_features(..., pose=None)`` stores pose for a future stage.
"""

from __future__ import annotations

import math
from statistics import median
from typing import Optional

from .schemas import ClipFeatures, FrameTrack
from .zones import Polygon, in_zone

# --- tunables ---
MEDIAN_WINDOW = 5               # frames, median filter on center and size
MA_WINDOW = 3                   # frames, moving average after the median
MOVING_SPEED_BL = 0.15          # body lengths/sec above which a frame is "moving"
REVERSAL_DEADBAND_BL = 1.0      # body lengths of net excursion ...
REVERSAL_DEADBAND_FRAME = 0.06  # ... or 6% of frame width, whichever is larger
PERSIST_S = 0.3                 # a reversal/jump must persist at least this long
CIRCLING_DEADBAND_BL = 0.5
JUMP_TOP_RISE_FRAME = 0.10      # box top must rise > 10% of frame height ...
JUMP_HW_INCREASE = 0.20         # ... AND h/w ratio must rise > 20% ...
ACCEL_MIN_BL = 1.0              # a "sudden acceleration" must exceed this absolute speed
JUMP_MEDIAN_WIN_S = 2.0         # ... vs the top's rolling 2-second median.
CENTER_BAND = (0.2, 0.8)        # "centered": box center x within the middle 60%
DEFAULT_CLOSE_AREA_FRAC = 0.08  # "close": box covers > 8% of the frame


def _center(b):
    return ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0)


def _width(b):
    return abs(b[2] - b[0]) or 1e-6


def _height(b):
    return abs(b[3] - b[1]) or 1e-6


def _area(b):
    return _width(b) * _height(b)


def _hw_ratio(b):
    return _height(b) / _width(b)


def _median_filter(vals: list[float], window: int) -> list[float]:
    if window <= 1 or len(vals) < 2:
        return list(vals)
    half = window // 2
    n = len(vals)
    return [median(vals[max(0, i - half):min(n, i + half + 1)]) for i in range(n)]


def _moving_avg(vals: list[float], window: int) -> list[float]:
    if window <= 1 or len(vals) < 2:
        return list(vals)
    half = window // 2
    n = len(vals)
    out = []
    for i in range(n):
        seg = vals[max(0, i - half):min(n, i + half + 1)]
        out.append(sum(seg) / len(seg))
    return out


def _smooth_series(vals: list[float]) -> list[float]:
    return _moving_avg(_median_filter(vals, MEDIAN_WINDOW), MA_WINDOW)


def _percentile(sorted_vals, q):
    if not sorted_vals:
        return 0.0
    idx = min(len(sorted_vals) - 1, max(0, int(q * (len(sorted_vals) - 1))))
    return sorted_vals[idx]


def jump_events(
    times, boxes, heights, hw, *, frame_rel_rise=JUMP_TOP_RISE_FRAME,
) -> list[int]:
    """Indices (into the boxes list) where a sustained jump/standing-up event starts.

    Baseline is the dog's GROUNDED pose, not a rolling median: when a dog jumps
    repeatedly the rolling median is dragged up by the jumps themselves and hides
    them. We take the grounded top as the 75th percentile of top values (largest y1 =
    lowest in frame) and the grounded h/w as the 25th percentile. A frame qualifies
    when its box top is more than ``frame_rel_rise`` of the frame height above the
    grounded top AND its h/w ratio is > JUMP_HW_INCREASE above the grounded h/w. A run
    of qualifying frames (bridging gaps under PERSIST_S) that spans >= PERSIST_S is
    one event, recorded at its first frame.
    """
    n = len(boxes)
    if n < 2:
        return []
    tops = [b[1] for b in boxes]  # y1; smaller = higher in frame
    grounded_top = _percentile(sorted(tops), 0.75)   # low in frame = resting
    grounded_hw = _percentile(sorted(hw), 0.25)       # short/wide = resting

    qualifies = [
        (grounded_top - tops[i]) > frame_rel_rise
        and (hw[i] - grounded_hw) / (grounded_hw or 1e-6) > JUMP_HW_INCREASE
        for i in range(n)
    ]

    # Collapse runs (allowing short sub-PERSIST_S dips) into sustained events.
    events = []
    i = 0
    while i < n:
        if not qualifies[i]:
            i += 1
            continue
        start = i
        last_true = i
        j = i + 1
        while j < n:
            if qualifies[j]:
                last_true = j
            elif times[j] - times[last_true] > PERSIST_S:
                break
            j += 1
        if times[last_true] - times[start] >= PERSIST_S or last_true > start:
            events.append(start)
        i = last_true + 1
    return events


def scene_series(tracks: list[FrameTrack]):
    """Reconstruct the camera-compensated, smoothed per-frame series used for motion.

    Returns a dict with parallel lists over the usable (boxed, non-blurry) frames:
    ``idx`` (index into ``tracks``), ``times``, ``cx``, ``cy``, ``ws``, ``hs``,
    ``hw``, and the smoothed ``boxes``. Returns None if fewer than 2 usable frames.
    Shared by feature extraction and event-timeline extraction so both agree.
    """
    usable = [(i, t) for i, t in enumerate(tracks)
              if t.box_norm is not None and not t.blurry]
    if len(usable) < 2:
        return None
    idx = [i for i, _ in usable]
    times = [t.timestamp_s for _, t in usable]
    cam_x = cam_y = 0.0
    rx, ry, rw, rh = [], [], [], []
    for _, t in usable:
        cam_x += t.cam_dx
        cam_y += t.cam_dy
        c = _center(t.box_norm)
        rx.append(c[0] - cam_x)
        ry.append(c[1] - cam_y)
        rw.append(_width(t.box_norm))
        rh.append(_height(t.box_norm))
    cx, cy = _smooth_series(rx), _smooth_series(ry)
    ws, hs = _smooth_series(rw), _smooth_series(rh)
    hw = [h / (w or 1e-6) for w, h in zip(ws, hs)]
    boxes = [(cx[k] - ws[k] / 2, cy[k] - hs[k] / 2, cx[k] + ws[k] / 2, cy[k] + hs[k] / 2)
             for k in range(len(idx))]
    return {"idx": idx, "times": times, "cx": cx, "cy": cy, "ws": ws, "hs": hs,
            "hw": hw, "boxes": boxes}


def jump_frame_flags(tracks: list[FrameTrack]) -> list[bool]:
    """Per-track-frame boolean: True on frames belonging to a detected jump event.

    Reuses the same time-based jump detection as :func:`extract_features` (on
    scene-relative, smoothed boxes) so the annotator flashes on the same frames.
    The flash is held for ~PERSIST_S seconds from each event's start.
    """
    flags = [False] * len(tracks)
    idxs = [i for i, t in enumerate(tracks) if t.box_norm is not None and not t.blurry]
    if len(idxs) < 2:
        return flags

    cam_cum_x = cam_cum_y = 0.0
    cx, cy, ws, hs = [], [], [], []
    for i in idxs:
        t = tracks[i]
        cam_cum_x += t.cam_dx
        cam_cum_y += t.cam_dy
        c = _center(t.box_norm)
        cx.append(c[0] - cam_cum_x)
        cy.append(c[1] - cam_cum_y)
        ws.append(_width(t.box_norm))
        hs.append(_height(t.box_norm))
    cx = _smooth_series(cx); cy = _smooth_series(cy)
    ws = _smooth_series(ws); hs = _smooth_series(hs)
    times = [tracks[i].timestamp_s for i in idxs]
    boxes = [(cx[k] - ws[k] / 2, cy[k] - hs[k] / 2, cx[k] + ws[k] / 2, cy[k] + hs[k] / 2)
             for k in range(len(idxs))]
    hw = [hs[k] / (ws[k] or 1e-6) for k in range(len(idxs))]

    events = jump_events(times, boxes, hs, hw)
    for e in events:
        start_t = times[e]
        for k in range(e, len(idxs)):
            if times[k] - start_t > PERSIST_S:
                break
            flags[idxs[k]] = True
    return flags


def extract_features(
    tracks: list[FrameTrack],
    zone: Polygon,
    *,
    pose: Optional[dict] = None,
    frame_w: int = 0,
    frame_h: int = 0,
    duration_s: float = 0.0,
    close_area_frac: float = DEFAULT_CLOSE_AREA_FRAC,
) -> ClipFeatures:
    """Compute clip features from the (camera-compensated) track."""
    feats = ClipFeatures(frame_w=frame_w, frame_h=frame_h, duration_s=duration_s, pose=pose)
    n = len(tracks)
    if n == 0:
        return feats

    non_blurry = [t for t in tracks if not t.blurry]
    if non_blurry:
        real = sum(1 for t in non_blurry if t.detected and not t.interpolated)
        feats.detection_coverage = real / len(non_blurry)

    usable = [t for t in tracks if t.box_norm is not None and not t.blurry]
    if len(usable) < 2:
        if usable:
            feats.hw_ratio_mean = _hw_ratio(usable[0].box_norm)
            feats.hw_ratio_series = [round(feats.hw_ratio_mean, 4)]
        return feats

    boxes = [t.box_norm for t in usable]
    times = [t.timestamp_s for t in usable]

    # Scene-relative centers: subtract cumulative camera translation. Camera motion
    # is stored per frame as displacement from the previous frame.
    cam_cum_x = 0.0
    cam_cum_y = 0.0
    raw_cx, raw_cy, raw_w, raw_h = [], [], [], []
    for t in usable:
        cam_cum_x += t.cam_dx
        cam_cum_y += t.cam_dy
        cx, cy = _center(t.box_norm)
        raw_cx.append(cx - cam_cum_x)
        raw_cy.append(cy - cam_cum_y)
        raw_w.append(_width(t.box_norm))
        raw_h.append(_height(t.box_norm))

    # Median + moving-average smoothing on center AND size.
    cx = _smooth_series(raw_cx)
    cy = _smooth_series(raw_cy)
    ws = _smooth_series(raw_w)
    hs = _smooth_series(raw_h)
    centers = list(zip(cx, cy))
    hw = [h / (w or 1e-6) for w, h in zip(ws, hs)]

    feats.hw_ratio_series = [round(v, 4) for v in hw]
    feats.hw_ratio_mean = sum(hw) / len(hw)

    total_time = (times[-1] - times[0]) or 1e-6
    frame_w_norm = 1.0  # normalized coordinates: frame width = 1.0

    # Per-step speed in body lengths/sec.
    speeds_bl, step_dx_bl, step_dy_bl, step_dt = [], [], [], []
    for i in range(1, len(centers)):
        dt = times[i] - times[i - 1]
        if dt <= 0:
            continue
        bw = (ws[i] + ws[i - 1]) / 2.0 or 1e-6
        dx = (centers[i][0] - centers[i - 1][0]) / bw
        dy = (centers[i][1] - centers[i - 1][1]) / bw
        speeds_bl.append(math.hypot(dx, dy) / dt)
        step_dx_bl.append(dx)
        step_dy_bl.append(dy)
        step_dt.append(dt)

    if speeds_bl:
        feats.mean_speed = sum(speeds_bl) / len(speeds_bl)
        moving = sum(1 for s in speeds_bl if s > MOVING_SPEED_BL)
        feats.pct_time_moving = 100.0 * moving / len(speeds_bl)
        # vertical movement magnitude (body lengths/sec), for energy.
        feats.vertical_motion = sum(abs(dy) for dy in step_dy_bl) / total_time

    # Pacing: count a reversal only when the dog made a real excursion in one
    # direction (>= deadband body lengths, sustained >= PERSIST_S) and then reverses.
    # Deadband = larger of 0.5 body lengths or 3% of frame width (in body lengths).
    # Travel is accumulated PER DIRECTION and reset on every direction change, so
    # sub-threshold jitter never accumulates into a phantom reversal.
    # Split the horizontal track into directional runs. A run "commits" only if its
    # NET displacement (not summed path length) is >= deadband body lengths and it
    # lasts >= PERSIST_S. Using net displacement means tiny same-direction jitter can
    # never accumulate into a phantom excursion. A reversal is one committed run
    # followed by a committed run in the opposite direction.
    deadband = REVERSAL_DEADBAND_BL
    if ws:
        bw_mean = sum(ws) / len(ws) or 1e-6
        deadband = max(REVERSAL_DEADBAND_BL, (REVERSAL_DEADBAND_FRAME * frame_w_norm) / bw_mean)

    runs = []  # (sign, net_displacement_bl, duration_s)
    run_sign = 0
    run_net = 0.0
    run_start_t = times[0] if times else 0.0
    for i, dx in enumerate(step_dx_bl):
        if abs(dx) < 1e-4:
            continue
        sign = 1 if dx > 0 else -1
        if sign == run_sign:
            run_net += dx
        else:
            if run_sign != 0:
                runs.append((run_sign, abs(run_net), times[i] - run_start_t))
            run_sign = sign
            run_net = dx
            run_start_t = times[i]
    if run_sign != 0:
        runs.append((run_sign, abs(run_net), times[-1] - run_start_t))

    committed = [r for r in runs if r[1] >= deadband and r[2] >= PERSIST_S]
    reversals = sum(1 for a, b in zip(committed, committed[1:]) if a[0] != b[0])
    feats.reversals_per_min = reversals / total_time * 60.0

    # Circling.
    total_turn = 0.0
    travel_since = 0.0
    for i in range(1, len(centers) - 1):
        bw = ws[i] or 1e-6
        ax = (centers[i][0] - centers[i - 1][0]) / bw
        ay = (centers[i][1] - centers[i - 1][1]) / bw
        bx = (centers[i + 1][0] - centers[i][0]) / bw
        by = (centers[i + 1][1] - centers[i][1]) / bw
        la, lb = math.hypot(ax, ay), math.hypot(bx, by)
        travel_since += la
        if la < 1e-3 or lb < 1e-3 or travel_since < CIRCLING_DEADBAND_BL:
            continue
        ang = math.atan2(ay, ax) - math.atan2(by, bx)
        ang = (ang + math.pi) % (2 * math.pi) - math.pi
        total_turn += abs(ang)
        travel_since = 0.0
    feats.circling = (total_turn / (2 * math.pi)) / total_time * 60.0

    # Jumping (time-based, scene-relative smoothed boxes).
    smoothed_boxes = [
        (centers[i][0] - ws[i] / 2, centers[i][1] - hs[i] / 2,
         centers[i][0] + ws[i] / 2, centers[i][1] + hs[i] / 2)
        for i in range(len(centers))
    ]
    events = jump_events(times, smoothed_boxes, hs, hw)
    feats.jumps_per_min = len(events) / total_time * 60.0
    feats._jump_count = len(events)  # type: ignore[attr-defined]

    # Sudden accelerations toward the front zone.
    # A sudden acceleration must be a real burst: speed above an absolute threshold
    # (AND a relative spike) sustained across at least two consecutive steps and
    # directed into the front zone / downward. Single-frame speed spikes are almost
    # always box-size artifacts on a near-still dog, so they are ignored.
    accel_spikes = 0
    if len(speeds_bl) >= 2:
        srt = sorted(speeds_bl)
        med = srt[len(srt) // 2]
        thresh = max(med * 3.0, ACCEL_MIN_BL)
        i = 0
        while i < len(speeds_bl) - 1:
            fast_pair = speeds_bl[i] > thresh and speeds_bl[i + 1] > thresh
            toward = in_zone(boxes[i + 2], zone) or centers[i + 2][1] > centers[i][1] \
                if i + 2 < len(centers) else False
            if fast_pair and toward:
                accel_spikes += 1
                i += 2  # count each sustained burst once
            else:
                i += 1
    feats.sudden_accel_front = accel_spikes + len(events)

    # Approachability: absolute "close" + centered.
    areas = [_area(b) for b in boxes]
    pct_close = 100.0 * sum(1 for a in areas if a > close_area_frac) / len(areas)
    pct_centered = 100.0 * sum(
        1 for c in centers if CENTER_BAND[0] <= c[0] <= CENTER_BAND[1]
    ) / len(centers)
    feats.pct_close_camera = pct_close
    feats.pct_centered = pct_centered
    feats.pct_time_front_zone = 100.0 * sum(1 for b in boxes if in_zone(b, zone)) / len(boxes)

    return feats
