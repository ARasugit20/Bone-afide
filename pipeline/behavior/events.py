"""Behavior evidence timeline: timestamped events with plain-English labels.

Derives a list of events from the per-frame track (camera-compensated, smoothed, via
``features.scene_series``) so the frontend can show what happened and when. Four
event types, all from real motion — never invented or smoothed-over:

  - jump          : a sustained jump / standing-up at the fence.
  - reversal      : a committed pacing direction change (back-and-forth).
  - acceleration  : a sudden burst of speed toward the front.
  - calm          : a stretch of >= 5 s with little movement.

Each event is ``{type, start_s, end_s, label}``. Labels pass the guardrails (no
banned words, no breed) via ``guardrails.sanitize``.
"""

from __future__ import annotations

import math
from typing import Optional

from .features import (
    ACCEL_MIN_BL,
    PERSIST_S,
    REVERSAL_DEADBAND_BL,
    REVERSAL_DEADBAND_FRAME,
    jump_events,
    scene_series,
)
from .guardrails import sanitize
from .schemas import FrameTrack

CALM_MIN_S = 5.0            # a calm stretch must last at least this long
CALM_WANDER_BL = REVERSAL_DEADBAND_BL  # max net wander (body lengths) to stay "calm"
                                       # = the pacing deadband, so jitter never breaks it


def _round(x: float) -> float:
    return round(float(x), 2)


