# Behavior Pipeline — Design

## Scope and principles

- All code lives under `/pipeline`. `/app` is off-limits.
- Working end-to-end beats perfect accuracy. Every module runs from the CLI and is
  testable on one clip.
- Secrets load from `pipeline/.env`; nothing hardcoded or committed. `pipeline/.env.example`
  lists every key.
- Guardrails are enforced in code, not just convention: a single sanitizer rejects the
  banned words from any user-facing/stored string, and no breed value is ever read.

## Directory layout

```
pipeline/
  .env.example
  requirements.txt            # Python deps
  config/
    cameras.json              # per-camera front/door zones (normalized polygons)
    levels.json               # handling-level thresholds (Green/Yellow/Orange/Red)
    needs.json                # rule-based needs
  behavior/
    __init__.py
    settings.py               # loads .env, paths, constants (2 fps, model path, thresholds)
    schemas.py                # dataclasses/TypedDicts: FrameTrack, ClipFeatures, Scores, Summary
    guardrails.py             # banned-word sanitizer; breed-exclusion assertions
    ingest.py                 # local/S3 source -> sampled frames @2fps + timestamps
    track.py                  # YOLO11 + ByteTrack -> per-frame track records
    zones.py                  # load camera zones; front-zone membership test
    features.py               # track records -> ClipFeatures (motion); pose seam
    scores.py                 # ClipFeatures -> Scores (formulas now, sklearn later)
    levels.py                 # Scores -> handling level (from levels.json)
    needs.py                  # Scores -> needs list (from needs.json)
    trend.py                  # daily averages across days -> trend
    store_tiger.py            # per-hour rows -> TimescaleDB (psycopg)
    store_mongo.py            # contract summary -> MongoDB Atlas (pymongo)
    annotate.py               # box + trail + live scores -> MP4
    pipeline.py               # orchestrates one clip end-to-end
    api.py                    # FastAPI app
    cli.py                    # argparse entrypoints per module + full run
  tests/
    data/                     # one short sample clip + tiny fixtures
    test_*.py
```

(`zones.py`, `needs.py`, `trend.py`, `settings.py`, `schemas.py`, `guardrails.py`,
`pipeline.py` are supporting modules around the ten named modules in the task; the ten
named modules keep the exact names requested.)

## Data contracts (schemas.py)

- `FrameTrack`: `timestamp_s: float`, `detected: bool`, `track_id: int | None`,
  `box_px: (x1,y1,x2,y2) | None`, `box_norm: (x1,y1,x2,y2) | None`, `conf: float | None`.
- `ClipFeatures`: all Requirement-4 features plus `detection_coverage: float`,
  `frame_w`, `frame_h`, `duration_s`. Includes a reserved `pose: dict | None` slot
  (always `None` in stage 1) so the pose seam is visible in the type.
- `Scores`: `energy`, `stress`, `approachability`, `confidence` (int 0–100),
  `arousal_spikes` (int ≥ 0).
- `Summary`: exactly the contract keys, in contract order.

## Stage flow (pipeline.py)

```
ingest(source, dog_id, day) -> frames[]        # (frame, timestamp_s)
track(frames)               -> FrameTrack[]
zones.load(camera_id)       -> front_zone polygon (or default bottom 35%)
features(FrameTrack[], zone) -> ClipFeatures
scores(ClipFeatures)        -> Scores
levels(Scores)              -> handling_level
needs(Scores)               -> needs[]
trend(dog_id, day, Scores)  -> trend            # needs prior days from store
assemble Summary (contract) -> sanitize via guardrails
store_tiger(per-hour rows); store_mongo(Summary); annotate(frames, tracks, scores) -> mp4
```

### Per-hour rows (store_tiger)

Hackathon clips are short (20–60s tonight; no long recordings), so "per-hour" is
modeled as time buckets keyed `(dog_id, day, hour)`. Default is a single bucket; an
optional CLI `--hour` flag assigns a demo clip to a chosen hour of the day. Each row:
`(time, dog_id, day, hour, camera_id, energy, stress, approachability, confidence,
arousal_spikes, detection_coverage)`. Table is a TimescaleDB hypertable on `time`.
The writer is idempotent per `(dog_id, day, hour)`.

## Module designs

### ingest.py
- `open_source(source)`: if it looks like an S3 key (configurable prefix or `s3://`),
  download to a temp path via boto3; else treat as local path.
- `sample_frames(path, fps=2)`: OpenCV `VideoCapture`, stride = round(src_fps / fps),
  yields `(frame, timestamp_s)`. Raises on unopenable/empty video.

### track.py
- Load YOLO11 weights (path from settings). Run `.track(..., classes=[dog_class],
  tracker="bytetrack.yaml", conf=threshold)` per frame or over the stream.
- Assume one dog per clip. Fallback when more than one track appears: pick the track id
  with the greatest persistence (most frames); break ties by mean confidence. Document
  this in the module docstring.
