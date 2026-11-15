"""FastAPI service for the Unleashed behavior pipeline.

Exposes the pipeline to the teammate's frontend: dog summaries, profiles, trends,
on-demand analysis of an uploaded clip, annotated-video playback, staff notes, vet
review, bias reports, and generated reports.

Tiger (``store_tiger``), ``bias_test``, and ``report`` are owned by Claude Code and
imported read-only; this module never edits them. Optional Cognito JWT verification
sits behind ``REQUIRE_AUTH`` (off by default for the hackathon).

Run:
    uvicorn behavior.api:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import json
import logging
import shutil
import time
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, Depends, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import store_mongo
from .guardrails import GuardrailViolation, sanitize
from .levels import assign_level
from .needs import derive_needs
from .schemas import build_summary
from .scores import compute_scores  # noqa: F401 (kept for parity/testing)
from .settings import PIPELINE_ROOT, load_settings

log = logging.getLogger("behavior.api")

# The five real demo dogs. /dogs returns only these unless ?all=true.
REAL_DOG_IDS = ["june-01", "katie-01", "kacy-01", "kinder-01", "luna-01"]

OUT_DIR = PIPELINE_ROOT / "data" / "out"
UPLOAD_DIR = PIPELINE_ROOT / "data" / "raw" / "uploads"
BIAS_DIR = OUT_DIR / "bias"

from contextlib import asynccontextmanager
import os


@asynccontextmanager
async def _lifespan(_app):
    # Preload the YOLO model once so the first job isn't slowed by model load.
    # Skipped when PIPELINE_SKIP_WARMUP is set (e.g. during tests).
    if not os.getenv("PIPELINE_SKIP_WARMUP"):
        try:
            from .track import warmup_model
            warmup_model(load_settings().yolo_weights)
            log.info("YOLO model warmed up")
        except Exception:
            log.exception("model warmup failed (will load lazily)")
    yield


app = FastAPI(title="Bone-a-find behavior pipeline", version="0.1.0", lifespan=_lifespan)

# Allowed browser origins for the live app + local dev. Extra origins may be added
# via CORS_ORIGINS (comma-separated) without a code change.
_DEFAULT_CORS_ORIGINS = [
    "https://bone-a-find.us",
    "https://www.bone-a-find.us",
    "https://api.bone-a-find.us",
    "https://main.d3dc3rmi031o40.amplifyapp.com",
    "http://localhost:3000",
]
_extra = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
CORS_ORIGINS = _DEFAULT_CORS_ORIGINS + _extra

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


# --- optional Cognito auth -----------------------------------------------------

def _verify_cognito(token: str, settings) -> bool:
    """Verify a Cognito access/ID token against the pool's JWKS."""
    import jwt
    from jwt import PyJWKClient

    region = settings.cognito_region
    pool = settings.cognito_user_pool_id
    issuer = f"https://cognito-idp.{region}.amazonaws.com/{pool}"
    jwks = PyJWKClient(f"{issuer}/.well-known/jwks.json")
    signing_key = jwks.get_signing_key_from_jwt(token).key
    jwt.decode(
        token, signing_key, algorithms=["RS256"], issuer=issuer,
        audience=settings.cognito_app_client_id,
        options={"verify_aud": bool(settings.cognito_app_client_id)},
    )
    return True


async def auth_dependency(request: Request) -> None:
    """Require a valid Cognito JWT when REQUIRE_AUTH is on; otherwise a no-op."""
    settings = load_settings()
    if not settings.require_auth:
        return
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = header.split(" ", 1)[1].strip()
    try:
        _verify_cognito(token, settings)
    except Exception:
        raise HTTPException(status_code=401, detail="invalid token")


# --- health --------------------------------------------------------------------

@app.exception_handler(GuardrailViolation)
async def _guardrail_handler(_request: Request, exc: GuardrailViolation):
    # Never echo the offending text back; report a generic rejection.
    return JSONResponse(status_code=400, content={"detail": "text rejected by content guardrail"})


@app.get("/health")
def health() -> dict:
    settings = load_settings()
    mongo_ok = False
    tiger_ok = False
    if settings.mongo_uri:
        try:
            store_mongo.get_client(settings).admin.command("ping")
            mongo_ok = True
        except Exception:
            mongo_ok = False
    if settings.tiger_dsn:
        try:
            from . import store_tiger
            # A light touch: get_trend on a real dog should not raise if reachable.
            store_tiger.get_trend(REAL_DOG_IDS[0])
            tiger_ok = True
        except Exception:
            tiger_ok = False
    return {"ok": True, "mongo": mongo_ok, "tiger": tiger_ok}


