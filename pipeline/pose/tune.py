"""Profile each clip, preprocess it, and grid-search SuperAnimal inference settings.

Usage:
  python tune.py                       # all clips in ../data/raw, cached
  python tune.py --clips katie luna    # subset
  python tune.py --adapt               # also try video_adapt=True (slow on CPU)
"""
import argparse
import json
import math
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
import torch
from torchvision.models.detection import FasterRCNN_ResNet50_FPN_V2_Weights, fasterrcnn_resnet50_fpn_v2

HERE = Path(__file__).parent
RAW = (HERE / ".." / "data" / "raw").resolve()
WORK = HERE / "work"
OUT = HERE / "output"
CACHE = HERE / "tune_cache.json"
FPS = 5
MAX_SECONDS = 8
TARGET_DOG_PX = 400
COCO_DOG = 18


def probe(video: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,r_frame_rate", "-show_entries", "format=duration", "-of", "json", str(video)],
        capture_output=True, text=True, check=True,
    )
    meta = json.loads(out.stdout)
    s = meta["streams"][0]
    num, den = s["r_frame_rate"].split("/")
    return {"width": s["width"], "height": s["height"], "fps": round(int(num) / int(den), 2),
            "duration": round(float(meta["format"]["duration"]), 2)}


_detector = None


def detector():
    global _detector
    if _detector is None:
        weights = FasterRCNN_ResNet50_FPN_V2_Weights.COCO_V1
        _detector = fasterrcnn_resnet50_fpn_v2(weights=weights, box_score_thresh=0.5).eval()
    return _detector


def dog_box(video: Path, samples: int = 5) -> tuple[list[int] | None, float]:
    """Union dog bbox over sampled frames, plus mean luma."""
    cap = cv2.VideoCapture(str(video))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    idxs = [int(total * f) for f in np.linspace(0.1, 0.9, samples)]
    boxes, lumas = [], []
    model = detector()
    for i in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, frame = cap.read()
        if not ok:
            continue
        lumas.append(float(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).mean()))
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).float() / 255
        with torch.no_grad():
            pred = model([tensor])[0]
        keep = [j for j, lab in enumerate(pred["labels"].tolist()) if lab == COCO_DOG]
        if not keep:
            keep = list(range(min(1, len(pred["boxes"]))))
        for j in keep[:1]:
            boxes.append(pred["boxes"][j].tolist())
    cap.release()
    if not boxes:
        return None, float(np.mean(lumas) if lumas else 128)
    arr = np.array(boxes)
    box = [float(arr[:, 0].min()), float(arr[:, 1].min()), float(arr[:, 2].max()), float(arr[:, 3].max())]
    return [int(round(v)) for v in box], float(np.mean(lumas))


def viewpoint(box: list[int] | None) -> str:
    if not box:
        return "unknown"
    w, h = box[2] - box[0], box[3] - box[1]
    if h <= 0:
        return "unknown"
    ratio = w / h
    if ratio > 1.25:
        return "side"
    if ratio < 0.8:
        return "front_or_rear"
    return "oblique"


def preprocess(video: Path, box: list[int] | None, luma: float, meta: dict) -> tuple[Path, dict]:
    WORK.mkdir(parents=True, exist_ok=True)
    dest = WORK / f"{video.stem}_p.mp4"
    filters = [f"fps={FPS}"]
    if box:
        w, h = box[2] - box[0], box[3] - box[1]
        pad_x, pad_y = int(w * 0.15), int(h * 0.15)
        x0 = max(0, box[0] - pad_x)
        y0 = max(0, box[1] - pad_y)
        cw = min(meta["width"] - x0, w + 2 * pad_x)
        ch = min(meta["height"] - y0, h + 2 * pad_y)
        filters.append(f"crop={cw}:{ch}:{x0}:{y0}")
        dog_px = max(w, h)
        scale = max(1.0, TARGET_DOG_PX / max(1, dog_px))  # never downscale
        if scale > 1.01:
            filters.append(f"scale=iw*{scale:.3f}:-2:flags=lanczos")
    if luma < 80:
        filters.append("eq=contrast=1.15:brightness=0.03")  # CLAHE-like lift for dark clips
    cmd = ["ffmpeg", "-y", "-i", str(video), "-t", str(MAX_SECONDS), "-an",
           "-vf", ",".join(filters), "-c:v", "libx264", "-pix_fmt", "yuv420p", str(dest)]
    subprocess.run(cmd, check=True, capture_output=True)
    return dest, probe(dest)