- No detection → `FrameTrack(detected=False, ...)` keeps the timeline intact.

### zones.py
- `load_zone(camera_id)`: read `config/cameras.json`; missing → default polygon for the
  bottom 35% `[(0,0.65),(1,0.65),(1,1),(0,1)]`.
- `in_zone(box_norm, polygon)`: test box-center (and/or bottom-center) membership.

### features.py
- Work in normalized coordinates; normalize speed by box diagonal to reduce
  distance-to-camera bias.
- `% time moving`: frames where normalized speed exceeds a small threshold.
- `direction reversals/min`: sign changes in horizontal velocity, rate per minute.
- `circling`: accumulated turning angle of the center trajectory over sliding windows;
  flag sustained same-sign rotation.
- `h/w ratio over time`: series + summary stats; posture proxy without pose.
- `sudden accelerations toward front`: velocity spikes whose direction points into the
  front zone.
- **Pose seam:** `extract_features(tracks, zone, pose=None)`. `pose` stays `None` in
  stage 1. A later `pose.py` can produce keypoints and pass them here to add features
  without changing `scores.py`'s call.

### scores.py
- `score(features) -> Scores` via hand-tuned formulas:
  - energy ← speed + % moving + accelerations.
  - stress ← pacing (reversals) + circling + arousal spikes.
  - approachability ← % time in front zone + low stress.
  - confidence ← upright posture share + steady (non-pacing) movement.
  - arousal_spikes ← count of sudden accelerations toward front.
  - Clamp to 0–100, round to int.
- Pluggable backend: `ScoreModel` interface with `FormulaModel` (default) and a future
  `SklearnModel` loaded from a saved estimator; selected via settings. Low coverage is
  passed through, not hidden.

### levels.py
- `assign_level(scores) -> "Green"|"Yellow"|"Orange"|"Red"` from `config/levels.json`
  (ordered threshold rules, first match wins). Output restricted to the four names.

### needs.py
- `derive_needs(scores) -> [str]` from `config/needs.json` (list of `{when:
  conditions, need: text}`). Plain English, sanitized.

### trend.py
- `compute_trend(dog_id, current_day, current_scores) -> trend`: pull prior daily
  averages from store_mongo/store_tiger, compare a composite (e.g. approachability up +
  stress down ⇒ improving) with a dead-band for `stable`; one day ⇒ `stable`.

### store_tiger.py
- psycopg connection from `.env`. `ensure_schema()` creates the hypertable if absent.
  `write_hourly(rows)` upserts idempotently.

### store_mongo.py
- pymongo client from `.env`. `upsert_summary(summary)` keyed on `(dog_id, day)`.
  `get_profile(dog_id)`, `get_days(dog_id)` for the API and trend.

### annotate.py
- Re-read sampled frames; draw current box, a fading center-trail polyline, and a live
  score panel (energy/stress/approachability/confidence + level). Write MP4 via OpenCV
  `VideoWriter`. Never draws banned words.

### api.py (FastAPI)
- `POST /analyze` → `pipeline.run_clip(...)` → contract summary.
- `GET /dogs/{dog_id}/profile` → `store_mongo.get_profile`.
- `GET /dogs/{dog_id}/trend` → `trend.compute_trend` over stored days.
- Clear HTTP errors (404 unknown dog, 400 bad input, 502 datastore down).

### cli.py
- Subcommands: `ingest`, `track`, `features`, `scores`, `levels`, `annotate`,
  `store-tiger`, `store-mongo`, and `run` (full clip). Each prints JSON / writes its
  artifact so a single clip exercises every stage independently.

## Guardrails enforcement (guardrails.py)
- `sanitize(text|obj)`: walks strings in any output object; raises if a banned word
  (`aggressive`, `dangerous`, `menace`, case-insensitive) appears. Applied to summary,
  needs, and annotation text before they leave the pipeline.
- No code path reads a breed field; a comment/assert marks the exclusion at ingest.

## Configuration and secrets
- `settings.py` loads `.env` (python-dotenv). Keys documented in `.env.example`:
  AWS creds + region + bucket, Tiger/TimescaleDB DSN, Mongo URI + db name,
  `GEMINI_API_KEY` (reserved, not used stage 1), model weights path, sample fps,
  default camera id.

## Testing approach
- One short clip in `tests/data/`. Unit tests: zone membership, feature math on
  synthetic tracks, score clamping, level thresholds, needs rules, trend classification,
  guardrail sanitizer, contract-shape validation. Store modules tested against the
  services when env is present; skipped with a clear marker otherwise.

## Deferred (explicitly out of stage 1)
- Pose/keypoint estimation (seam reserved in `features.py`).
- sklearn calibration model (interface reserved in `scores.py`).
- Gemini usage (key reserved in settings).
