"""Single full-write path for a dog's analysis results.

Shared by run-all, re-extract backfill, /analyze, and the /analyze-s3 job so every
entry point produces the same complete doc: contract summary, events, welfare,
evidence, fit_notes, not_suited_for, handler, passport_public, and media URLs (with
stored S3 keys). Tiger write is optional/graceful. S3 upload is optional and can be
deferred by the caller (the job does it in a later stage).

Nothing here edits Claude Code's modules; store_tiger is imported read-only.
"""

from __future__ import annotations

import logging
from typing import Callable, Optional

from . import store_mongo
from .evidence import compute_evidence, compute_fit_notes, compute_not_suited_for
from .handler import compute_handler
from .levels import assign_level
from .needs import derive_needs
from .passport import build_passport
from .schemas import Scores, build_summary
from .scores import compute_scores
from .settings import Settings
from .welfare import compute_welfare

log = logging.getLogger("behavior.persist")


def write_tiger(dog_id, segments, hour, settings, log_fn=log.warning):
    """Write one or more (day, scores) segments to Tiger; return (trend, rows).

    segments: list of (day:int, scores:Scores). Returns (trend, trend_rows) or
    ("stable", None) when Tiger is unavailable.
    """
    if not settings.tiger_dsn:
        return "stable", None
    try:
        from . import store_tiger
        for day, sc in segments:
            store_tiger.write_readings(dog_id=dog_id, day=day, hour=hour, scores=sc)
        store_tiger.refresh_daily()
        trend = store_tiger.compute_trend(dog_id) or "stable"
        rows = store_tiger.get_trend(dog_id)
        return trend, rows
    except Exception:
        log.exception("Tiger write failed for %s", dog_id)
        return "stable", None


def build_doc_fields(dog_id, day, scores: Scores, features, events, *,
                     trend, trend_rows, name, settings: Settings,
                     photo=None, video_url=None, photo_key=None, video_key=None,
                     media_status=None):
    """Compute every derived field and the summary; return a kwargs dict for upsert."""
    level = assign_level(scores, config_dir=settings.config_dir)
    needs = derive_needs(scores, features, config_dir=settings.config_dir)
    welfare = compute_welfare(trend_rows)
    evidence = compute_evidence(trend_rows, events, scores, trend=trend)
    fit_notes = compute_fit_notes(evidence, events)
    not_suited = compute_not_suited_for(evidence, scores, config_dir=settings.config_dir)
    handler = compute_handler(level, events, scores, config_dir=settings.config_dir)

    summary = build_summary(dog_id=dog_id, day=day, scores=scores,
                            handling_level=level, trend=trend, needs=needs)

    # Passport is built from a merged view of what we're about to store.
    merged = {
        **summary, "name": name, "photo": photo, "video_url": video_url,
        "events": events, "evidence": evidence, "fit_notes": fit_notes,
        "not_suited_for": not_suited, "expert_reviewed": False,
    }
    passport = build_passport(merged)

    return {
        "summary": summary, "level": level, "needs": needs, "welfare": welfare,
        "evidence": evidence, "fit_notes": fit_notes, "not_suited_for": not_suited,
        "handler": handler, "passport": passport,
        "upsert_kwargs": dict(
            name=name, events=events, welfare=welfare,
            photo=photo, video_url=video_url, photo_key=photo_key, video_key=video_key,
            evidence=evidence, fit_notes=fit_notes, not_suited_for=not_suited,
            handler=handler, passport_public=passport, settings=settings,
        ),
    }


def persist_summary(dog_id, fields):
    """Upsert the dog doc from a build_doc_fields() result."""
    return store_mongo.upsert_summary(fields["summary"], **fields["upsert_kwargs"])