def h5_to_json(path: Path, video: str, fps: float) -> dict:
    df = pd.read_hdf(path)
    if isinstance(df.columns, pd.MultiIndex) and "scorer" in (df.columns.names or []):
        df = df.droplevel("scorer", axis=1)
    if isinstance(df.columns, pd.MultiIndex) and "individuals" in (df.columns.names or []):
        best, best_mean = None, -2.0
        for ind in df.columns.get_level_values("individuals").unique():
            sub = df.xs(ind, axis=1, level="individuals")
            m = float(sub.xs("likelihood", axis=1, level="coords").mean().mean())
            if m > best_mean:
                best, best_mean = ind, m
        df = df.xs(best, axis=1, level="individuals")
    names = sorted({str(n) for n in df.columns.get_level_values("bodyparts").unique()})
    frames = []
    for i, (_, row) in enumerate(df.iterrows()):
        kp = {}
        for name in names:
            try:
                x, y = float(row[(name, "x")]), float(row[(name, "y")])
                c = float(row[(name, "likelihood")])
            except KeyError:
                continue
            if math.isnan(x) or math.isnan(y):
                continue
            kp[name] = [x, y, 0.0 if math.isnan(c) else c]
        frames.append({"t": round(i / fps, 3), "keypoints": kp})
    return {"video": video, "fps": fps, "keypoint_names": names, "frames": frames}


BACKLINE = [("neck_base", "back_base"), ("neck_base", "tail_base"), ("back_base", "tail_base"),
            ("back_base", "back_end"), ("neck_base", "back_end")]


def quality(pose: dict, cutoff: float = 0.25) -> dict:
    frames = pose["frames"]
    if not frames:
        return {"mean_conf": 0.0, "coverage": 0.0, "jitter": 1.0, "score": 0.0}
    confs, covered = [], 0
    for f in frames:
        kp = f["keypoints"]
        good = [v[2] for v in kp.values() if v[2] >= cutoff]
        if good:
            confs.append(float(np.mean(good)))
        if any(kp.get(a, [0, 0, 0])[2] >= cutoff and kp.get(b, [0, 0, 0])[2] >= cutoff for a, b in BACKLINE):
            covered += 1
    # jitter: median per-frame motion of confident points, normalised by frame diagonal
    diag = math.hypot(*[max(1.0, v) for v in (pose.get("width", 400), pose.get("height", 400))])
    moves = []
    for a, b in zip(frames, frames[1:]):
        d = [math.hypot(b["keypoints"][k][0] - a["keypoints"][k][0], b["keypoints"][k][1] - a["keypoints"][k][1])
             for k in a["keypoints"]
             if k in b["keypoints"] and a["keypoints"][k][2] >= cutoff and b["keypoints"][k][2] >= cutoff]
        if d:
            moves.append(float(np.median(d)) / diag)
    mean_conf = float(np.mean(confs)) if confs else 0.0
    coverage = covered / len(frames)
    jitter = float(np.median(moves)) if moves else 1.0
    return {"mean_conf": round(mean_conf, 3), "coverage": round(coverage, 3), "jitter": round(jitter, 4),
            "score": round(mean_conf * coverage * max(0.0, 1 - jitter), 4)}


