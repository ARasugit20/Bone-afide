"""Nine-clip reliability report from cached baseline pose JSON. No threshold changes.

Usage: python benchmark.py
"""
import json
import math
import subprocess
from pathlib import Path

import cv2
import numpy as np

from metrics import GROUPS, confidence_distribution, group_confidence, median, median_filter, normalized_jitter, quality_status
from pose_features import compute

HERE = Path(__file__).parent
RAW = (HERE / ".." / "data" / "raw").resolve()
CACHE = HERE / "tune_cache.json"
REPORT = HERE / "benchmark_report.json"
ORIGINAL = {"june", "kacy", "katie", "kinder", "luna", "max"}


def probe(video: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height,r_frame_rate,nb_frames",
         "-show_entries", "format=duration", "-of", "json", str(video)],
        capture_output=True, text=True, check=True)
    meta = json.loads(out.stdout)
    s = meta["streams"][0]
    num, den = s["r_frame_rate"].split("/")
    return {"file": video.name, "duration_s": round(float(meta["format"]["duration"]), 2),
            "width": s["width"], "height": s["height"], "fps": round(int(num) / int(den), 2),
            "frames": int(s.get("nb_frames") or 0)}


def image_stats(video: Path, n: int = 12) -> dict:
    cap = cv2.VideoCapture(str(video))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    lumas, contrasts, sharp = [], [], []
    for i in [int(total * f) for f in np.linspace(0.05, 0.95, n)]:
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, frame = cap.read()
        if not ok:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        lumas.append(float(gray.mean()))
        contrasts.append(float(gray.std()))
        sharp.append(float(cv2.Laplacian(gray, cv2.CV_64F).var()))
    cap.release()
    return {"mean_luma": round(float(np.mean(lumas)), 1), "contrast_std": round(float(np.mean(contrasts)), 1),
            "sharpness_laplacian": round(float(np.median(sharp)), 1), "frames_sampled_for_quality": len(lumas)}


def smoothed_jitter(pose, names, window):
    """Median-filter x/y of confident points, then reuse the jitter metric. Real jumps survive a window of 3."""
    frames = pose["frames"]
    series = {n: {"x": [], "y": [], "c": []} for n in names}
    for f in frames:
        for n in names:
            v = f["keypoints"].get(n)
            series[n]["x"].append(v[0] if v else None)
            series[n]["y"].append(v[1] if v else None)
            series[n]["c"].append(v[2] if v else 0)
    new_frames = []
    for i in range(len(frames)):
        kp = dict(frames[i]["keypoints"])
        for n in names:
            if n not in kp:
                continue
            xs = median_filter(series[n]["x"], window)
            ys = median_filter(series[n]["y"], window)
            if xs[i] is None:
                continue
            kp[n] = [xs[i], ys[i], series[n]["c"][i]]
        new_frames.append({"keypoints": kp})
    return normalized_jitter({**pose, "frames": new_frames}, names)


def one(video: Path, entry: dict) -> dict:
    pose = json.loads(Path(entry["best"]["pose"]).read_text())
    vp = entry.get("viewpoint", "unknown")
    feats = compute(pose, vp)
    dist = confidence_distribution(pose)
    groups = group_confidence(pose)
    jitters = {g: normalized_jitter(pose, [n for n in members if n in (pose.get("keypoint_names") or [])])
               for g, members in GROUPS.items()}
    filtered = {g: {"raw": jitters[g], "median3": smoothed_jitter(pose, members, 3), "median5": smoothed_jitter(pose, members, 5)}
                for g, members in GROUPS.items()}
    usable = feats["backline_coverage"]
    status = quality_status(usable, dist["mean"], jitters["torso"])
    pct = feats["posture_pct"] if isinstance(feats["posture_pct"], dict) else {}
    return {
        "file": video.name, "viewpoint": vp, "config": entry["best"]["tag"], "infer_seconds": entry["best"]["seconds"],
        "duration_s": probe(video)["duration_s"],
        "standing_pct": pct.get("standing"), "sitting_pct": pct.get("sitting"), "lying_pct": pct.get("lying"),
        "tail_median": feats.get("tail_height_median"), "tail_iqr": feats.get("tail_height_iqr"),
        "head_median": feats.get("head_height_median"), "head_iqr": feats.get("head_height_iqr"),
        "mean_conf": dist["mean"], "median_conf": dist["median"], "conf_iqr": dist["iqr"],
        "conf_frac": dist["frac"], "usable_frames_pct": round(100 * usable, 1),
        "frames_used": feats["frames_used"], "frames_sampled": feats["frames_total"],
        "groups": groups, "jitter": filtered, "quality_status": status,
        "bbox": entry.get("box"), "luma_at_tune": entry.get("luma"),
        "pose_quality_status": status, "match_influence_allowed": False,
        "pipeline_status": "completed",
    }


def aggregate(rows):
    def med(key):
        xs = [r[key] for r in rows if isinstance(r.get(key), (int, float))]
        return None if not xs else round(median(xs), 3)
    return {"n": len(rows), "median_mean_conf": med("mean_conf"), "median_usable_pct": med("usable_frames_pct"),
            "median_head_iqr": med("head_iqr"), "median_tail_iqr": med("tail_iqr"),
            "median_torso_jitter": med("jitter") and None,
            "stable": sum(r["quality_status"] == "STABLE" for r in rows),
            "partial": sum(r["quality_status"] == "PARTIALLY_STABLE" for r in rows),
            "unstable": sum(r["quality_status"] == "UNSTABLE" for r in rows),
            "insufficient": sum(r["quality_status"] == "INSUFFICIENT_VISIBILITY" for r in rows)}


def main() -> None:
    videos = sorted(RAW.glob("*.mp4"))
    print("FILES:")
    for v in videos:
        print(" ", v.name)
    cache = json.loads(CACHE.read_text())
    missing = [v.stem for v in videos if not cache.get(v.stem, {}).get("best")]
    if missing:
        raise SystemExit(f"no baseline pose for: {missing}. Run tune.py --clips {' '.join(missing)}")
    inputs = {v.stem: {**probe(v), **image_stats(v)} for v in videos}
    rows = [one(v, cache[v.stem]) for v in videos]
    by = {r["file"].split(".")[0]: r for r in rows}
    report = {"inputs": inputs, "clips": rows,
              "original_six": aggregate([by[k] for k in sorted(ORIGINAL)]),
              "new_three": aggregate([by[k] for k in ("beal", "jorja", "noa")]),
              "all_nine": aggregate(rows)}
    # fix torso jitter aggregate properly
    for name, subset in (("original_six", [by[k] for k in sorted(ORIGINAL)]),
                         ("new_three", [by[k] for k in ("beal", "jorja", "noa")]),
                         ("all_nine", rows)):
        xs = [r["jitter"]["torso"]["raw"] for r in subset if r["jitter"]["torso"]["raw"] is not None]
        report[name]["median_torso_jitter"] = None if not xs else round(median(xs), 4)
    REPORT.write_text(json.dumps(report, indent=2))
    print(f"wrote {REPORT}")
    for r in rows:
        print(f"{r['file']:12} {r['quality_status']:22} conf={r['mean_conf']} usable={r['usable_frames_pct']} torso_jit={r['jitter']['torso']['raw']}")


if __name__ == "__main__":
    main()
