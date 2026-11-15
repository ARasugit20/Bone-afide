"""Tiger Data (TimescaleDB) store for per-hour behavior readings.

Schema lives in ``pipeline/sql/schema.sql`` (apply with ``scripts/setup_tiger.py``).
Connection string comes from ``TIGER_DSN`` in ``pipeline/.env``.

Demo time model: "day N, hour H" maps to a synthetic timestamp
``2026-11-01 00:00 UTC + N days + H hours``.

Every function accepts an optional ``conn`` (a psycopg 3 connection) so callers
and tests can inject one; otherwise a short-lived autocommit connection is opened.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict, is_dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator, Mapping, Optional

from .settings import load_settings

BASE_DATE = datetime(2026, 11, 1, tzinfo=timezone.utc)
TREND_THRESHOLD = 10.0  # avg_stress points

SCORE_FIELDS = ("energy", "stress", "approachability", "confidence", "arousal_spikes")

INSERT_SQL = """
INSERT INTO dog_readings
    (time, dog_id, day, hour, energy, stress, approachability, confidence, arousal_spikes)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (dog_id, time) DO UPDATE SET
    day             = EXCLUDED.day,
    hour            = EXCLUDED.hour,
    energy          = EXCLUDED.energy,
    stress          = EXCLUDED.stress,
    approachability = EXCLUDED.approachability,
    confidence      = EXCLUDED.confidence,
    arousal_spikes  = EXCLUDED.arousal_spikes
"""

TREND_SQL = """
SELECT bucket, dog_id, avg_stress, avg_energy,
       avg_approachability, avg_confidence, total_spikes
FROM dog_daily
WHERE dog_id = %s
ORDER BY bucket
"""

TREND_COLUMNS = (
    "bucket", "dog_id", "avg_stress", "avg_energy",
    "avg_approachability", "avg_confidence", "total_spikes",
)


def connect():
    """Open an autocommit psycopg 3 connection using TIGER_DSN."""
    import psycopg  # imported lazily so tests run without the driver

    dsn = load_settings().tiger_dsn
    if not dsn:
        raise RuntimeError("TIGER_DSN is not set (add it to pipeline/.env)")
    return psycopg.connect(dsn, autocommit=True)


@contextmanager
def _conn(conn=None) -> Iterator[Any]:
    if conn is not None:
        yield conn
        return
    owned = connect()
    try:
        yield owned
    finally:
        owned.close()


def synthetic_time(day: int, hour: int) -> datetime:
    """Map demo "day N, hour H" to a timestamp: base date + N days + H hours."""
    return BASE_DATE + timedelta(days=int(day), hours=int(hour))


def _score_map(scores: Any) -> Mapping[str, Any]:
    if is_dataclass(scores):
        return asdict(scores)
    if isinstance(scores, Mapping):
        return scores
    raise TypeError(f"scores must be a Scores dataclass or a mapping, got {type(scores)!r}")


def write_readings(dog_id: str, day: int, hour: int, scores: Any, conn=None) -> None:
    """Upsert one hourly reading. ``scores`` is a ``schemas.Scores`` or a dict.

    Idempotent: writing the same (dog_id, day, hour) again replaces the row
    instead of adding a duplicate (unique index on (dog_id, time)).
    """
    s = _score_map(scores)
    params = (
        synthetic_time(day, hour),
        dog_id,
        int(day),
        int(hour),
        *(int(s[f]) for f in SCORE_FIELDS),
    )
    with _conn(conn) as c:
        c.execute(INSERT_SQL, params)
        if not getattr(c, "autocommit", True):
            c.commit()


def refresh_daily(conn=None) -> None:
    """Refresh the dog_daily continuous aggregate over its full range.

    Must run outside a transaction block, so the connection must be autocommit.
    """
    with _conn(conn) as c:
        c.execute("CALL refresh_continuous_aggregate('dog_daily', NULL, NULL)")


def get_trend(dog_id: str, conn=None) -> list[dict]:
    """Return this dog's dog_daily rows ordered by bucket, as dicts."""
    with _conn(conn) as c:
        rows = c.execute(TREND_SQL, (dog_id,)).fetchall()
    return [dict(zip(TREND_COLUMNS, row)) for row in rows]


def classify_trend(rows: list[Mapping[str, Any]]) -> str:
    """Classify avg_stress across days: first day vs last day.

    Down by more than 10 points -> "improving"; up by more than 10 -> "worsening";
    otherwise (or fewer than two days) -> "stable".
    """
    stresses = [float(r["avg_stress"]) for r in rows if r.get("avg_stress") is not None]
    if len(stresses) < 2:
        return "stable"
    delta = stresses[-1] - stresses[0]
    if delta < -TREND_THRESHOLD:
        return "improving"
    if delta > TREND_THRESHOLD:
        return "worsening"
    return "stable"


def compute_trend(dog_id: str, conn=None) -> str:
    """Return "improving" | "stable" | "worsening" from the dog's daily avg_stress."""
    return classify_trend(get_trend(dog_id, conn=conn))


def delete_dog(dog_id: str, conn=None) -> int:
    """Delete all readings for a dog and refresh dog_daily. Returns rows deleted."""
    with _conn(conn) as c:
        cur = c.execute("DELETE FROM dog_readings WHERE dog_id = %s", (dog_id,))
        deleted = cur.rowcount
        refresh_daily(conn=c)
    return deleted
