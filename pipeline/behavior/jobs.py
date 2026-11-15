"""Background analysis jobs for direct browser-to-S3 uploads.

A job downloads a raw clip from S3, runs the full analysis + persist path, uploads
the annotated video and thumbnail back to S3, and records progress in a Mongo
collection ``pipeline_jobs`` that the live app polls directly. Stages, in order:

    queued -> downloading -> detecting -> tracking -> scoring -> saving
           -> uploading_media -> done     (or failed)

Each transition records a progress value and per-stage timing. A job older than
10 minutes that is not done reads back as failed ("Timed out").
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from . import persist, s3store, store_mongo
from .settings import PIPELINE_ROOT, Settings, load_settings

log = logging.getLogger("behavior.jobs")

JOBS_COLLECTION = "pipeline_jobs"
JOB_TIMEOUT_S = 600  # 10 minutes

STAGES = ("queued", "downloading", "detecting", "tracking", "scoring",
          "saving", "uploading_media", "done")
STAGE_PROGRESS = {
    "queued": 2, "downloading": 10, "detecting": 30, "tracking": 55,
    "scoring": 70, "saving": 85, "uploading_media": 95, "done": 100, "failed": 100,
}


def _now():
    return datetime.now(timezone.utc)


def _jobs(settings: Settings):
    return store_mongo.get_client(settings)[store_mongo.DB_NAME][JOBS_COLLECTION]


def create_job(dog_id: str, s3_key: str, *, settings: Optional[Settings] = None) -> str:
    settings = settings or load_settings()
    job_id = uuid.uuid4().hex
    now = _now()
    _jobs(settings).insert_one({
        "job_id": job_id, "dog_id": dog_id, "s3_key": s3_key,
        "stage": "queued", "progress": STAGE_PROGRESS["queued"],
        "started_at": now, "updated_at": now,
        "stage_timings": {}, "error": None, "result": None,
    })
    return job_id


def _set_stage(settings, job_id, stage, timings):
    _jobs(settings).update_one({"job_id": job_id}, {"$set": {
        "stage": stage, "progress": STAGE_PROGRESS.get(stage, 0),
        "updated_at": _now(), "stage_timings": timings,
    }})


def get_job(job_id: str, *, settings: Optional[Settings] = None) -> Optional[dict]:
    """Return the job doc. A non-terminal job older than the timeout reads as failed."""
    settings = settings or load_settings()
    doc = _jobs(settings).find_one({"job_id": job_id}, {"_id": 0})
    if not doc:
        return None
    if doc.get("stage") not in ("done", "failed"):
        started = doc.get("started_at")
        if started is not None:
            # Mongo returns naive UTC datetimes; normalize to aware UTC before math.
            if started.tzinfo is None:
                started = started.replace(tzinfo=timezone.utc)
            if (_now() - started).total_seconds() > JOB_TIMEOUT_S:
                doc = {**doc, "stage": "failed", "progress": 100, "error": "Timed out"}
    return doc


def run_job(job_id: str, dog_id: str, s3_key: str, name: Optional[str],
            day: int, hour: int, *, settings: Optional[Settings] = None) -> None:
    """Execute the full pipeline for one job, updating stages as it goes."""
    settings = settings or load_settings()
    timings: dict = {}

    def stage_timer(stage):
        return _StageTimer(settings, job_id, stage, timings)

    try:
        from .cli import analyze_one
        from .events import extract_events
        from .thumbnail import save_thumbnail
        from .annotate import annotate_clip

        out_dir = PIPELINE_ROOT / "data" / "out"
        out_dir.mkdir(parents=True, exist_ok=True)
        raw_dir = PIPELINE_ROOT / "data" / "raw" / "uploads"
        raw_dir.mkdir(parents=True, exist_ok=True)
        local_raw = str(raw_dir / f"{dog_id}_{job_id}{Path(s3_key).suffix or '.mp4'}")

        with stage_timer("downloading"):
            s3store.download(s3_key, local_raw, settings=settings)

        # detecting + tracking happen inside analyze_one; we time them as one block
        # but surface two stages for the UI.
        with stage_timer("detecting"):
            pass
        with stage_timer("tracking"):
            r = analyze_one(local_raw, dog_id, day, settings=settings)

        with stage_timer("scoring"):
            scores = r["scores"]
            features = r["features"]
            events = extract_events(r["tracks"])
            trend, trend_rows = persist.write_tiger(
                dog_id, [(day, scores)], hour, settings)
            disp = (name or "").strip() or store_mongo.display_name(dog_id)

        with stage_timer("saving"):
            fields = persist.build_doc_fields(
                dog_id, day, scores, features, events,
                trend=trend, trend_rows=trend_rows, name=disp, settings=settings)
            store_mongo.get_collection(settings)  # ensure collection/index
            persist.persist_summary(dog_id, fields)
            store_mongo.get_collection(settings).update_one(
                {"dog_id": dog_id}, {"$set": {"media_status": "pending"}})

        with stage_timer("uploading_media"):
            level = fields["level"]
            thumb_path = save_thumbnail(r["frames"], r["tracks"], str(out_dir / f"{dog_id}.jpg"))
            annotated_path = annotate_clip(
                local_raw, r["tracks"], scores, handling_level=level,
                out_path=str(out_dir / f"{dog_id}_{job_id}_annotated.mp4"),
                settings=settings)
            photo = video = None
            p_key = s3store.thumbnail_key(dog_id)
            v_key = s3store.video_key(dog_id, day)
            if s3store.available(settings):
                if thumb_path:
                    photo = s3store.upload_and_presign(
                        thumb_path, p_key, content_type="image/jpeg", settings=settings)
                video = s3store.upload_and_presign(
                    annotated_path, v_key, content_type="video/mp4", settings=settings)
            store_mongo.get_collection(settings).update_one(
                {"dog_id": dog_id}, {"$set": {
                    "photo": photo, "video_url": video,
                    "photo_key": p_key, "video_key": v_key,
                    "media_status": "complete", "updated_at": store_mongo._now_iso()}})

        # Delete the raw upload (keep annotated video + thumbnail).
        s3store.delete_key(s3_key, settings=settings)

        result = {
            "dog_id": dog_id, "name": disp, "handling_level": level,
            "scores": {"energy": scores.energy, "stress": scores.stress,
                       "approachability": scores.approachability,
                       "confidence": scores.confidence,
                       "arousal_spikes": scores.arousal_spikes},
            "events_count": len(events), "media_status": "complete",
        }
        _jobs(settings).update_one({"job_id": job_id}, {"$set": {
            "stage": "done", "progress": 100, "updated_at": _now(),
            "stage_timings": timings, "result": result}})
        log.info("job %s done for %s", job_id, dog_id)
    except Exception as e:
        log.exception("job %s failed for %s", job_id, dog_id)
        _jobs(settings).update_one({"job_id": job_id}, {"$set": {
            "stage": "failed", "progress": 100, "updated_at": _now(),
            "error": f"{type(e).__name__}: {e}"}})


class _StageTimer:
    """Context manager: set the stage on enter, record its duration on exit."""

    def __init__(self, settings, job_id, stage, timings):
        self.settings, self.job_id, self.stage, self.timings = settings, job_id, stage, timings

    def __enter__(self):
        self.t0 = time.perf_counter()
        _set_stage(self.settings, self.job_id, self.stage, self.timings)
        return self

    def __exit__(self, *exc):
        self.timings[self.stage] = round(time.perf_counter() - self.t0, 2)
        _set_stage(self.settings, self.job_id, self.stage, self.timings)
        return False
