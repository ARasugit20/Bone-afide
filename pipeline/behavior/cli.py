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
        "elapsed": elapsed, "zone": zone,
    }


def segment_scores(r, n_segments, settings, camera_id=None):
    """Split one analyzed clip into N equal time windows and score each window.

    Uses the already-computed tracks (no re-analysis, no model reload). Returns a
    list of (scores, features) for day 1..N, from real per-window motion only.
    """
    tracks = r["tracks"]
    zone = r["zone"]
    info = r["info"]
    if not tracks:
        return []
    t0 = tracks[0].timestamp_s
    t1 = tracks[-1].timestamp_s
    span = (t1 - t0) or 1e-6
    width = span / n_segments

    out = []
    for seg in range(n_segments):
        lo = t0 + seg * width
        hi = t0 + (seg + 1) * width
        # include right edge on the last segment
        window = [t for t in tracks
                  if lo <= t.timestamp_s < hi or (seg == n_segments - 1 and t.timestamp_s <= hi)]
        feats = extract_features(
            window, zone, frame_w=info.width, frame_h=info.height,
            duration_s=max(width, 1e-6), close_area_frac=settings.close_area_frac,
        )
        out.append((compute_scores(feats), feats))
    return out


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

        # Segment count: per-clip override, else global --segments, else 1.
        n_seg = int(clip.get("segments", getattr(args, "segments", 1) or 1))
        clip_name = clip.get("name")

        print(f"\n=== {dog_id} (hour {hour}, segments={n_seg}) ===")
        try:
            r = analyze_one(video, dog_id, day, camera_id=camera_id,
                            speed_factor=speed_factor, settings=settings)
        except Exception as e:
            print(f"  analyze failed: {type(e).__name__}: {e}")
            results.append((dog_id, "ERROR", [], False))
            continue

        from .events import extract_events
        events = extract_events(r["tracks"])

        # Per-segment scores (day 1..N). N=1 means the whole clip as day `day`.
        if n_seg > 1:
            seg_list = segment_scores(r, n_seg, settings, camera_id=camera_id)
            seg_days = list(range(1, n_seg + 1))
        else:
            seg_list = [(r["scores"], r["features"])]
            seg_days = [day]

        # Write every segment to Tiger as its own day; keep the latest for Mongo.
        trend = "stable"
        for d, (sc, _ft) in zip(seg_days, seg_list):
            if tiger_enabled and tiger is not None:
                try:
                    tiger.write_readings(dog_id=dog_id, day=d, hour=hour, scores=sc)
                except Exception as e:
                    print(f"  [tiger] write day {d} failed: {type(e).__name__}: {e}")
        welfare = None
        if tiger_enabled and tiger is not None:
            try:
                tiger.refresh_daily()
                trend = tiger.compute_trend(dog_id) or "stable"
                from .welfare import compute_welfare
                welfare = compute_welfare(tiger.get_trend(dog_id))
            except Exception as e:
                print(f"  [tiger] refresh/trend failed: {type(e).__name__}: {e}")

        # Latest segment is the headline summary.
        last_day = seg_days[-1]
        scores, features = seg_list[-1]
        level = assign_level(scores, config_dir=settings.config_dir)
        needs = derive_needs(scores, features, config_dir=settings.config_dir)

        summary = build_summary(
            dog_id=dog_id, day=last_day, scores=scores,
            handling_level=level, trend=trend, needs=needs,
        )

        print(f"  per-segment scores: "
              + ", ".join(f"d{d}:E{s.energy}/St{s.stress}/Ap{s.approachability}"
                          for d, (s, _) in zip(seg_days, seg_list)))

        out_dir = PIPELINE_ROOT / "data" / "out"
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / f"{dog_id}_day{last_day}.json").write_text(json.dumps(summary, indent=2))

        # Thumbnail: clearest detected frame.
        from .thumbnail import save_thumbnail
        thumb_path = save_thumbnail(r["frames"], r["tracks"], str(out_dir / f"{dog_id}.jpg"))

        # Annotated MP4.
        from .annotate import annotate_clip
        annotated_path = annotate_clip(
            video, r["tracks"], scores, handling_level=level,
            out_path=str(out_dir / f"{Path(video).stem}_annotated.mp4"),
            speed_factor=speed_factor, settings=settings,
        )

        # S3 upload + presigned URLs (graceful if unavailable).
        from . import s3store
        photo_url = video_url = None
        if s3store.available(settings):
            if thumb_path:
                photo_url = s3store.upload_and_presign(
                    thumb_path, s3store.thumbnail_key(dog_id),
                    content_type="image/jpeg", settings=settings)
            video_url = s3store.upload_and_presign(
                annotated_path, s3store.video_key(dog_id, last_day),
                content_type="video/mp4", settings=settings)
        else:
            print("  [s3] no bucket/credentials; skipping media upload")

        # Write to Mongo if configured.
        wrote_mongo = False
        if settings.mongo_uri:
            try:
                from . import store_mongo
                store_mongo.upsert_summary(summary, photo=photo_url, video_url=video_url,
                                           name=clip_name, events=events, welfare=welfare,
                                           settings=settings)
                wrote_mongo = True
            except Exception as e:
                print(f"  [mongo] write failed: {type(e).__name__}: {e}")
        else:
            print("  [mongo] MONGO_URI not set; skipping Mongo write")

        print(f"  level={level}  needs={needs}  events={len(events)}"
              f"  mongo={'yes' if wrote_mongo else 'no'}"
              f"  photo={'yes' if photo_url else 'no'}  video={'yes' if video_url else 'no'}")
        results.append((dog_id, level, needs, wrote_mongo))

    # Summary table.
    print("\n===== run-all summary =====")
    print(f"{'dog_id':12} {'level':8} {'mongo':6} needs")
    for dog_id, level, needs, wrote in results:
        print(f"{dog_id:12} {level:8} {('yes' if wrote else 'no'):6} {'; '.join(needs)}")
    return 0


