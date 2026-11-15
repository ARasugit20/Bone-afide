"""MongoDB Atlas store for per-dog contract summaries.

Connection URI comes from ``MONGO_URI`` in ``pipeline/.env`` (read only via
``settings``; never hardcoded or printed). Database is ``bonafide``, collection
``dogs``, with a unique index on ``dog_id``.

Each dog document holds the exact output-contract fields for its latest day plus a
``history`` array of prior daily summaries, so the profile and trend endpoints can
read one document. The stored contract fields are validated against the contract
before writing.
"""

from __future__ import annotations

from typing import Optional

from datetime import datetime, timezone

from .schemas import SUMMARY_KEYS, validate_summary
from .settings import Settings, load_settings

DB_NAME = "bonafide"
COLLECTION = "dogs"

# Only these dog_ids are owned by this pipeline. Documents with any other dog_id are
# the teammate's seed data and must never be created or modified here.
REAL_DOG_IDS = ("june-01", "katie-01", "kacy-01", "kinder-01", "luna-01")


def is_owned(dog_id: str) -> bool:
    """Owned dogs this pipeline may write: the 5 demo dogs plus any 'upload-' dog
    created through POST /analyze. Everything else is the teammate's seed data."""
    return dog_id in REAL_DOG_IDS or dog_id.startswith("upload-")


def display_name(dog_id: str) -> str:
    """'luna-01' -> 'Luna' (capitalized stem before the first hyphen)."""
    stem = dog_id.split("-", 1)[0]
    return stem.capitalize()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class MongoNotConfigured(RuntimeError):
    """Raised when MONGO_URI is not set."""


def _mask(uri: str) -> str:
    """Mask credentials in a Mongo URI for safe logging (never prints the password)."""
    if not uri:
        return "<unset>"
    # Keep only the scheme and host hint; drop any credentials entirely.
    try:
        scheme, rest = uri.split("://", 1)
        host = rest.split("@")[-1].split("/")[0]
        return f"{scheme}://***@{host}"
    except Exception:
        return "<masked>"


def get_client(settings: Optional[Settings] = None):
    """Return a pymongo client from MONGO_URI. Raises if unset."""
    settings = settings or load_settings()
    if not settings.mongo_uri:
        raise MongoNotConfigured("MONGO_URI is not set in pipeline/.env")
    from pymongo import MongoClient

    return MongoClient(settings.mongo_uri)


def get_collection(settings: Optional[Settings] = None):
    """Return the dogs collection, ensuring the unique index on dog_id exists."""
    client = get_client(settings)
    col = client[DB_NAME][COLLECTION]
    col.create_index("dog_id", unique=True)
    return col


def upsert_summary(
    summary: dict,
    *,
    photo: Optional[str] = None,
    video_url: Optional[str] = None,
    name: Optional[str] = None,
    events: Optional[list] = None,
    welfare: Optional[dict] = None,
    settings: Optional[Settings] = None,
) -> dict:
    """Upsert the contract ``summary`` for its dog, appending to a daily history.

    Also writes the frontend-facing fields the teammate's ``normalizeDog`` expects:
    ``name`` (capitalized from dog_id), ``updated_at`` (ISO), ``expert_reviewed``
    (set to False only when absent, so a prior vet review is preserved), and, when
    provided, ``photo`` and ``video_url``.

    Refuses to write any dog_id outside the owned set so the teammate's seed data is
    never touched.
    """
    summary = validate_summary(summary)  # enforce exact contract shape + guardrails
    dog_id = summary["dog_id"]
    if not is_owned(dog_id):
        raise ValueError(f"refusing to write non-owned dog_id {dog_id!r}")
    day = summary["day"]
    col = get_collection(settings)

    # Remove any existing history entry for this day, then push the new one.
    col.update_one(
        {"dog_id": dog_id},
        {"$pull": {"history": {"day": day}}},
        upsert=True,
    )
    set_fields = {k: summary[k] for k in SUMMARY_KEYS}
    set_fields["name"] = name or display_name(dog_id)
    set_fields["updated_at"] = _now_iso()
    if photo is not None:
        set_fields["photo"] = photo
    if video_url is not None:
        set_fields["video_url"] = video_url
    if events is not None:
        set_fields["events"] = events
    if welfare is not None:
        set_fields["welfare"] = welfare

    col.update_one(
        {"dog_id": dog_id},
        {
            "$set": set_fields,
            "$push": {"history": {k: summary[k] for k in SUMMARY_KEYS}},
            # Default expert_reviewed only if the field does not already exist.
            "$setOnInsert": {},
        },
    )
    # Ensure expert_reviewed exists without clobbering a prior True.
    col.update_one(
        {"dog_id": dog_id, "expert_reviewed": {"$exists": False}},
        {"$set": {"expert_reviewed": False}},
    )
    doc = col.find_one({"dog_id": dog_id}, {"_id": 0})
    return doc or summary