def run_config(clip: Path, meta: dict, scale_list, video_adapt: bool, bbox_threshold: float) -> dict:
    import deeplabcut

    tag = f"{clip.stem}_s{'on' if scale_list else 'off'}_a{int(video_adapt)}_b{bbox_threshold}"
    dest = OUT / tag
    dest.mkdir(parents=True, exist_ok=True)
    started = time.time()
    deeplabcut.video_inference_superanimal(
        [str(clip)], "superanimal_quadruped",
        model_name="hrnet_w32", detector_name="fasterrcnn_resnet50_fpn_v2",
        scale_list=scale_list or None, video_adapt=video_adapt, bbox_threshold=bbox_threshold,
        dest_folder=str(dest), create_labeled_video=False, plot_bboxes=False, plot_trajectories=False,
        max_individuals=1,
    )
    elapsed = time.time() - started
    h5s = sorted(dest.rglob("*.h5"), key=lambda f: f.stat().st_mtime)
    if not h5s:
        return {"tag": tag, "error": "no h5", "seconds": round(elapsed, 1)}
    pose = h5_to_json(h5s[-1], clip.name, meta["fps"])
    pose["width"], pose["height"] = meta["width"], meta["height"]
    pose_path = dest / "pose.json"
    pose_path.write_text(json.dumps(pose))
    q = quality(pose)
    return {"tag": tag, "scale_list": scale_list, "video_adapt": video_adapt, "bbox_threshold": bbox_threshold,
            "seconds": round(elapsed, 1), "pose": str(pose_path), **q}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--clips", nargs="*")
    p.add_argument("--adapt", action="store_true")
    args = p.parse_args()

    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    videos = sorted(RAW.glob("*.mp4"))
    if args.clips:
        videos = [v for v in videos if v.stem in args.clips]

    for video in videos:
        entry = cache.get(video.stem, {})
        if entry.get("best") and not args.adapt:
            print(f"[skip] {video.stem} cached")
            continue
        meta = probe(video)
        box, luma = (entry.get("box"), entry.get("luma")) if entry.get("box") else dog_box(video)
        vp = viewpoint(box)
        clip, pmeta = preprocess(video, box, luma, meta)
        pmeta["fps"] = FPS
        print(f"[{video.stem}] {meta['width']}x{meta['height']} {meta['fps']}fps box={box} luma={round(luma)} view={vp} -> {pmeta['width']}x{pmeta['height']}")

        # One config: cropped clip, no extra scales, bbox 0.9. The 4-way grid scored
        # identically on june and kacy, so the extra runs only cost time.
        # --adapt runs video_adapt=True alone, used to decide whether to adopt it.
        grid = [([], True, 0.9)] if args.adapt else [([], False, 0.9)]

        runs = entry.get("runs", [])
        done = {r["tag"] for r in runs}
        for scale_list, adapt, bbox in grid:
            tag = f"{clip.stem}_s{'on' if scale_list else 'off'}_a{int(adapt)}_b{bbox}"
            if tag in done:
                continue
            try:
                r = run_config(clip, pmeta, scale_list, adapt, bbox)
            except Exception as exc:  # noqa: BLE001 - record and continue the grid
                r = {"tag": tag, "error": f"{type(exc).__name__}: {exc}"}
            print(f"  {r['tag']}: " + (r["error"] if "error" in r else
                  f"conf={r['mean_conf']} cov={r['coverage']} jit={r['jitter']} score={r['score']} {r['seconds']}s"))
            runs.append(r)
            cache[video.stem] = {"meta": meta, "box": box, "luma": luma, "viewpoint": vp,
                                 "processed": pmeta, "runs": runs}
            CACHE.write_text(json.dumps(cache, indent=2))
        ok = [r for r in runs if "error" not in r]
        if ok:
            best = max(ok, key=lambda r: r["score"])
            cache[video.stem]["best"] = best
            CACHE.write_text(json.dumps(cache, indent=2))
            print(f"  best: {best['tag']} score={best['score']}")


if __name__ == "__main__":
    main()
