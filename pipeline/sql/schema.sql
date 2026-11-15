-- Tiger Data (TimescaleDB) schema for per-hour dog behavior readings.
-- Idempotent: safe to run more than once (see scripts/setup_tiger.py).
-- Each statement is executed separately in autocommit mode, because
-- continuous aggregates cannot be created inside a transaction block.
-- Keep statements free of inner semicolons (setup_tiger.py splits on ';').

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS dog_readings (
    time            timestamptz NOT NULL,
    dog_id          text        NOT NULL,
    day             int,
    hour            int,
    energy          int,
    stress          int,
    approachability int,
    confidence      int,
    arousal_spikes  int
);

SELECT create_hypertable('dog_readings', 'time', if_not_exists => TRUE);

-- One reading per (dog_id, time). Remove duplicates left by earlier non-idempotent
-- writes (keeps the most recently inserted row), then enforce uniqueness so
-- store_tiger.write_readings can upsert with ON CONFLICT (dog_id, time).
-- Both steps are no-ops on re-run. Duplicates always share a chunk (same time),
-- so comparing ctid within one tableoid is safe on a hypertable.
DELETE FROM dog_readings a
    USING dog_readings b
    WHERE a.dog_id = b.dog_id
      AND a.time = b.time
      AND a.tableoid = b.tableoid
      AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS dog_readings_dog_id_time_uidx
    ON dog_readings (dog_id, time);

-- Superseded by the unique index above.
DROP INDEX IF EXISTS dog_readings_dog_id_time_idx;

-- Column names bucket, dog_id, avg_stress, avg_energy are a contract:
-- the teammate's trend route reads them. Do not rename.
CREATE MATERIALIZED VIEW IF NOT EXISTS dog_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
    time_bucket('1 day', time)  AS bucket,
    dog_id,
    avg(stress)::float8          AS avg_stress,
    avg(energy)::float8          AS avg_energy,
    avg(approachability)::float8 AS avg_approachability,
    avg(confidence)::float8      AS avg_confidence,
    sum(arousal_spikes)::bigint  AS total_spikes
FROM dog_readings
GROUP BY bucket, dog_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('dog_daily',
    start_offset      => INTERVAL '90 days',
    end_offset        => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists     => TRUE);
