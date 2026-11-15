"""Tiger Data store tests using a mock connection (no database needed)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from behavior import store_tiger
from behavior.schemas import Scores


def _mock_conn(rows=None):
    conn = MagicMock()
    conn.autocommit = True
    conn.execute.return_value.fetchall.return_value = rows or []
    return conn


def _row(day, stress):
    return (datetime(2026, 11, 1 + day, tzinfo=timezone.utc), "test-dog",
            float(stress), 50.0, 60.0, 55.0, 2)


# --- time mapping -------------------------------------------------------------

def test_synthetic_time_base_plus_days_and_hours():
    assert store_tiger.synthetic_time(0, 0) == datetime(2026, 11, 1, tzinfo=timezone.utc)
    assert store_tiger.synthetic_time(3, 14) == datetime(2026, 11, 4, 14, tzinfo=timezone.utc)


# --- write_readings -----------------------------------------------------------

def test_write_readings_inserts_mapped_row_from_scores():
    conn = _mock_conn()
    scores = Scores(energy=62, stress=31, approachability=74, confidence=58, arousal_spikes=2)
    store_tiger.write_readings("max-01", 3, 5, scores, conn=conn)

    sql, params = conn.execute.call_args.args
    assert "INSERT INTO dog_readings" in sql
    assert params == (
        datetime(2026, 11, 4, 5, tzinfo=timezone.utc), "max-01", 3, 5, 62, 31, 74, 58, 2,
    )
    conn.commit.assert_not_called()


def test_write_readings_accepts_dict_and_commits_non_autocommit():
    conn = _mock_conn()
    conn.autocommit = False
    store_tiger.write_readings(
        "d", 1, 0,
        {"energy": 1, "stress": 2, "approachability": 3, "confidence": 4, "arousal_spikes": 0},
        conn=conn,
    )
    assert conn.execute.call_args.args[1][4:] == (1, 2, 3, 4, 0)
    conn.commit.assert_called_once()


def test_write_readings_rejects_bad_scores_type():
    with pytest.raises(TypeError):
        store_tiger.write_readings("d", 1, 0, [1, 2, 3], conn=_mock_conn())


class _FakeReadingsTable:
    """Minimal in-memory stand-in for dog_readings.

    Honors the unique (dog_id, time) constraint only when the SQL actually says
    ON CONFLICT (dog_id, time) DO UPDATE — a plain INSERT appends a duplicate, the
    way the old code did.
    """

    def __init__(self):
        self.rows = []
        self.autocommit = True

    def execute(self, sql, params=()):
        time_, dog_id = params[0], params[1]
        upsert = "ON CONFLICT (dog_id, time) DO UPDATE" in " ".join(sql.split())
        if upsert:
            self.rows = [r for r in self.rows if (r[0], r[1]) != (time_, dog_id)]
        self.rows.append(params)
        return MagicMock()


def test_write_same_reading_twice_leaves_one_row():
    table = _FakeReadingsTable()
    first = Scores(energy=40, stress=30, approachability=70, confidence=60, arousal_spikes=5)
    store_tiger.write_readings("june-01", 1, 9, first, conn=table)
    store_tiger.write_readings("june-01", 1, 9, first, conn=table)
    assert len(table.rows) == 1
    assert table.rows[0][-1] == 5  # arousal_spikes counted once, not twice


def test_rewrite_replaces_values_and_other_hours_are_kept():
    table = _FakeReadingsTable()
    store_tiger.write_readings("june-01", 1, 9, Scores(40, 30, 70, 60, 5), conn=table)
    store_tiger.write_readings("june-01", 1, 9, Scores(41, 31, 71, 61, 2), conn=table)
    store_tiger.write_readings("june-01", 1, 10, Scores(40, 30, 70, 60, 1), conn=table)
    assert len(table.rows) == 2
    by_hour = {r[3]: r for r in table.rows}
    assert by_hour[9][4:] == (41, 31, 71, 61, 2)


# --- refresh / get_trend ------------------------------------------------------

def test_refresh_daily_calls_refresh_continuous_aggregate():
    conn = _mock_conn()
    store_tiger.refresh_daily(conn=conn)
    sql = conn.execute.call_args.args[0]
    assert "refresh_continuous_aggregate('dog_daily'" in sql


def test_get_trend_returns_dicts_ordered_by_bucket():
    conn = _mock_conn([_row(0, 70), _row(1, 60)])
    rows = store_tiger.get_trend("test-dog", conn=conn)

    sql, params = conn.execute.call_args.args
    assert "FROM dog_daily" in sql and "ORDER BY bucket" in sql
    assert params == ("test-dog",)
    assert [r["avg_stress"] for r in rows] == [70.0, 60.0]
    assert set(rows[0]) >= {"bucket", "dog_id", "avg_stress", "avg_energy"}


# --- compute_trend ------------------------------------------------------------

@pytest.mark.parametrize(
    "stresses, expected",
    [
        ([70, 60, 50, 40, 30], "improving"),
        ([30, 45, 60], "worsening"),
        ([50, 55, 45, 58], "stable"),     # +8: within threshold
        ([50, 40], "stable"),             # exactly -10 is not "more than 10"
        ([50, 39.5], "improving"),
        ([50], "stable"),                 # one day: not enough to call a trend
        ([], "stable"),
    ],
)
def test_compute_trend(stresses, expected):
    conn = _mock_conn([_row(i, s) for i, s in enumerate(stresses)])
    assert store_tiger.compute_trend("test-dog", conn=conn) == expected


def test_trend_values_match_contract():
    from behavior.guardrails import TREND_VALUES
    for stresses in ([70, 30], [30, 70], [50, 50]):
        rows = [{"avg_stress": s} for s in stresses]
        assert store_tiger.classify_trend(rows) in TREND_VALUES


# --- schema contract ----------------------------------------------------------

def test_schema_has_contract_columns_and_is_idempotent():
    sql = (Path(store_tiger.__file__).resolve().parents[1] / "sql" / "schema.sql").read_text()
    for needle in (
        "time_bucket('1 day', time)  AS bucket", "AS avg_stress", "AS avg_energy",
        "AS avg_approachability", "AS avg_confidence", "AS total_spikes",
        "timescaledb.continuous", "add_continuous_aggregate_policy",
        "ON dog_readings (dog_id, time",
    ):
        assert needle in sql, needle
    assert "CREATE TABLE IF NOT EXISTS" in sql
    assert "if_not_exists => TRUE" in sql
    assert "MATERIALIZED VIEW IF NOT EXISTS" in sql


def test_schema_dedupes_before_unique_index():
    sql = (Path(store_tiger.__file__).resolve().parents[1] / "sql" / "schema.sql").read_text()
    dedupe = sql.index("DELETE FROM dog_readings a")
    unique = sql.index("CREATE UNIQUE INDEX IF NOT EXISTS dog_readings_dog_id_time_uidx")
    assert dedupe < unique
    assert "ON dog_readings (dog_id, time);" in sql
    assert "ON CONFLICT (dog_id, time) DO UPDATE" in store_tiger.INSERT_SQL
