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
import shutil
import time
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import store_mongo
from .guardrails import GuardrailViolation, sanitize
from .levels import assign_level
from .needs import derive_needs
from .schemas import build_summary
from .scores import compute_scores  # noqa: F401 (kept for parity/testing)
from .settings import PIPELINE_ROOT, load_settings

# The five real demo dogs. /dogs returns only these unless ?all=true.
REAL_DOG_IDS = ["june-01", "katie-01", "kacy-01", "kinder-01", "luna-01"]

OUT_DIR = PIPELINE_ROOT / "data" / "out"
UPLOAD_DIR = PIPELINE_ROOT / "data" / "raw" / "uploads"
BIAS_DIR = OUT_DIR / "bias"

app = FastAPI(title="Unleashed behavior pipeline", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
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

@app.post("/analyze", dependencies=[Depends(auth_dependency)])
async def analyze(
    video: UploadFile,
    dog_id: str = Form(...),
    day: int = Form(...),
    hour: int = Form(...),
    speed_factor: float = Form(1.0),
) -> dict:
    from .cli import analyze_one  # local import to avoid a heavy import at startup

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

    # Tiger write + trend if configured.
    trend = "stable"
    if settings.tiger_dsn:
        try:
            from . import store_tiger
            store_tiger.write_readings(dog_id=dog_id, day=day, hour=hour, scores=scores)
            store_tiger.refresh_daily()
            trend = store_tiger.compute_trend(dog_id) or "stable"
        except Exception:
            trend = "stable"

    summary = build_summary(
        dog_id=dog_id, day=day, scores=scores,
        handling_level=level, trend=trend, needs=needs,
    )

    # Annotated video.
    annotated_url = None
    try:
        from .annotate import annotate_clip
        stem = dest.stem
        out_name = f"{stem}_annotated.mp4"
        annotate_clip(
            str(dest), r["tracks"], scores, handling_level=level,
            out_path=str(OUT_DIR / out_name),
            speed_factor=speed_factor, settings=settings,
        )
        annotated_url = f"/videos/{out_name}"
    except Exception:
        annotated_url = None

    # Persist to Mongo.
    if settings.mongo_uri:
        try:
            store_mongo.upsert_summary(summary, settings=settings)
        except Exception:
            pass

    return {"summary": summary, "annotated_url": annotated_url}


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
