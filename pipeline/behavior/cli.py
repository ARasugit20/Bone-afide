"""Command-line entrypoints for the behavior pipeline.

Each stage is runnable on a single clip so it can be validated independently.
Currently implemented: ``track`` (ingest + YOLO11/ByteTrack tracking).

Example:
    python -m behavior.cli track --video data/raw/clip.mp4 --dog-id max-01
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Optional

from .annotate import annotate_clip
from .camera import camera_shake
from .features import extract_features
from .ingest import sample_frames
from .levels import assign_level
from .needs import derive_needs
from .schemas import build_summary
from .scores import compute_scores
from .settings import PIPELINE_ROOT, load_settings
from .track import blurry_rate, detection_rate, select_device, track_clip
from .zones import load_zone


def analyze_one(video, dog_id, day, *, fps=None, weights=None, conf=None,
                camera_id=None, speed_factor=1.0, settings=None, device=None):
    """Run ingest -> track -> features -> scores on one clip.

    Returns a dict with tracks, features, scores, and clip metadata. Shared by the
    ``analyze`` and ``run-all`` commands so they stay consistent.
    """
    settings = settings or load_settings()
    device = device or select_device()
    weights = weights or settings.yolo_weights
    conf = settings.detection_conf if conf is None else conf
    camera_id = camera_id or settings.default_camera_id
    speed_factor = speed_factor if speed_factor else 1.0

    t0 = time.perf_counter()
    info, frame_iter = sample_frames(video, fps=fps, settings=settings)
    frames = list(frame_iter)
    tracks = track_clip(
        frames, frame_w=info.width, frame_h=info.height,
        weights=weights, conf=conf, settings=settings, device=device,
        speed_factor=speed_factor,
    )
    zone = load_zone(camera_id, config_dir=settings.config_dir)
    duration_real = info.duration_s / speed_factor
    features = extract_features(
        tracks, zone, frame_w=info.width, frame_h=info.height,
        duration_s=duration_real, close_area_frac=settings.close_area_frac,
    )
    scores = compute_scores(features)
    elapsed = time.perf_counter() - t0
    return {
        "info": info, "frames": frames, "tracks": tracks, "features": features,
        "scores": scores, "device": device, "weights": weights, "conf": conf,
        "speed_factor": speed_factor, "duration_real": duration_real,
        "elapsed": elapsed,
    }


def _clip_stem(video: str) -> str:
    return Path(video).stem


def cmd_track(args: argparse.Namespace) -> int:
    settings = load_settings()
    device = select_device()
    weights = args.weights or settings.yolo_weights
    conf = settings.detection_conf if args.conf is None else args.conf

    t0 = time.perf_counter()
    info, frame_iter = sample_frames(args.video, fps=args.fps, settings=settings)
    frames = list(frame_iter)
    tracks = track_clip(
        frames,
        frame_w=info.width,
        frame_h=info.height,
        weights=weights,
        conf=conf,
        settings=settings,
        device=device,
    )
    elapsed = time.perf_counter() - t0

    rate = detection_rate(tracks)

    out_dir = Path(args.out_dir) if args.out_dir else (PIPELINE_ROOT / "data" / "out")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{_clip_stem(args.video)}_tracks.json"

    payload = {
        "dog_id": args.dog_id,
        "day": args.day,
        "video": args.video,
        "weights": weights,
        "conf": conf,
        "device": device,
        "clip": {
            "width": info.width,
            "height": info.height,
            "src_fps": info.src_fps,
            "duration_s": round(info.duration_s, 3),
            "sampled_frames": len(frames),
            "sample_fps": args.fps if args.fps is not None else settings.sample_fps,
        },
        "detection_rate": round(rate, 4),
        "processing_s": round(elapsed, 3),
        "tracks": [asdict(t) for t in tracks],
    }
    out_path.write_text(json.dumps(payload, indent=2))

    print(f"device:           {device}")
    print(f"weights:          {weights} (conf={conf})")
    print(f"clip:             {info.width}x{info.height}, {info.duration_s:.1f}s")
    print(f"sampled frames:   {len(frames)}")
    print(f"detection rate:   {rate * 100:.1f}%")
    print(f"processing time:  {elapsed:.2f}s")
    print(f"saved tracks ->   {out_path}")
    return 0


def cmd_analyze(args: argparse.Namespace) -> int:
    settings = load_settings()
    device = select_device()
    weights = args.weights or settings.yolo_weights
    conf = settings.detection_conf if args.conf is None else args.conf
    camera_id = args.camera_id or settings.default_camera_id
    speed_factor = args.speed_factor if args.speed_factor is not None else 1.0

    t0 = time.perf_counter()
    info, frame_iter = sample_frames(args.video, fps=args.fps, settings=settings)
    frames = list(frame_iter)
    tracks = track_clip(
        frames,
        frame_w=info.width,
        frame_h=info.height,
        weights=weights,
        conf=conf,
        settings=settings,
        device=device,
        speed_factor=speed_factor,
    )
    zone = load_zone(camera_id, config_dir=settings.config_dir)
    duration_real = info.duration_s / speed_factor
    features = extract_features(
        tracks,
        zone,
        frame_w=info.width,
        frame_h=info.height,
        duration_s=duration_real,
        close_area_frac=settings.close_area_frac,
    )
    scores = compute_scores(features)
    elapsed = time.perf_counter() - t0

    rate = detection_rate(tracks)
    coverage = detection_rate(tracks, include_interpolated=True)
    blur_rate = blurry_rate(tracks)
    shake = camera_shake(tracks, duration_real)

    # Contract summary with placeholders for stages not yet built.
    summary = build_summary(
        dog_id=args.dog_id,
        day=args.day,
        scores=scores,
        handling_level=assign_level(scores, config_dir=settings.config_dir),
        trend="stable",  # trend comes from Tiger/history in run-all
        needs=derive_needs(scores, features, config_dir=settings.config_dir),
    )

    out_dir = Path(args.out_dir) if args.out_dir else (PIPELINE_ROOT / "data" / "out")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{args.dog_id}_day{args.day}.json"
    out_path.write_text(json.dumps(summary, indent=2))

    annotated_path = None
    if args.annotate:
        stem = _clip_stem(args.video)
        annotated_path = annotate_clip(
            args.video, tracks, scores,
            handling_level=summary["handling_level"],
            out_path=str(out_dir / f"{stem}_annotated.mp4"),
            fps=args.fps, speed_factor=speed_factor, settings=settings,
        )

    print(f"device:           {device}")
    print(f"weights:          {weights} (conf={conf}, speed_factor={speed_factor})")
    print(f"clip:             {info.width}x{info.height} (src {info.src_width}x{info.src_height}), {info.duration_s:.1f}s")
    print(f"sampled frames:   {len(frames)}")
    print(f"detection rate:   {rate * 100:.1f}%  (coverage incl. interp: {coverage * 100:.1f}%)")
    print(f"blurry skipped:   {blur_rate * 100:.1f}%")
    print(f"camera shake:     {shake:.4f} frac/s  (compensation={'on' if settings.camera_compensation else 'off'})")
    print(f"processing time:  {elapsed:.2f}s")
    print("--- features ---")
    print(f"speed (bl/s):        {features.mean_speed:.3f}")
    print(f"vertical_motion:     {features.vertical_motion:.3f}")
    print(f"pct_time_moving:     {features.pct_time_moving:.1f}%")
    print(f"reversals_per_min:   {features.reversals_per_min:.2f}")
    print(f"circling (turns/min):{features.circling:.2f}")
    print(f"jumps_per_min:       {features.jumps_per_min:.2f}")
    print(f"pct_close_camera:    {features.pct_close_camera:.1f}%")
    print(f"pct_centered:        {features.pct_centered:.1f}%")
    print(f"hw_ratio_mean:       {features.hw_ratio_mean:.3f}")
    print(f"sudden_accel_front:  {features.sudden_accel_front}")
    print("--- scores ---")
    print(f"energy:          {scores.energy}")
    print(f"stress:          {scores.stress}")
    print(f"approachability: {scores.approachability}")
    print(f"confidence:      {scores.confidence}")
    print(f"arousal_spikes:  {scores.arousal_spikes}")
    print(f"handling_level:  {summary['handling_level']}")
    print(f"needs:           {summary['needs']}")
    print(f"saved summary -> {out_path}")
    if annotated_path:
        print(f"saved annotated -> {annotated_path}")
    return 0


def cmd_run_all(args: argparse.Namespace) -> int:
    settings = load_settings()
    demo_path = Path(args.config) if args.config else (PIPELINE_ROOT / "data" / "demo_dogs.json")
    cfg = json.loads(demo_path.read_text())
    clips = cfg.get("clips", [])

    # Tiger layer is built in parallel; import lazily and degrade if TIGER_DSN unset
    # or the module is not present yet.
    tiger_enabled = bool(settings.tiger_dsn)
    tiger = None
    if tiger_enabled:
        try:
            from . import store_tiger as tiger  # type: ignore
        except Exception as e:  # module not ready yet
            print(f"[tiger] store_tiger unavailable ({type(e).__name__}); skipping Tiger writes")
            tiger_enabled = False

    results = []
    for clip in clips:
        if clip.get("excluded"):
            continue
        dog_id = clip["dog_id"]
        day = int(clip.get("day", 1))
        hour = int(clip.get("hour", 0))
        video = clip["video"]
        if not Path(video).is_absolute():
            video = str(PIPELINE_ROOT / video)
        speed_factor = float(clip.get("speed_factor", 1.0))
        camera_id = clip.get("camera_id")

        print(f"\n=== {dog_id} (day {day}, hour {hour}) ===")
        try:
            r = analyze_one(video, dog_id, day, camera_id=camera_id,
                            speed_factor=speed_factor, settings=settings)
        except Exception as e:
            print(f"  analyze failed: {type(e).__name__}: {e}")
            results.append((dog_id, "ERROR", [], False))
            continue

        scores = r["scores"]
        features = r["features"]
        level = assign_level(scores, config_dir=settings.config_dir)
        needs = derive_needs(scores, features, config_dir=settings.config_dir)

        # Trend from Tiger if available, else stable.
        trend = "stable"
        if tiger_enabled and tiger is not None:
            try:
                tiger.write_readings(dog_id=dog_id, day=day, hour=hour, scores=scores)
                tiger.refresh_daily()
                trend = tiger.compute_trend(dog_id) or "stable"
            except Exception as e:
                print(f"  [tiger] write/trend failed: {type(e).__name__}: {e}")

        summary = build_summary(
            dog_id=dog_id, day=day, scores=scores,
            handling_level=level, trend=trend, needs=needs,
        )

        # Write local summary always.
        out_dir = PIPELINE_ROOT / "data" / "out"
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{dog_id}_day{day}.json").write_text(json.dumps(summary, indent=2))

        # Write to Mongo if configured.
        wrote_mongo = False
        if settings.mongo_uri:
            try:
                from . import store_mongo
                store_mongo.upsert_summary(summary, settings=settings)
                wrote_mongo = True
            except Exception as e:
                print(f"  [mongo] write failed: {type(e).__name__}: {e}")
        else:
            print("  [mongo] MONGO_URI not set; skipping Mongo write")

        print(f"  level={level}  needs={needs}  mongo={'yes' if wrote_mongo else 'no'}")
        results.append((dog_id, level, needs, wrote_mongo))

    # Summary table.
    print("\n===== run-all summary =====")
    print(f"{'dog_id':12} {'level':8} {'mongo':6} needs")
    for dog_id, level, needs, wrote in results:
        print(f"{dog_id:12} {level:8} {('yes' if wrote else 'no'):6} {'; '.join(needs)}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="behavior.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    p_track = sub.add_parser("track", help="ingest + track one clip")
    p_track.add_argument("--video", required=True, help="local path or s3://bucket/key")
    p_track.add_argument("--dog-id", required=True, dest="dog_id")
    p_track.add_argument("--day", type=int, default=1)
    p_track.add_argument("--fps", type=float, default=None, help="sample fps (default from settings)")
    p_track.add_argument("--weights", default=None, help="YOLO weights (default from settings)")
    p_track.add_argument("--conf", type=float, default=None, help="detection confidence threshold")
    p_track.add_argument("--out-dir", default=None, help="output dir (default data/out)")
    p_track.set_defaults(func=cmd_track)

    p_an = sub.add_parser("analyze", help="ingest + track + features + scores on one clip")
    p_an.add_argument("--video", required=True, help="local path or s3://bucket/key")
    p_an.add_argument("--dog-id", required=True, dest="dog_id")
    p_an.add_argument("--day", type=int, default=1)
    p_an.add_argument("--fps", type=float, default=None)
    p_an.add_argument("--weights", default=None)
    p_an.add_argument("--conf", type=float, default=None)
    p_an.add_argument("--camera-id", default=None, dest="camera_id")
    p_an.add_argument("--speed-factor", type=float, default=None, dest="speed_factor",
                      help="divide timestamps to correct slow-motion clips (default 1.0)")
    p_an.add_argument("--annotate", action="store_true", help="also write an annotated MP4")
    p_an.add_argument("--out-dir", default=None)
    p_an.set_defaults(func=cmd_analyze)

    p_ra = sub.add_parser("run-all", help="analyze every clip in demo_dogs.json; write stores")
    p_ra.add_argument("--config", default=None, help="path to demo_dogs.json (default data/demo_dogs.json)")
    p_ra.set_defaults(func=cmd_run_all)

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
