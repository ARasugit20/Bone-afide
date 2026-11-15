"""Apply pipeline/sql/schema.sql to Tiger Data (TimescaleDB). Idempotent.

Usage (from pipeline/):
    .venv/bin/python scripts/setup_tiger.py

Each statement runs on its own in autocommit mode, because continuous
aggregates cannot be created inside a transaction block.
"""

from __future__ import annotations

import sys
from pathlib import Path

PIPELINE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PIPELINE_ROOT))

from behavior.store_tiger import connect  # noqa: E402

SCHEMA_PATH = PIPELINE_ROOT / "sql" / "schema.sql"


def split_statements(sql: str) -> list[str]:
    """Strip ``--`` comment lines and split on ';'."""
    lines = [ln for ln in sql.splitlines() if not ln.strip().startswith("--")]
    return [s.strip() for s in "\n".join(lines).split(";") if s.strip()]


def main() -> int:
    statements = split_statements(SCHEMA_PATH.read_text())
    with connect() as conn:
        for stmt in statements:
            first = " ".join(stmt.split())[:70]
            try:
                cur = conn.execute(stmt)
                result = cur.fetchone() if cur.description else cur.statusmessage
                print(f"OK   {first} -> {result}")
            except Exception as exc:  # report and stop
                print(f"FAIL {first}\n     {type(exc).__name__}: {exc}")
                return 1

        objs = conn.execute(
            """
            SELECT 'hypertable', hypertable_name FROM timescaledb_information.hypertables
             WHERE hypertable_name = 'dog_readings'
            UNION ALL
            SELECT 'cagg', view_name FROM timescaledb_information.continuous_aggregates
             WHERE view_name = 'dog_daily'
            UNION ALL
            SELECT 'policy', j.proc_name || ' job ' || j.job_id
              FROM timescaledb_information.jobs j
              JOIN timescaledb_information.continuous_aggregates c
                ON j.hypertable_name IN (c.view_name, c.materialization_hypertable_name)
             WHERE c.view_name = 'dog_daily'
               AND j.proc_name = 'policy_refresh_continuous_aggregate'
            """
        ).fetchall()
        print("Schema objects:", objs)
    print("Tiger schema ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