def extract_events(tracks: list[FrameTrack]) -> list[dict]:
    """Return a time-ordered list of behavior events for one clip."""
    s = scene_series(tracks)
    if s is None:
        return []
    times = s["times"]
    cx, ws, hs, hw = s["cx"], s["ws"], s["hs"], s["hw"]
    boxes = s["boxes"]
    n = len(times)
    events: list[dict] = []

    # Per-step horizontal/overall speed in body lengths per second.
    speeds, dxs, step_times = [], [], []
    for i in range(1, n):
        dt = times[i] - times[i - 1]
        if dt <= 0:
            continue
        bw = (ws[i] + ws[i - 1]) / 2.0 or 1e-6
        dx = (cx[i] - cx[i - 1]) / bw
        dy = (s["cy"][i] - s["cy"][i - 1]) / bw
        speeds.append(math.hypot(dx, dy) / dt)
        dxs.append((i, dx))
        step_times.append((times[i - 1], times[i]))

    # --- jumps / standing up ---
    for e in jump_events(times, boxes, hs, hw):
        start = times[e]
        end = start
        for k in range(e, n):
            if times[k] - start > PERSIST_S:
                break
            end = times[k]
        events.append({"type": "jump", "start_s": _round(start), "end_s": _round(end),
                       "label": "Jumped up at the fence"})

    # --- pacing reversals (committed directional runs, opposite directions) ---
    deadband = REVERSAL_DEADBAND_BL
    if ws:
        bw = sum(ws) / len(ws) or 1e-6
        deadband = max(REVERSAL_DEADBAND_BL, REVERSAL_DEADBAND_FRAME / bw)
    runs = []  # (sign, net_bl, start_t, end_t)
    sign = 0
    net = 0.0
    run_start = times[0]
    for (i, dx) in dxs:
        if abs(dx) < 1e-4:
            continue
        sg = 1 if dx > 0 else -1
        if sg == sign:
            net += dx
        else:
            if sign != 0:
                runs.append((sign, abs(net), run_start, times[i - 1]))
            sign = sg
            net = dx
            run_start = times[i - 1]
    if sign != 0:
        runs.append((sign, abs(net), run_start, times[-1]))
    committed = [r for r in runs if r[1] >= deadband and (r[3] - r[2]) >= PERSIST_S]
    for a, b in zip(committed, committed[1:]):
        if a[0] != b[0]:
            events.append({"type": "reversal", "start_s": _round(a[2]),
                           "end_s": _round(b[3]), "label": "Paced back and forth"})

    # --- sudden accelerations toward the front ---
    if speeds:
        srt = sorted(speeds)
        med = srt[len(srt) // 2]
        thresh = max(med * 3.0, ACCEL_MIN_BL)
        j = 0
        while j < len(speeds) - 1:
            if speeds[j] > thresh and speeds[j + 1] > thresh:
                st = step_times[j][0]
                en = step_times[j + 1][1]
                events.append({"type": "acceleration", "start_s": _round(st),
                               "end_s": _round(en), "label": "Rushed toward the front"})
                j += 2
            else:
                j += 1

    # --- calm stretches ---
    # A calm stretch is a window of >= CALM_MIN_S where the dog stays put: it never
    # travels more than CALM_WANDER_BL body lengths from where the stretch began.
    # This uses net position (not per-step speed), so camera jitter or a one-frame
    # box wobble cannot break an otherwise-still stretch -- the old per-step-speed
    # test required EVERY step under threshold and so missed genuinely calm dogs.
    i = 0
    cy = s["cy"]
    while i < n:
        anchor_x, anchor_y = cx[i], cy[i]
        bw0 = ws[i] or 1e-6
        j = i
        while j + 1 < n:
            nx, ny = cx[j + 1], cy[j + 1]
            wander = math.hypot(nx - anchor_x, ny - anchor_y) / bw0
            if wander > CALM_WANDER_BL:
                break
            j += 1
        if times[j] - times[i] >= CALM_MIN_S:
            # Position of the box in frame: back (high in frame / small) vs near.
            mid = (i + j) // 2
            lying = hw[mid] < 0.8
            back = cy[mid] < 0.45  # higher in frame = further back in the kennel
            if lying:
                label = "Resting quietly"
            elif back:
                label = "Watching calmly from the back"
            else:
                label = "Calm and settled"
            events.append({"type": "calm", "start_s": _round(times[i]),
                           "end_s": _round(times[j]), "label": label})
            i = j + 1
        else:
            i += 1

    events = split_calm_around_active(events)
    events = merge_and_cap(events)
    # Guardrail: every label must be clean.
    for ev in events:
        sanitize(ev["label"], _path="event.label")
    return events


MERGE_GAP_S = 1.0        # same-type events closer than this are merged into one
MAX_EVENTS = 12          # keep at most this many (the longest), sorted by start
CALM_PAD_S = 0.5         # padding carved out around an active event
ACTIVE_TYPES = ("jump", "reversal", "acceleration")


def split_calm_around_active(events: list[dict]) -> list[dict]:
    """Ensure calm windows never overlap an active event.

    For each calm window, subtract every active (jump/reversal/acceleration)
    interval expanded by CALM_PAD_S on each side. Any remaining calm sub-piece
    shorter than CALM_MIN_S is dropped. Active events are returned unchanged.
    """
    active = [e for e in events if e["type"] in ACTIVE_TYPES]
    calm = [e for e in events if e["type"] == "calm"]
    if not calm:
        return events
    # Padded active intervals to carve out.
    blocks = sorted(((a["start_s"] - CALM_PAD_S, a["end_s"] + CALM_PAD_S) for a in active),
                    key=lambda b: b[0])

    kept_calm: list[dict] = []
    for c in calm:
        # Start with the full calm span, then subtract each overlapping block.
        pieces = [(c["start_s"], c["end_s"])]
        for bs, be in blocks:
            out = []
            for ps, pe in pieces:
                if be <= ps or bs >= pe:
                    out.append((ps, pe))            # no overlap
                    continue
                if bs > ps:
                    out.append((ps, bs))            # left remainder
                if be < pe:
                    out.append((be, pe))            # right remainder
            pieces = out
        for ps, pe in pieces:
            if pe - ps >= CALM_MIN_S:
                kept_calm.append({**c, "start_s": _round(ps), "end_s": _round(pe)})

    return active + kept_calm


def merge_and_cap(events: list[dict]) -> list[dict]:
    """Merge adjacent same-type events (gap < MERGE_GAP_S) and cap to MAX_EVENTS.

    Merging: events are grouped by type; within a type, any run whose consecutive
    gap (next.start - prev.end) is under MERGE_GAP_S collapses into one event with
    start = first start, end = last end, and the first event's label. If more than
    MAX_EVENTS remain, keep the MAX_EVENTS longest (by duration), then sort by start.
    """
    if not events:
        return []

    by_type: dict[str, list[dict]] = {}
    for e in events:
        by_type.setdefault(e["type"], []).append(e)

    merged: list[dict] = []
    for etype, evs in by_type.items():
        evs = sorted(evs, key=lambda e: e["start_s"])
        cur = dict(evs[0])
        for e in evs[1:]:
            if e["start_s"] - cur["end_s"] < MERGE_GAP_S:
                cur["end_s"] = max(cur["end_s"], e["end_s"])  # extend
            else:
                merged.append(cur)
                cur = dict(e)
        merged.append(cur)

    if len(merged) > MAX_EVENTS:
        merged = sorted(merged, key=lambda e: e["end_s"] - e["start_s"], reverse=True)[:MAX_EVENTS]

    merged.sort(key=lambda e: (e["start_s"], e["type"]))
    return merged
