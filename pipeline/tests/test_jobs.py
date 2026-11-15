"""Job lifecycle tests: stage progression, failed path, and timeout read-back."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from behavior import jobs, persist, store_mongo
from behavior.schemas import ClipFeatures, Scores


class _FakeJobs:
    def __init__(self):
        self.doc = None

    def insert_one(self, d):
        self.doc = dict(d)

    def update_one(self, flt, update):
        if self.doc and self.doc.get("job_id") == flt.get("job_id"):
            self.doc.update(update["$set"])
        return type("R", (), {"matched_count": 1})()

    def find_one(self, flt, projection=None):
        if self.doc and self.doc.get("job_id") == flt.get("job_id"):
            return dict(self.doc)
        return None


@pytest.fixture
def fake_jobs(monkeypatch):
    fj = _FakeJobs()
    monkeypatch.setattr(jobs, "_jobs", lambda settings=None: fj)
    return fj


def test_create_job_starts_queued(fake_jobs):
    jid = jobs.create_job("upload-x-01", "uploads/raw/x.mp4")
    assert fake_jobs.doc["stage"] == "queued"
    assert fake_jobs.doc["progress"] == jobs.STAGE_PROGRESS["queued"]
    assert fake_jobs.doc["dog_id"] == "upload-x-01"


def test_run_job_progresses_to_done(fake_jobs, monkeypatch):
    # Mock every heavy step so only the stage machine runs.
    import behavior.cli as cli
    import behavior.events as events_mod
    import behavior.thumbnail as thumb_mod
    import behavior.annotate as annotate_mod
    from behavior import s3store

    fake_r = {"scores": Scores(40, 20, 80, 70, 1), "features": ClipFeatures(),
              "frames": [], "tracks": []}
    monkeypatch.setattr(cli, "analyze_one", lambda *a, **k: fake_r)
    monkeypatch.setattr(events_mod, "extract_events", lambda t: [])
    monkeypatch.setattr(thumb_mod, "save_thumbnail", lambda *a, **k: "thumb.jpg")
    monkeypatch.setattr(annotate_mod, "annotate_clip", lambda *a, **k: k.get("out_path", "v.mp4"))
    monkeypatch.setattr(s3store, "download", lambda key, dest, settings=None: dest)
    monkeypatch.setattr(s3store, "available", lambda settings=None: False)
    monkeypatch.setattr(s3store, "delete_key", lambda key, settings=None: True)
    monkeypatch.setattr(persist, "write_tiger", lambda *a, **k: ("stable", []))
    monkeypatch.setattr(persist, "build_doc_fields",
                        lambda *a, **k: {"level": "Green", "summary": {}, "needs": [],
                                         "fit_notes": [], "not_suited_for": [],
                                         "upsert_kwargs": {}})
    monkeypatch.setattr(persist, "persist_summary", lambda dog_id, fields: {})

    # get_collection used for media_status updates
    class _Col:
        def update_one(self, *a, **k): return None
    monkeypatch.setattr(store_mongo, "get_collection", lambda settings=None: _Col())

    jid = jobs.create_job("upload-x-01", "uploads/raw/x.mp4")
    jobs.run_job(jid, "upload-x-01", "uploads/raw/x.mp4", "Rex", 1, 9)

    assert fake_jobs.doc["stage"] == "done"
    assert fake_jobs.doc["progress"] == 100
    assert fake_jobs.doc["result"]["dog_id"] == "upload-x-01"
    assert fake_jobs.doc["result"]["handling_level"] == "Green"
    # stage timings recorded for the real stages
    for st in ("downloading", "tracking", "scoring", "saving", "uploading_media"):
        assert st in fake_jobs.doc["stage_timings"]


def test_run_job_failed_path(fake_jobs, monkeypatch):
    import behavior.cli as cli
    from behavior import s3store
    monkeypatch.setattr(s3store, "download", lambda key, dest, settings=None: dest)
    monkeypatch.setattr(cli, "analyze_one",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    jid = jobs.create_job("upload-x-01", "uploads/raw/x.mp4")
    jobs.run_job(jid, "upload-x-01", "uploads/raw/x.mp4", None, 1, 9)
    assert fake_jobs.doc["stage"] == "failed"
    assert "boom" in fake_jobs.doc["error"]


def test_get_job_times_out(fake_jobs):
    jid = jobs.create_job("upload-x-01", "uploads/raw/x.mp4")
    # backdate started_at beyond the timeout, still non-terminal
    fake_jobs.doc["started_at"] = datetime.now(timezone.utc) - timedelta(seconds=jobs.JOB_TIMEOUT_S + 60)
    fake_jobs.doc["stage"] = "tracking"
    out = jobs.get_job(jid)
    assert out["stage"] == "failed"
    assert out["error"] == "Timed out"


def test_get_job_not_found(fake_jobs):
    assert jobs.get_job("nope") is None