# --- dogs ----------------------------------------------------------------------

@app.get("/dogs", dependencies=[Depends(auth_dependency)])
def list_dogs(all: bool = False) -> list:
    settings = load_settings()
    try:
        ids = None if all else REAL_DOG_IDS
        return store_mongo.list_dogs(ids, settings=settings)
    except store_mongo.MongoNotConfigured:
        raise HTTPException(status_code=502, detail="Mongo not configured")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Mongo error: {type(e).__name__}")


@app.get("/dogs/{dog_id}/profile", dependencies=[Depends(auth_dependency)])
def dog_profile(dog_id: str) -> dict:
    settings = load_settings()
    doc = store_mongo.get_profile(dog_id, settings=settings)
    if not doc:
        raise HTTPException(status_code=404, detail=f"dog {dog_id} not found")
    # staff_notes / vet_review are included by get_profile if present.
    # Surface level_status for the frontend: "reviewed" once a vet confirms,
    # "provisional" until then. Does not mutate the stored contract fields.
    reviewed = (doc.get("vet_review") or {}).get("status") == "reviewed"
    doc["level_status"] = "reviewed" if reviewed else "provisional"
    return doc


# --- live S3 upload jobs -------------------------------------------------------

@app.post("/analyze-s3", dependencies=[Depends(auth_dependency)])
async def analyze_s3(payload: dict) -> dict:
    import threading
    from . import jobs

    settings = load_settings()
    s3_key = str(payload.get("s3_key", "")).strip()
    dog_id = str(payload.get("dog_id", "")).strip()
    if not s3_key or not dog_id:
        raise HTTPException(status_code=400, detail="s3_key and dog_id are required")
    if not store_mongo.is_owned(dog_id):
        raise HTTPException(
            status_code=400,
            detail="dog_id must start with 'upload-' or be one of the 5 owned dogs")
    name = payload.get("name")
    day = int(payload.get("day", 1))
    hour = int(payload.get("hour", 0))

    job_id = jobs.create_job(dog_id, s3_key, settings=settings)
    # Run in a daemon thread (not a BackgroundTask) so the heavy, synchronous YOLO
    # work does not block the worker from serving /jobs polls. Returns immediately.
    threading.Thread(
        target=jobs.run_job, args=(job_id, dog_id, s3_key, name, day, hour),
        daemon=True,
    ).start()
    return {"job_id": job_id}


@app.get("/jobs/{job_id}", dependencies=[Depends(auth_dependency)])
def get_job(job_id: str) -> dict:
    from . import jobs
    doc = jobs.get_job(job_id, settings=load_settings())
    if not doc:
        raise HTTPException(status_code=404, detail=f"job {job_id} not found")
    return doc


@app.get("/dogs/{dog_id}/evidence", dependencies=[Depends(auth_dependency)])
def dog_evidence(dog_id: str) -> dict:
    doc = store_mongo.get_profile(dog_id, settings=load_settings())
    if not doc:
        raise HTTPException(status_code=404, detail=f"dog {dog_id} not found")
    return {
        "dog_id": dog_id,
        "evidence": doc.get("evidence", {}),
        "fit_notes": doc.get("fit_notes", []),
        "not_suited_for": doc.get("not_suited_for", []),
        "handler": doc.get("handler", {}),
    }


@app.get("/passport/{dog_id}", dependencies=[Depends(auth_dependency)])
def dog_passport(dog_id: str) -> dict:
    from .passport import build_passport
    doc = store_mongo.get_profile(dog_id, settings=load_settings())
    if not doc:
        raise HTTPException(status_code=404, detail=f"dog {dog_id} not found")
    # Prefer the stored public copy; rebuild from the doc if absent.
    return doc.get("passport_public") or build_passport(doc)


@app.get("/dogs/{dog_id}/events", dependencies=[Depends(auth_dependency)])
def dog_events(dog_id: str) -> dict:
    settings = load_settings()
    doc = store_mongo.get_profile(dog_id, settings=settings)
    if not doc:
        raise HTTPException(status_code=404, detail=f"dog {dog_id} not found")
    return {"dog_id": dog_id, "events": doc.get("events", [])}


