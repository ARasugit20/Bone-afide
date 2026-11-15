"""Score each tuned clip against criteria.json and compute a 0-100 readiness.

Usage:
  python evaluate.py            # uses tune_cache.json best run per clip
"""
import argparse
import json
import math
from pathlib import Path

from pose_features import CUTOFF, compute

HERE = Path(__file__).parent
CACHE = HERE / "tune_cache.json"
CRITERIA = HERE / "criteria.json"
LABELS = HERE / "labels"
REPORT = HERE / "eval_report.json"
VERSION = "superanimal_quadruped_hrnet_w32/pose-1"


def detection_rate(pose: dict) -> float:
    frames = pose["frames"]
    if not frames:
        return 0.0
    hit = sum(1 for f in frames if any(v[2] >= CUTOFF for v in f["keypoints"].values()))
    return hit / len(frames)


def jitter(pose: dict) -> float:
    frames = pose["frames"]
    diag = math.hypot(pose.get("width", 400) or 400, pose.get("height", 400) or 400)
    moves = []
    for a, b in zip(frames, frames[1:]):
        d = [math.hypot(b["keypoints"][k][0] - a["keypoints"][k][0], b["keypoints"][k][1] - a["keypoints"][k][1])
             for k in a["keypoints"]
             if k in b["keypoints"] and a["keypoints"][k][2] >= CUTOFF and b["keypoints"][k][2] >= CUTOFF]
        if d:
            moves.append(sorted(d)[len(d) // 2] / diag)
    return sorted(moves)[len(moves) // 2] if moves else 1.0


def half_consistency(pose: dict, viewpoint: str) -> float | None:
    """Relative gap between the two halves' mean confidence; a proxy for drift inside one clip."""
    frames = pose["frames"]
    if len(frames) < 4:
        return None
    mid = len(frames) // 2
    halves = []
    for part in (frames[:mid], frames[mid:]):
        sub = compute({**pose, "frames": part}, viewpoint)
        if sub["mean_confidence"] is None:
            return None
        halves.append(sub["mean_confidence"])
    base = max(halves) or 1.0
    return abs(halves[0] - halves[1]) / base


def posture_accuracy(clip: str, pose: dict, viewpoint: str) -> float | str:
    path = LABELS / f"{clip}.csv"
    if not path.exists():
        return "pending"
    rows = [r.split(",") for r in path.read_text().strip().splitlines()[1:] if r.strip()]
    truth = {int(f): lab.strip() for f, lab, *_ in rows if lab.strip() in {"s", "i", "l"}}
    if not truth:
        return "pending"
    frames = pose["frames"]
    hits = total = 0
    code = {"standing": "s", "sitting": "i", "lying": "l"}
    for idx, label in truth.items():
        if idx >= len(frames):
            continue
        one = compute({**pose, "frames": [frames[idx]]}, viewpoint)
        pct = one["posture_pct"]
        if not isinstance(pct, dict) or not any(pct.values()):
            continue
        pred = code[max(pct, key=pct.get)]
        total += 1
        hits += int(pred == label)
    return round(hits / total, 3) if total else "pending"


def pct_of_ideal(value, spec) -> float | None:
    if value is None or isinstance(value, str):
        return None
    ideal, lower = spec["ideal"], spec.get("lower_is_better", False)
    if lower:
        return 100.0 if value <= ideal else max(0.0, 100 * ideal / value)
    return min(100.0, 100 * value / ideal) if ideal else 0.0


def main() -> None:
    argparse.ArgumentParser().parse_args()
    cache = json.loads(CACHE.read_text())
    criteria = json.loads(CRITERIA.read_text())
    out = {}
    for clip, entry in sorted(cache.items()):
        best = entry.get("best")
        if not best:
            continue
        pose = json.loads(Path(best["pose"]).read_text())
        vp = entry.get("viewpoint", "unknown")
        feats = compute(pose, vp)
        metrics = {
            "detection_rate": round(detection_rate(pose), 3),
            "backline_coverage": feats["backline_coverage"],
            "mean_confidence": feats["mean_confidence"],
            "jitter": round(jitter(pose), 4),
            "half_clip_consistency": (lambda v: None if v is None else round(v, 3))(half_consistency(pose, vp)),
            "posture_accuracy": posture_accuracy(clip, pose, vp),
        }
        pcts = [p for p in (pct_of_ideal(metrics[k], criteria[k]) for k in criteria if k in metrics) if p is not None]
        readiness = round(sum(pcts) / len(pcts)) if pcts else 0
        passes = {
            k: (None if isinstance(metrics[k], str) or metrics[k] is None else
                (metrics[k] <= criteria[k]["min"] if criteria[k].get("lower_is_better") else metrics[k] >= criteria[k]["min"]))
            for k in criteria if k in metrics
        }
        out[clip] = {"viewpoint": vp, "config": best["tag"], "seconds": best["seconds"],
                     "features": feats, "metrics": metrics, "passes": passes,
                     "readiness": readiness, "version": VERSION}
        print(f"{clip}: readiness={readiness} {metrics}")
    REPORT.write_text(json.dumps(out, indent=2))
    print(f"wrote {REPORT}")


if __name__ == "__main__":
    main()