def get_profile(dog_id: str, *, settings: Optional[Settings] = None) -> Optional[dict]:
    """Return the stored document for ``dog_id`` (without _id), or None."""
    col = get_collection(settings)
    return col.find_one({"dog_id": dog_id}, {"_id": 0})


def get_days(dog_id: str, *, settings: Optional[Settings] = None) -> list[dict]:
    """Return the dog's history (daily summaries), sorted by day."""
    doc = get_profile(dog_id, settings=settings)
    if not doc:
        return []
    return sorted(doc.get("history", []), key=lambda d: d.get("day", 0))


def list_dogs(
    dog_ids: Optional[list[str]] = None, *, settings: Optional[Settings] = None
) -> list[dict]:
    """Return contract-only summaries (no history) for all dogs or a filtered set."""
    col = get_collection(settings)
    query = {"dog_id": {"$in": dog_ids}} if dog_ids else {}
    projection = {"_id": 0, "history": 0, "staff_notes": 0, "vet_review": 0}
    return list(col.find(query, projection))


def add_staff_note(
    dog_id: str, author: str, note: str, *, settings: Optional[Settings] = None
) -> Optional[dict]:
    """Append a staff note to the dog document. Returns the updated doc or None."""
    if not is_owned(dog_id):
        raise ValueError(f"refusing to write non-owned dog_id {dog_id!r}")
    col = get_collection(settings)
    entry = {"author": author, "note": note}
    res = col.update_one(
        {"dog_id": dog_id},
        {"$push": {"staff_notes": entry}, "$set": {"updated_at": _now_iso()}},
    )
    if res.matched_count == 0:
        return None
    return col.find_one({"dog_id": dog_id}, {"_id": 0})


def set_vet_review(
    dog_id: str, vet_name: str, confirmed_level: str, comment: str,
    *, settings: Optional[Settings] = None,
) -> Optional[dict]:
    """Record a vet review (status 'reviewed') and set expert_reviewed=True.

    Returns the updated doc, or None if the dog is not found.
    """
    if not is_owned(dog_id):
        raise ValueError(f"refusing to write non-owned dog_id {dog_id!r}")
    col = get_collection(settings)
    review = {
        "vet_name": vet_name,
        "confirmed_level": confirmed_level,
        "comment": comment,
        "status": "reviewed",
    }
    res = col.update_one(
        {"dog_id": dog_id},
        {"$set": {"vet_review": review, "expert_reviewed": True, "updated_at": _now_iso()}},
    )
    if res.matched_count == 0:
        return None
    return col.find_one({"dog_id": dog_id}, {"_id": 0})


def set_media_urls(
    dog_id: str, *, photo: Optional[str] = None, video_url: Optional[str] = None,
    settings: Optional[Settings] = None,
) -> Optional[dict]:
    """Update only the media URLs (used by refresh-urls). Owned dogs only."""
    if not is_owned(dog_id):
        raise ValueError(f"refusing to write non-owned dog_id {dog_id!r}")
    set_fields = {"updated_at": _now_iso()}
    if photo is not None:
        set_fields["photo"] = photo
    if video_url is not None:
        set_fields["video_url"] = video_url
    col = get_collection(settings)
    res = col.update_one({"dog_id": dog_id}, {"$set": set_fields})
    if res.matched_count == 0:
        return None
    return col.find_one({"dog_id": dog_id}, {"_id": 0})