@app.get("/dogs/{dog_id}/trend", dependencies=[Depends(auth_dependency)])
def dog_trend(dog_id: str) -> dict:
    settings = load_settings()
    if not settings.tiger_dsn:
        raise HTTPException(status_code=502, detail="Tiger not configured")
    try:
        from . import store_tiger
        rows = store_tiger.get_trend(dog_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Tiger error: {type(e).__name__}")
    return {"dog_id": dog_id, "rows": rows}


# --- analyze (upload) ----------------------------------------------------------

def _upload_media_bg(dog_id: str, day: int, thumb_path: Optional[str],
                     annotated_path: Optional[str]):
    """Background: upload thumbnail + video to S3, presign, and mark the doc complete.

    Runs after the response is sent. Updates the doc's photo/video_url and sets
    media_status='complete'. Owned dogs only (enforced by store_mongo helpers).
    """
    settings = load_settings()
    from . import s3store
    photo = video = None
    try:
        if s3store.available(settings):
            if thumb_path:
                photo = s3store.upload_and_presign(
                    thumb_path, s3store.thumbnail_key(dog_id),
                    content_type="image/jpeg", settings=settings)
            if annotated_path:
                video = s3store.upload_and_presign(
                    annotated_path, s3store.video_key(dog_id, day),
                    content_type="video/mp4", settings=settings)
        else:
            log.warning("S3 unavailable; skipping media upload for %s", dog_id)
    except Exception:
        log.exception("S3 upload failed for %s", dog_id)
    try:
        col = store_mongo.get_collection(settings)
        set_fields = {"media_status": "complete", "updated_at": store_mongo._now_iso(),
                      "photo_key": s3store.thumbnail_key(dog_id),
                      "video_key": s3store.video_key(dog_id, day)}
        if photo:
            set_fields["photo"] = photo
        if video:
            set_fields["video_url"] = video
        col.update_one({"dog_id": dog_id}, {"$set": set_fields})
    except Exception:
        log.exception("Mongo media-status update failed for %s", dog_id)


@app.post("/analyze", dependencies=[Depends(auth_dependency)])
async def analyze(
    background: BackgroundTasks,
    video: UploadFile,
    dog_id: str = Form(...),
    day: int = Form(...),
    hour: int = Form(...),
    speed_factor: float = Form(1.0),
    name: str = Form(None),
) -> dict:
    from .cli import analyze_one  # local import to avoid a heavy import at startup
    from .events import extract_events

    settings = load_settings()
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_name = Path(video.filename or f"{dog_id}.mp4").name
    dest = UPLOAD_DIR / f"{dog_id}_day{day}_{int(time.time())}_{safe_name}"
    with dest.open("wb") as f:
        shutil.copyfileobj(video.file, f)

    try:
        r = analyze_one(str(dest), dog_id, day, speed_factor=speed_factor, settings=settings)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"analysis failed: {type(e).__name__}: {e}")

    scores = r["scores"]
    features = r["features"]
    level = assign_level(scores, config_dir=settings.config_dir)
    needs = derive_needs(scores, features, config_dir=settings.config_dir)
    events = extract_events(r["tracks"])
    display = (name or "").strip() or store_mongo.display_name(dog_id)

    stored = {"mongo": False, "tiger": False, "s3": "pending"}

    # Tiger write + trend + welfare.
    trend = "stable"
    welfare = None
    trend_rows = None
    if settings.tiger_dsn:
        try:
            from . import persist
            trend, trend_rows = persist.write_tiger(dog_id, [(day, scores)], hour, settings)
            stored["tiger"] = True
        except Exception:
            log.exception("Tiger write failed for %s", dog_id)

    # Build the full set of derived fields via the shared persist path, so the legacy
    # /analyze writes the same doc shape as /analyze-s3 (evidence, fit_notes,
    # not_suited_for, handler, passport_public, pose default).
    from . import persist
    fields = persist.build_doc_fields(
        dog_id, day, scores, features, events,
        trend=trend, trend_rows=trend_rows, name=display, settings=settings)
    summary = fields["summary"]
    welfare = fields["welfare"]

    # Annotated video (local file for immediate playback via /videos).
    annotated_url = None
    annotated_path = None
    try:
        from .annotate import annotate_clip
        out_name = f"{dest.stem}_annotated.mp4"
        annotated_path = str(OUT_DIR / out_name)
        annotate_clip(
            str(dest), r["tracks"], scores, handling_level=level,
            out_path=annotated_path, speed_factor=speed_factor, settings=settings,
        )
        annotated_url = f"/videos/{out_name}"
    except Exception:
        log.exception("Annotation failed for %s", dog_id)
        annotated_path = None

    # Thumbnail (local; uploaded to S3 in the background).
    thumb_path = None
    try:
        from .thumbnail import save_thumbnail
        thumb_path = save_thumbnail(r["frames"], r["tracks"], str(OUT_DIR / f"{dog_id}.jpg"))
    except Exception:
        log.exception("Thumbnail failed for %s", dog_id)

    # Persist to Mongo now (fast path); S3 media follows in the background.
    if settings.mongo_uri:
        try:
            persist.persist_summary(dog_id, fields)
            store_mongo.get_collection(settings).update_one(
                {"dog_id": dog_id}, {"$set": {"media_status": "pending"}})
            stored["mongo"] = True
        except Exception:
            log.exception("Mongo write failed for %s", dog_id)

    # Schedule S3 upload AFTER responding, then mark the doc complete.
    if stored["mongo"]:
        background.add_task(_upload_media_bg, dog_id, day, thumb_path, annotated_path)
    else:
        stored["s3"] = "skipped"

    # Response stays backward compatible: original keys plus the new derived fields.
    return {"summary": summary, "name": display, "events": events,
            "welfare": welfare, "annotated_url": annotated_url, "stored": stored,
            "evidence": fields["evidence"], "fit_notes": fields["fit_notes"],
            "not_suited_for": fields["not_suited_for"], "handler": fields["handler"]}


