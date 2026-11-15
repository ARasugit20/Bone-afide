"""Summarize a SuperAnimal pose JSON into posture and height metrics.

Usage:
  python pose_features.py --pose output/katie_pose.json
"""
import argparse
import json
import math
from pathlib import Path

CONF_MIN = 0.5


def pick(names: list[str], *needles: str) -> str | None:
    lowered = {n.lower(): n for n in names}
    for needle in needles:
        if needle in lowered:
            return lowered[needle]
    for needle in needles:
        for low, original in lowered.items():
            if needle in low:
                return original
    return None


def point(frame: dict, name: str | None):
    if not name or name not in frame:
        return None
    x, y, c = frame[name]
    if c < CONF_MIN:
        return None
    return (x, y, c)


def signed_height(pt, a, b) -> float | None:
    """Signed distance of pt from line a->b, divided later by body length. Image y grows downward, so up is negative raw dy; we flip the sign."""
    if not pt or not a or not b:
        return None
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    if length < 1e-6:
        return None
    cross = dx * (pt[1] - a[1]) - dy * (pt[0] - a[0])
    return -cross / length


def mean(xs: list[float]) -> float | None:
    return sum(xs) / len(xs) if xs else None


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--pose", required=True)
    args = p.parse_args()
    data = json.loads(Path(args.pose).read_text())
    names = data.get("keypoint_names") or sorted({k for f in data["frames"] for k in f["keypoints"]})
    print(f"keypoints ({len(names)}): {', '.join(names)}")

    # SuperAnimal-Quadruped names, confirmed from this model's output.
    head_name = pick(names, "nose", "upper_jaw")
    tail_tip = pick(names, "tail_end", "tail_tip")
    line_pairs = [
        (pick(names, "neck_base"), pick(names, "back_base")),
        (pick(names, "neck_end"), pick(names, "back_base")),
        (pick(names, "back_base"), pick(names, "back_end")),
        (pick(names, "back_base"), pick(names, "tail_base")),
        (pick(names, "neck_base"), pick(names, "back_end")),
        (pick(names, "neck_base"), pick(names, "tail_base")),
        (pick(names, "neck_base"), pick(names, "back_middle")),
    ]
    line_pairs = [(a, b) for a, b in line_pairs if a and b]
    shoulder = pick(names, "front_left_thai", "front_right_thai")
    hip = pick(names, "back_left_thai", "back_right_thai")
    front_paw = pick(names, "front_left_paw", "front_right_paw")
    hind_paw = pick(names, "back_left_paw", "back_right_paw")
    print(f"using head={head_name} tail_tip={tail_tip} back-line candidates={line_pairs}")
    print(f"using shoulder={shoulder} hip={hip} front_paw={front_paw} hind_paw={hind_paw}")
    if not head_name or not line_pairs:
        raise SystemExit("could not map a head point and a back line from the keypoint names above")

    counts = {"standing": 0, "sitting": 0, "lying": 0}
    posture_n = 0
    tail_heights, head_heights, confs = [], [], []
    used = 0
    for frame in data["frames"]:
        kp = frame["keypoints"]
        line = next(((point(kp, a), point(kp, b)) for a, b in line_pairs if point(kp, a) and point(kp, b)), None)
        if not line:
            continue
        a, b = line
        body = math.hypot(b[0] - a[0], b[1] - a[1])
        if body < 1e-6:
            continue
        used += 1
        tip, head = point(kp, tail_tip), point(kp, head_name)
        th, hh = signed_height(tip, a, b), signed_height(head, a, b)
        if th is not None:
            tail_heights.append(th / body)
            confs.append(min(tip[2], a[2], b[2]))
        if hh is not None:
            head_heights.append(hh / body)
            confs.append(min(head[2], a[2], b[2]))

        # Image y grows downward, so a standing leg is a large positive drop from joint to paw.
        shoulder_pt, hip_pt = point(kp, shoulder), point(kp, hip)
        front, hind = point(kp, front_paw), point(kp, hind_paw)
        if shoulder_pt and hip_pt and (front or hind):
            drops = []
            if front:
                drops.append((front[1] - shoulder_pt[1]) / body)
            if hind:
                drops.append((hind[1] - hip_pt[1]) / body)
            front_drop = (front[1] - shoulder_pt[1]) / body if front else None
            hind_drop = (hind[1] - hip_pt[1]) / body if hind else None
            if max(drops) < 0.35:
                posture = "lying"
            elif hind_drop is not None and front_drop is not None and hind_drop < 0.55 and front_drop >= 0.55:
                posture = "sitting"
            else:
                posture = "standing"
            counts[posture] += 1
            posture_n += 1
            confs.append(min(p[2] for p in (shoulder_pt, hip_pt, front, hind) if p))

    total = posture_n or 1
    summary = {
        "posture_pct": {k: round(100 * v / total, 1) if posture_n else 0.0 for k, v in counts.items()},
        "tail_height_mean": None if mean(tail_heights) is None else round(mean(tail_heights), 3),
        "head_height_mean": None if mean(head_heights) is None else round(mean(head_heights), 3),
        "mean_confidence": None if mean(confs) is None else round(mean(confs), 3),
        "frames_used": used,
    }
    dest = Path(args.pose).with_name(Path(args.pose).stem.replace("_pose", "") + "_features.json")
    dest.write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    print(f"wrote {dest}")


if __name__ == "__main__":
    main()
