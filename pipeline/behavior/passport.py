"""Public passport data: adopter- and landlord-safe fields only.

Builds a strict allowlist copy of a dog doc for the public QR page. Excludes staff
notes, vet review internals, S3 keys, and anything breed-related. Events are reduced
to labels + times. All text is guardrail-checked.
"""

from __future__ import annotations

from .guardrails import sanitize

# The only fields a passport may expose.
PASSPORT_FIELDS = (
    "dog_id", "name", "photo", "video_url", "handling_level", "scores", "needs",
    "fit_notes", "not_suited_for", "events", "sessions_observed",
    "updated_at", "expert_reviewed",
)

_SCORE_KEYS = ("energy", "stress", "approachability", "confidence", "arousal_spikes")


def build_passport(doc: dict) -> dict:
    """Return the adopter/landlord-safe public view of a dog doc.

    ``doc`` is the full stored doc (or an equivalent dict with the contract fields,
    media URLs, fit_notes, not_suited_for, events, evidence).
    """
    scores = {k: doc[k] for k in _SCORE_KEYS if k in doc}
    evidence = doc.get("evidence") or {}
    # events reduced to labels + times only (no internal fields)
    events = [{"type": e.get("type"), "start_s": e.get("start_s"),
               "end_s": e.get("end_s"), "label": e.get("label")}
              for e in (doc.get("events") or [])]

    passport = {
        "dog_id": doc.get("dog_id"),
        "name": doc.get("name"),
        "photo": doc.get("photo"),
        "video_url": doc.get("video_url"),
        "handling_level": doc.get("handling_level"),
        "scores": scores,
        "needs": list(doc.get("needs") or []),
        "fit_notes": list(doc.get("fit_notes") or []),
        "not_suited_for": list(doc.get("not_suited_for") or []),
        "events": events,
        "sessions_observed": evidence.get("sessions_observed",
                                          doc.get("sessions_observed", 0)),
        "updated_at": doc.get("updated_at"),
        "expert_reviewed": bool(doc.get("expert_reviewed", False)),
    }
    # Hard guarantee: only allowlisted keys, and no banned words anywhere.
    passport = {k: v for k, v in passport.items() if k in PASSPORT_FIELDS}
    sanitize(passport, _path="passport")
    return passport
