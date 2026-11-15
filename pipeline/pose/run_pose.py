"""Downsample a clip and run SuperAnimal-Quadruped inference.

Usage:
  python run_pose.py --video ../../data/raw/katie.mp4 [--out DIR] [--fps 2] [--max-seconds 30]
"""
import argparse
import json
import subprocess
import time
from pathlib import Path

import pandas as pd


def downsample(src: Path, dest: Path, fps: float, max_seconds: float) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-y", "-i", str(src),
        "-t", str(max_seconds),
        "-an",
        "-vf", f"fps={fps},scale='min(720,iw)':-2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(dest),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def to_records(frame: pd.DataFrame) -> dict:
    """One MultiIndex frame -> {name: [x, y, conf]}."""
    out = {}
    names = frame.columns.get_level_values(-2).unique() if frame.columns.nlevels >= 2 else []
    coord_level = frame.columns.get_level_values(-1)
    for name in names:
        cols = frame.loc[:, frame.columns.get_level_values(-2) == name]
        coords = cols.columns.get_level_values(-1)
        def grab(key):
            hit = [c for c in cols.columns if c[-1] in (key,)]
            if not hit:
                return None
            val = cols.iloc[0][hit[0]]
            return None if pd.isna(val) else float(val)
        x, y = grab("x"), grab("y")
        conf = grab("likelihood")
        if conf is None:
            conf = grab("confidence")
        if x is None or y is None:
            continue
        out[str(name)] = [x, y, 0.0 if conf is None else conf]
    return out


def h5_to_json(path: Path, video: str, fps: float) -> dict:
    df = pd.read_hdf(path)
    # Drop the scorer level when present so bodypart is second-to-last.
    if isinstance(df.columns, pd.MultiIndex) and df.columns.nlevels >= 4:
        df.columns = df.columns.droplevel(0)
    if isinstance(df.columns, pd.MultiIndex) and "individuals" in (df.columns.names or []):
        individuals = df.columns.get_level_values("individuals").unique()
        if len(individuals):
            df = df.xs(individuals[0], axis=1, level="individuals")
    names = sorted({str(n) for n in df.columns.get_level_values(-2).unique()})
    frames = []
    for i, (_, row) in enumerate(df.iterrows()):
        frame = row.to_frame().T
        frame.columns = df.columns
        frames.append({"t": round(i / fps, 3), "keypoints": to_records(frame)})
    return {"video": video, "fps": fps, "keypoint_names": names, "frames": frames}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--video", required=True)
    p.add_argument("--out", default=str(Path(__file__).parent / "output"))
    p.add_argument("--fps", type=float, default=2)
    p.add_argument("--max-seconds", type=float, default=30)
    args = p.parse_args()

    src = Path(args.video).resolve()
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    copy = out / f"{src.stem}_ds.mp4"
    print(f"downsampling {src.name} -> {copy.name} at {args.fps} fps, <=720px, {args.max_seconds}s")
    downsample(src, copy, args.fps, args.max_seconds)

    import deeplabcut

    started = time.time()
    deeplabcut.video_inference_superanimal(
        [str(copy)],
        "superanimal_quadruped",
        model_name="hrnet_w32",
        detector_name="fasterrcnn_resnet50_fpn_v2",
        video_adapt=False,
        dest_folder=str(out),
        create_labeled_video=False,
        plot_bboxes=False,
        plot_trajectories=False,
    )
    elapsed = time.time() - started

    candidates = sorted(out.rglob("*.h5"), key=lambda f: f.stat().st_mtime)
    if not candidates:
        candidates = sorted(out.rglob("*.json"), key=lambda f: f.stat().st_mtime)
    if not candidates:
        raise SystemExit(f"no .h5 or .json written under {out}")
    raw = candidates[-1]
    if raw.suffix == ".h5":
        payload = h5_to_json(raw, src.name, args.fps)
    else:
        payload = json.loads(raw.read_text())
    dest_json = out / f"{src.stem}_pose.json"
    dest_json.write_text(json.dumps(payload))
    names = payload.get("keypoint_names") or sorted({k for f in payload["frames"] for k in f["keypoints"]})
    print(f"keypoints ({len(names)}): {', '.join(names)}")
    print(f"wrote {dest_json}")
    print(f"inference seconds: {elapsed:.1f}")


if __name__ == "__main__":
    main()
