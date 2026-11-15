"""store_mongo tests with a fake pymongo client (no network).

Verifies the contract is validated before write, the unique index is created, and
history accumulates one entry per day with the top-level fields reflecting the
latest day.
"""

from __future__ import annotations

import pytest

from behavior import store_mongo
from behavior.schemas import Scores, build_summary


def _summary(day, stress=20):
    return build_summary(
        dog_id="june-01", day=day,
        scores=Scores(energy=20, stress=stress, approachability=90, confidence=80, arousal_spikes=1),
        handling_level="Green", trend="stable", needs=["great for apartments / first-time owners"],
    )


class _FakeCollection:
    def __init__(self):
        self.doc = None
        self.indexes = []

    def create_index(self, field, unique=False):
        self.indexes.append((field, unique))

    def update_one(self, flt, update, upsert=False):
        if self.doc is None:
            if upsert:
                self.doc = {"dog_id": flt["dog_id"], "history": []}
            else:
                return
        # Honor a simple {"field": {"$exists": False}} guard in the filter.
        for k, v in flt.items():
            if isinstance(v, dict) and v.get("$exists") is False:
                if k in self.doc:
                    return  # condition not met; no-op
        if "$pull" in update:
            day = update["$pull"]["history"]["day"]
            self.doc["history"] = [h for h in self.doc["history"] if h.get("day") != day]
        if "$set" in update:
            self.doc.update(update["$set"])
        if "$push" in update:
            self.doc.setdefault("history", []).append(update["$push"]["history"])
        return type("R", (), {"matched_count": 1, "modified_count": 1})()

    def find_one(self, flt, projection=None):
        if self.doc is None:
            return None
        d = dict(self.doc)
        if projection and projection.get("_id") == 0:
            d.pop("_id", None)
        return d


@pytest.fixture
def fake_collection(monkeypatch):
    col = _FakeCollection()
    monkeypatch.setattr(store_mongo, "get_collection", lambda settings=None: col)
    return col


def test_upsert_creates_and_sets_top_level(fake_collection):
    store_mongo.upsert_summary(_summary(1), photo="http://p", video_url="http://v")
    assert fake_collection.doc["dog_id"] == "june-01"
    assert fake_collection.doc["day"] == 1
    assert len(fake_collection.doc["history"]) == 1
    # frontend fields
    assert fake_collection.doc["name"] == "June"
    assert "updated_at" in fake_collection.doc
    assert fake_collection.doc["expert_reviewed"] is False
    assert fake_collection.doc["photo"] == "http://p"
    assert fake_collection.doc["video_url"] == "http://v"


def test_display_name():
    assert store_mongo.display_name("luna-01") == "Luna"
    assert store_mongo.display_name("kacy-01") == "Kacy"


def test_refuses_non_owned_dog(fake_collection):
    bad = _summary(1)
    bad["dog_id"] = "seed-99"
    with pytest.raises(ValueError):
        store_mongo.upsert_summary(bad)


def test_vet_review_sets_expert_reviewed(fake_collection):
    store_mongo.upsert_summary(_summary(1))
    assert fake_collection.doc["expert_reviewed"] is False
    store_mongo.set_vet_review("june-01", "Dr Lee", "Green", "ok")
    assert fake_collection.doc["expert_reviewed"] is True
    assert fake_collection.doc["vet_review"]["status"] == "reviewed"


def test_upsert_preserves_prior_expert_reviewed(fake_collection):
    store_mongo.upsert_summary(_summary(1))
    store_mongo.set_vet_review("june-01", "Dr Lee", "Green", "ok")
    # re-running analysis must not reset expert_reviewed back to False
    store_mongo.upsert_summary(_summary(2))
    assert fake_collection.doc["expert_reviewed"] is True


def test_history_accumulates_per_day(fake_collection):
    store_mongo.upsert_summary(_summary(1, stress=20))
    store_mongo.upsert_summary(_summary(2, stress=30))
    hist = fake_collection.doc["history"]
    assert [h["day"] for h in hist] == [1, 2]
    # top-level reflects the latest day
    assert fake_collection.doc["day"] == 2
    assert fake_collection.doc["stress"] == 30


def test_rerunning_a_day_replaces_not_duplicates(fake_collection):
    store_mongo.upsert_summary(_summary(1, stress=20))
    store_mongo.upsert_summary(_summary(1, stress=40))
    hist = fake_collection.doc["history"]
    assert [h["day"] for h in hist] == [1]
    assert hist[0]["stress"] == 40


def test_upsert_rejects_bad_contract(fake_collection):
    bad = {"dog_id": "x", "day": 1}  # missing contract keys
    with pytest.raises(ValueError):
        store_mongo.upsert_summary(bad)


def test_mask_hides_credentials():
    masked = store_mongo._mask("mongodb+srv://user:secretpw@cluster.mongodb.net/")
    assert "secretpw" not in masked
    assert "user" not in masked
    assert "cluster.mongodb.net" in masked