# --- video playback ------------------------------------------------------------

@app.get("/videos/{name}")
def serve_video(name: str) -> FileResponse:
    safe = Path(name).name  # prevent path traversal
    path = OUT_DIR / safe
    if not path.exists() or path.suffix.lower() != ".mp4":
        raise HTTPException(status_code=404, detail="video not found")
    return FileResponse(str(path), media_type="video/mp4", filename=safe)


# --- staff notes / vet review --------------------------------------------------

@app.post("/dogs/{dog_id}/staff-notes", dependencies=[Depends(auth_dependency)])
async def staff_notes(dog_id: str, payload: dict) -> dict:
    author = sanitize(str(payload.get("author", "")).strip())
    note = sanitize(str(payload.get("note", "")).strip())
    if not author or not note:
        raise HTTPException(status_code=400, detail="author and note are required")
    settings = load_settings()
    doc = store_mongo.add_staff_note(dog_id, author, note, settings=settings)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"dog {dog_id} not found")
    return {"ok": True, "staff_notes": doc.get("staff_notes", [])}


@app.post("/dogs/{dog_id}/vet-review", dependencies=[Depends(auth_dependency)])
async def vet_review(dog_id: str, payload: dict) -> dict:
    vet_name = sanitize(str(payload.get("vet_name", "")).strip())
    confirmed_level = sanitize(str(payload.get("confirmed_level", "")).strip())
    comment = sanitize(str(payload.get("comment", "")).strip())
    if not vet_name or not confirmed_level:
        raise HTTPException(status_code=400, detail="vet_name and confirmed_level are required")
    settings = load_settings()
    doc = store_mongo.set_vet_review(dog_id, vet_name, confirmed_level, comment, settings=settings)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"dog {dog_id} not found")
    return {"ok": True, "vet_review": doc.get("vet_review", {})}


# --- bias ----------------------------------------------------------------------

@app.get("/bias/{dog_id}", dependencies=[Depends(auth_dependency)])
def bias(dog_id: str) -> dict:
    path = BIAS_DIR / f"{Path(dog_id).name}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="bias report not available yet")
    return json.loads(path.read_text())


# --- report --------------------------------------------------------------------

@app.get("/dogs/{dog_id}/report", dependencies=[Depends(auth_dependency)])
def report(dog_id: str):
    try:
        from . import report as report_mod
    except Exception:
        raise HTTPException(status_code=404, detail="report not available yet")
    try:
        result = report_mod.generate_report(dog_id)  # cached; no force refresh
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"report not available yet: {type(e).__name__}")
    return JSONResponse(result)
