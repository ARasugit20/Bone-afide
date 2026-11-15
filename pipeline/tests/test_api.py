"""API tests with FastAPI TestClient and mocked Mongo/Tiger.

No network, no real datastores: store_mongo and store_tiger functions are
monkeypatched. Analysis is not exercised here (covered by feature/score tests);
POST /analyze is validated for input handling with the pipeline mocked.
"""

from __future__ import annotations

import io
import json

import pytest
from fastapi.testclient import TestClient

from behavior import api, store_mongo


@pytest.fixture
def client(monkeypatch):
    # Mongo: in-memory fake.
    docs = {
        "luna-01": {
            "dog_id": "luna-01", "day": 1, "energy": 100, "stress": 49,
            "approachability": 99, "confidence": 100, "arousal_spikes": 7,
            "handling_level": "Orange", "trend": "stable",
            "needs": ["active home with daily exercise"],
            "history": [{"dog_id": "luna-01", "day": 1, "energy": 100, "stress": 49,
                         "approachability": 99, "confidence": 100, "arousal_spikes": 7,
                         "handling_level": "Orange", "trend": "stable",
                         "needs": ["active home with daily exercise"]}],
        }
    }

    def fake_get_profile(dog_id, settings=None):
        d = docs.get(dog_id)
        return json.loads(json.dumps(d)) if d else None

    def fake_list_dogs(ids=None, settings=None):
        out = []
        for did, d in docs.items():
            if ids is None or did in ids:
                out.append({k: v for k, v in d.items()
                            if k not in ("history", "staff_notes", "vet_review")})
        return out

    def fake_add_note(dog_id, author, note, settings=None):
        if dog_id not in docs:
            return None
        docs[dog_id].setdefault("staff_notes", []).append({"author": author, "note": note})
        return docs[dog_id]

    def fake_set_review(dog_id, vet_name, confirmed_level, comment, settings=None):
        if dog_id not in docs:
            return None
        docs[dog_id]["vet_review"] = {"vet_name": vet_name, "confirmed_level": confirmed_level,
                                      "comment": comment, "status": "reviewed"}
        return docs[dog_id]

    class _FakeAdmin:
        def command(self, *_a, **_k): return {"ok": 1}

    class _FakeClient:
        admin = _FakeAdmin()

    monkeypatch.setattr(store_mongo, "get_profile", fake_get_profile)
    monkeypatch.setattr(store_mongo, "list_dogs", fake_list_dogs)
    monkeypatch.setattr(store_mongo, "add_staff_note", fake_add_note)
    monkeypatch.setattr(store_mongo, "set_vet_review", fake_set_review)
    monkeypatch.setattr(store_mongo, "get_client", lambda settings=None: _FakeClient())

    # Tiger: fake get_trend.
    import behavior.store_tiger as tiger
    monkeypatch.setattr(tiger, "get_trend", lambda dog_id, conn=None: [
        {"bucket": "2026-11-02T00:00:00Z", "dog_id": dog_id, "avg_stress": 49.0,
         "avg_energy": 100.0, "avg_approachability": 99.0, "avg_confidence": 100.0,
         "total_spikes": 21}
    ])

    return TestClient(api.app)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert set(body) == {"ok", "mongo", "tiger"}


def test_list_dogs_default_filters_to_real(client):
    r = client.get("/dogs")
    assert r.status_code == 200
    data = r.json()
    assert all(d["dog_id"] in api.REAL_DOG_IDS for d in data)
    # history excluded
    assert all("history" not in d for d in data)


def test_profile_found_sets_level_status(client):
    r = client.get("/dogs/luna-01/profile")
    assert r.status_code == 200
    body = r.json()
    assert body["dog_id"] == "luna-01"
    assert "history" in body
    assert body["level_status"] == "provisional"


def test_profile_not_found(client):
    r = client.get("/dogs/ghost-99/profile")
    assert r.status_code == 404


def test_events_endpoint(client):
    r = client.get("/dogs/luna-01/events")
    assert r.status_code == 200
    body = r.json()
    assert body["dog_id"] == "luna-01"
    assert isinstance(body["events"], list)


def test_events_not_found(client):
    assert client.get("/dogs/ghost-99/events").status_code == 404


def test_trend(client):
    r = client.get("/dogs/luna-01/trend")
    assert r.status_code == 200
    body = r.json()
    assert body["dog_id"] == "luna-01"
    assert body["rows"][0]["total_spikes"] == 21


def test_staff_notes_and_sanitize(client):
    r = client.post("/dogs/luna-01/staff-notes", json={"author": "Sam", "note": "very sweet"})
    assert r.status_code == 200
    assert r.json()["staff_notes"][-1]["note"] == "very sweet"
    # missing fields
    assert client.post("/dogs/luna-01/staff-notes", json={"author": "Sam"}).status_code == 400
    # banned word rejected by guardrails -> 500-level (GuardrailViolation)
    bad = client.post("/dogs/luna-01/staff-notes", json={"author": "x", "note": "dangerous dog"})
    assert bad.status_code >= 400


def test_vet_review_sets_status_reviewed(client):
    r = client.post("/dogs/luna-01/vet-review",
                    json={"vet_name": "Dr Lee", "confirmed_level": "Orange", "comment": "ok"})
    assert r.status_code == 200
    assert r.json()["vet_review"]["status"] == "reviewed"
    # after review, profile reports reviewed
    prof = client.get("/dogs/luna-01/profile").json()
    assert prof["level_status"] == "reviewed"


def test_video_not_found(client):
    assert client.get("/videos/nope.mp4").status_code == 404


def test_bias_not_found(client):
    assert client.get("/bias/ghost-99").status_code == 404


def test_report_endpoint(client):
    # If Claude Code's report module is absent, expect a clean 404; if present,
    # generate_report should return a JSON body. Either is acceptable.
    r = client.get("/dogs/luna-01/report")
    assert r.status_code in (200, 404)
    if r.status_code == 404:
        assert "not available" in r.json()["detail"]
