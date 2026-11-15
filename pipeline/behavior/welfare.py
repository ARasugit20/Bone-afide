"""Kennel-decline welfare alert, computed from real Tiger trend rows.

Looks at the last 3 sessions (daily stress averages from ``store_tiger.get_trend``)
and flags a rising-stress trend so staff can intervene early (quieter kennel, foster
priority). Uses only real rows; with fewer than 3 sessions the status is "stable".

Output shape (stored on the Mongo dog doc, returned by GET /dogs/{dog_id}):
    {"status": "rising_stress" | "stable" | "improving",
     "sessions": int, "stress_change": int, "message": str}
"""

from __future__ import annotations

from typing import Optional

RISING_DELTA = 10   # total stress increase (points) over the last 3 sessions
IMPROVING_DELTA = -10


def _bucket_key(row: dict):
    return str(row.get("bucket"))


def compute_welfare(trend_rows: Optional[list[dict]]) -> dict:
    """Compute the welfare alert from Tiger trend rows (one per session/day)."""
    rows = sorted(trend_rows or [], key=_bucket_key)
    sessions = len(rows)

    if sessions < 3:
        return {
            "status": "stable",
            "sessions": sessions,
            "stress_change": 0,
            "message": "Not enough sessions yet",
        }

    last3 = rows[-3:]
    first = float(last3[0].get("avg_stress", 0) or 0)
    latest = float(last3[-1].get("avg_stress", 0) or 0)
    change = int(round(latest - first))

    if change >= RISING_DELTA:
        status = "rising_stress"
        message = (f"Stress up {change} points over 3 sessions. "
                   f"Consider a quieter kennel or foster priority.")
    elif change <= IMPROVING_DELTA:
        status = "improving"
        message = (f"Stress down {abs(change)} points over 3 sessions. "
                   f"Settling in well.")
    else:
        status = "stable"
        message = (f"Stress steady ({change:+d} points) over 3 sessions. "
                   f"No action needed.")

    return {"status": status, "sessions": sessions,
            "stress_change": change, "message": message}
