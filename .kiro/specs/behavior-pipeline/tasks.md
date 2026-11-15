# Behavior Pipeline — Tasks

Order follows the requirements. Pose estimation is NOT implemented; task 6 only
reserves a clean seam. Each task leaves something runnable/testable on one clip.

- [ ] 1. Project scaffold and config
  - Create `pipeline/` layout: `behavior/` package, `config/`, `tests/data/`.
  - Add `requirements.txt` (ultralytics, opencv-python, numpy, pandas, scikit-learn,
    fastapi, uvicorn, boto3, psycopg, pymongo, python-dotenv, google-genai).
  - Add `settings.py` (loads `.env`, constants: 2 fps, model path, default camera) and
    `pipeline/.env.example` documenting every key. Add `.env` to `.gitignore`.
  - Add `schemas.py` (FrameTrack, ClipFeatures with reserved `pose` slot, Scores,
    Summary in contract order) and `guardrails.py` (banned-word sanitizer).
  - _Requirements: 11.3, all guardrails_

- [ ] 2. Ingest module
  - `ingest.py`: local-path and S3-key sources (boto3), frame sampling at 2 fps with
    per-frame timestamps, carry `dog_id`/`day`, clear error on bad/empty video.
  - CLI subcommand `ingest`; unit test on the sample clip (frame count, timestamps).
  - _Requirements: 1_

- [ ] 3. Tracking module (stage 1)
  - `track.py`: YOLO11 detection filtered to COCO "dog" + ByteTrack; per-frame
    FrameTrack (px + normalized box, conf, track id); "no detection" preserves timeline;
    primary-track selection rule documented; configurable weights/threshold.
  - CLI subcommand `track`; test that missing-detection frames are kept.
  - _Requirements: 2_

- [ ] 4. Kennel zones
  - `zones.py`: load `config/cameras.json` front/door polygon (normalized); default to
    bottom 35% when absent; `in_zone` membership test. Seed `cameras.json` with a
    default camera.
  - Unit test: default zone + a custom polygon.
  - _Requirements: 3_

- [ ] 5. Features per clip
  - `features.py`: mean speed + % time moving (box-size normalized), % time in front
    zone, reversals/min, circling detection, h/w ratio over time, sudden accelerations
    toward front; detection coverage. Compute over available frames only.
  - CLI subcommand `features`; unit tests on synthetic tracks for each feature.
  - _Requirements: 4.1–4.7_

- [ ] 6. Pose seam (interface only — DO NOT implement pose)
  - Define `extract_features(tracks, zone, pose=None)` signature and the reserved
    `pose` slot in ClipFeatures; document how a future `pose.py` plugs in. No keypoint
    code.
  - _Requirements: 4.8_

- [ ] 7. Scores
  - `scores.py`: `ScoreModel` interface + `FormulaModel` with hand-tuned formulas for
    energy/stress/approachability/confidence and arousal_spikes count; clamp to int
    0–100; pass through detection coverage; reserve `SklearnModel` slot (no training).
  - CLI subcommand `scores`; unit tests for clamping and formula outputs.
  - _Requirements: 5_

- [ ] 8. Handling level
  - `levels.py` + `config/levels.json`: ordered thresholds → Green/Yellow/Orange/Red,
    first match wins; reloaded per run; output limited to the four names.
  - CLI subcommand `levels`; unit test each band boundary.
  - _Requirements: 6_

- [ ] 9. Needs
  - `needs.py` + `config/needs.json`: rule-based plain-English needs (high energy →
    "active home"; high stress + low approachability → "quiet home, patient owner");
    sanitized output.
  - Unit test the example rules.
  - _Requirements: 7_

- [ ] 10. Trend
  - `trend.py`: compare daily average scores across days → improving/stable/worsening;
    one day → stable; dead-band for stable.
  - Unit test with synthetic multi-day data.
  - _Requirements: 8_

- [ ] 11. Tiger Data store (per-hour rows)
  - `store_tiger.py`: psycopg connection from `.env`; `ensure_schema()` hypertable;
    `write_hourly(rows)` idempotent per `(dog_id, day, hour)`; bucket short clips to one
    row.
  - CLI subcommand `store-tiger`; integration test skipped cleanly when no DSN.
  - _Requirements: 9.1, 9.4_

- [ ] 12. Mongo store (contract summary)
  - `store_mongo.py`: pymongo from `.env`; `upsert_summary` keyed `(dog_id, day)`;
    `get_profile`, `get_days`. Validate summary matches the contract exactly before
    write.
  - CLI subcommand `store-mongo`; integration test skipped cleanly when no URI.
  - _Requirements: 9.2, 9.4_

- [ ] 13. Annotated MP4
  - `annotate.py`: draw box, fading track trail, and live score panel per frame; write
    MP4 via OpenCV; never render banned words.
  - CLI subcommand `annotate`; smoke test that an MP4 is produced from the sample clip.
  - _Requirements: 9.3_

- [ ] 14. End-to-end orchestration + CLI `run`
  - `pipeline.py`: wire ingest → track → zones → features → scores → levels → needs →
    trend → assemble sanitized contract summary → stores + annotate.
  - `cli.py run`: full clip → prints contract JSON, writes per-hour rows + MP4.
  - End-to-end test on the sample clip asserts contract shape and the MP4 exists.
  - _Requirements: 9, 11.1, 11.2_

- [ ] 15. FastAPI service
  - `api.py`: `POST /analyze` (video ref + dog_id + day → contract summary),
    `GET /dogs/{dog_id}/profile`, `GET /dogs/{dog_id}/trend`; clear HTTP error codes.
  - Test with a mocked pipeline/store for the three routes.
  - _Requirements: 10_

- [ ] 16. Guardrail + contract verification pass
  - Assert no output path can emit banned words; assert no breed field is read; assert
    the summary shape/types/order match the contract across a full run.
  - _Requirements: all guardrails, contract_
