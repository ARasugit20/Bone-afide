"""Turn a SuperAnimal pose JSON into posture and height features.

Usage:
  python pose_features.py --pose output/katie_pose.json
"""
import argparse
import json
import math
from pathlib import Path

CUTOFF = 0.25
MAX_GAP = 3
NOT_MEASURABLE = "not_measurable"

# Preference order; neck_base -> tail_base is the documented fallback back line.
BACKLINE = [("neck_base", "back_base"), ("back_base", "tail_base"), ("neck_base", "tail_base"),
            ("back_base", "back_end"), ("neck_base", "back_end")]


def pick(names, *needles):
    low = {n.lower(): n for n in names}
    for n in needles:
        if n in low:
            return low[n]
    for n in needles:
        for k, orig in low.items():
            if n in k:
                return orig
    return None


def interpolate(frames, names, max_gap=MAX_GAP):
    """Fill short confidence dropouts by linear interpolation between confident neighbours."""
    series = {n: [None] * len(frames) for n in names}
    for i, f in enumerate(frames):
        for n in names:
            v = f["keypoints"].get(n)
            if v and v[2] >= CUTOFF:
                series[n][i] = v
    for n in names:
        col = series[n]
        i = 0
        while i < len(col):
            if col[i] is None:
                j = i
                while j < len(col) and col[j] is None:
                    j += 1
                before, after = (i - 1 if i > 0 else None), (j if j < len(col) else None)
                if before is not None and after is not None and (j - i) <= max_gap:
                    a, b = col[before], col[after]
                    span = after - before
                    for k in range(i, j):
                        w = (k - before) / span
                        col[k] = [a[0] + w * (b[0] - a[0]), a[1] + w * (b[1] - a[1]), min(a[2], b[2])]
                i = j
            else:
                i += 1
    return series


def signed_height(pt, a, b):
    """Signed distance from line a->b; image y grows downward, so the sign is flipped to make up positive."""
    if not pt or not a or not b:
        return None
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < 1e-6:
        return None
    return -(dx * (pt[1] - a[1]) - dy * (pt[0] - a[0])) / length


def mean(xs):
    return sum(xs) / len(xs) if xs else None


def compute(pose: dict, viewpoint: str | None = None) -> dict:
    frames = pose["frames"]
    names = pose.get("keypoint_names") or sorted({k for f in frames for k in f["keypoints"]})
    series = interpolate(frames, names)
    get = lambda n, i: (series[n][i] if n and n in series else None)  # noqa: E731

    head_name = pick(names, "nose", "upper_jaw")
    tail_tip = pick(names, "tail_end", "tail_tip")
    pairs = [(pick(names, a), pick(names, b)) for a, b in BACKLINE]
    pairs = [(a, b) for a, b in pairs if a and b]
    shoulder = pick(names, "front_left_thai", "front_right_thai")
    hip = pick(names, "back_left_thai", "back_right_thai")
    front_paw = pick(names, "front_left_paw", "front_right_paw")
    hind_paw = pick(names, "back_left_paw", "back_right_paw")

    counts = {"standing": 0, "sitting": 0, "lying": 0}
    posture_n = 0
    tails, heads, confs, backline_frames = [], [], [], 0

    for i in range(len(frames)):
        line = next(((get(a, i), get(b, i)) for a, b in pairs if get(a, i) and get(b, i)), None)
        if not line:
            continue
        a, b = line
        body = math.hypot(b[0] - a[0], b[1] - a[1])
        if body < 1e-6:
            continue
        backline_frames += 1
        tip, head = get(tail_tip, i), get(head_name, i)
        th, hh = signed_height(tip, a, b), signed_height(head, a, b)
        if th is not None:
            tails.append(th / body)
            confs.append(min(tip[2], a[2], b[2]))
        if hh is not None:
            heads.append(hh / body)
            confs.append(min(head[2], a[2], b[2]))

        sh, hp = get(shoulder, i), get(hip, i)
        fp, bp = get(front_paw, i), get(hind_paw, i)
        if sh and hp and (fp or bp):
            front_drop = (fp[1] - sh[1]) / body if fp else None
            hind_drop = (bp[1] - hp[1]) / body if bp else None
            drops = [d for d in (front_drop, hind_drop) if d is not None]
            if max(drops) < 0.35:
                posture = "lying"
            elif hind_drop is not None and front_drop is not None and hind_drop < 0.55 <= front_drop:
                posture = "sitting"
            else:
                posture = "standing"
            counts[posture] += 1
            posture_n += 1
            confs.append(min(p[2] for p in (sh, hp, fp, bp) if p))

    total = len(frames) or 1
    # A head-on or rear view cannot support a side-profile height or posture read.
    blocked = viewpoint == "front_or_rear"
    summary = {
        "posture_pct": NOT_MEASURABLE if blocked or not posture_n else {k: round(100 * v / posture_n, 1) for k, v in counts.items()},
        "tail_height_mean": NOT_MEASURABLE if blocked or mean(tails) is None else round(mean(tails), 3),
        "head_height_mean": NOT_MEASURABLE if blocked or mean(heads) is None else round(mean(heads), 3),
        "mean_confidence": None if mean(confs) is None else round(mean(confs), 3),
        "frames_used": backline_frames,
        "frames_total": len(frames),
        "backline_coverage": round(backline_frames / total, 3),
        "posture_frames": posture_n,
        "viewpoint": viewpoint or "unknown",
    }
    return summary


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--pose", required=True)
    p.add_argument("--viewpoint")
    args = p.parse_args()
    pose = json.loads(Path(args.pose).read_text())
    print(f"keypoints ({len(pose.get('keypoint_names', []))}): {', '.join(pose.get('keypoint_names', []))}")
    summary = compute(pose, args.viewpoint)
    dest = Path(args.pose).with_name(Path(args.pose).stem.replace("_pose", "").replace("pose", "features") + "_features.json")
    dest.write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    print(f"wrote {dest}")


if __name__ == "__main__":
    main()