def cmd_reextract_events(args: argparse.Namespace) -> int:
    """Re-run tracking per clip, recompute events, and update ONLY the events field
    in Mongo for owned dogs. Does not touch scores, media, or history.
    """
    settings = load_settings()
    from . import store_mongo
    from .events import extract_events

    demo_path = Path(args.config) if args.config else (PIPELINE_ROOT / "data" / "demo_dogs.json")
    cfg = json.loads(demo_path.read_text())
    for clip in cfg.get("clips", []):
        if clip.get("excluded"):
            continue
        dog_id = clip["dog_id"]
        video = clip["video"]
        if not Path(video).is_absolute():
            video = str(PIPELINE_ROOT / video)
        try:
            r = analyze_one(video, dog_id, int(clip.get("day", 1)),
                            camera_id=clip.get("camera_id"),
                            speed_factor=float(clip.get("speed_factor", 1.0)),
                            settings=settings)
            events = extract_events(r["tracks"])
        except Exception as e:
            print(f"  {dog_id}: analyze failed: {type(e).__name__}: {e}")
            continue
        # Recompute welfare from current Tiger rows too (cheap, no re-write of scores).
        welfare = None
        if settings.tiger_dsn:
            try:
                from . import store_tiger
                from .welfare import compute_welfare
                welfare = compute_welfare(store_tiger.get_trend(dog_id))
            except Exception as e:
                print(f"  {dog_id}: [tiger] welfare failed: {type(e).__name__}: {e}")

        updated = False
        if settings.mongo_uri:
            col = store_mongo.get_collection(settings)
            if store_mongo.is_owned(dog_id):
                set_fields = {"events": events, "updated_at": store_mongo._now_iso()}
                if welfare is not None:
                    set_fields["welfare"] = welfare
                res = col.update_one({"dog_id": dog_id}, {"$set": set_fields})
                updated = res.matched_count > 0
        w = welfare["status"] if welfare else "n/a"
        print(f"  {dog_id}: {len(events)} events  welfare={w}  mongo_updated={updated}")
    return 0


def cmd_refresh_urls(args: argparse.Namespace) -> int:
    """Regenerate 7-day presigned URLs for each owned dog's thumbnail + video."""
    settings = load_settings()
    from . import s3store, store_mongo

    if not s3store.available(settings):
        print("[s3] no bucket/credentials; cannot refresh URLs")
        return 1
    if not settings.mongo_uri:
        print("[mongo] MONGO_URI not set; cannot update docs")
        return 1

    demo_path = Path(args.config) if args.config else (PIPELINE_ROOT / "data" / "demo_dogs.json")
    cfg = json.loads(demo_path.read_text())
    for clip in cfg.get("clips", []):
        if clip.get("excluded"):
            continue
        dog_id = clip["dog_id"]
        day = int(clip.get("day", 1))
        photo = s3store.presign_existing(s3store.thumbnail_key(dog_id), settings=settings)
        video = s3store.presign_existing(s3store.video_key(dog_id, day), settings=settings)
        store_mongo.set_media_urls(dog_id, photo=photo, video_url=video, settings=settings)
        print(f"  {dog_id}: photo={'yes' if photo else 'no'} video={'yes' if video else 'no'}")
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
    p_ra.add_argument("--segments", type=int, default=1,
                      help="split each clip into N equal time segments -> days 1..N "
                           "(per-clip 'segments' in demo_dogs.json overrides this)")
    p_ra.set_defaults(func=cmd_run_all)

    p_re = sub.add_parser("re-extract-events", help="recompute events only; update Mongo events field")
    p_re.add_argument("--config", default=None, help="path to demo_dogs.json (default data/demo_dogs.json)")
    p_re.set_defaults(func=cmd_reextract_events)

    p_ru = sub.add_parser("refresh-urls", help="regenerate 7-day presigned media URLs in Mongo")
    p_ru.add_argument("--config", default=None, help="path to demo_dogs.json (default data/demo_dogs.json)")
    p_ru.set_defaults(func=cmd_refresh_urls)

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
