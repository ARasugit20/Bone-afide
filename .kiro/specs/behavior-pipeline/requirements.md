# Behavior Pipeline — Requirements

## Overview

A video-to-scores pipeline for Unleashed. It takes a kennel video of one dog on a
given day, measures behavior from motion in the frame (never breed), and produces
per-hour time-series rows, a per-dog summary matching the output contract, and an
annotated MP4. A FastAPI service exposes analysis and lookup endpoints.

Stage 1 (must work tonight) is detection + tracking with pretrained YOLO11 and
ByteTrack. Pose estimation is deferred; the feature layer must expose a clean seam
so keypoint features can be added later without reworking callers.

All work lives inside `/pipeline`. Secrets come from `pipeline/.env`; a committed
`pipeline/.env.example` documents every key.

## Guardrails (apply to all requirements)

- Never emit the words "aggressive", "dangerous", or "menace" in any output, label,
  need, log line, or docstring that can reach a user or a stored record.
- Breed is never an input to any model, feature, score, or rule.
- Communicate risk only through handling levels (Green, Yellow, Orange, Red) and
  plain-English needs.
- Output contract (exact shape the teammate's `/app` depends on):

  ```json
  {"dog_id": "max-01", "day": 3, "energy": 62, "stress": 31, "approachability": 74, "confidence": 58, "arousal_spikes": 2, "handling_level": "Yellow", "trend": "improving", "needs": ["active home", "no cats yet"]}
  ```

  All scores are integers 0–100. `arousal_spikes` is a non-negative integer count.
  `trend` is one of `improving`, `stable`, `worsening`. `handling_level` is one of
  `Green`, `Yellow`, `Orange`, `Red`.

---

## Requirement 1 — Ingest

**User story:** As the pipeline operator, I want to point the pipeline at a kennel
video (local file or S3 key) with a dog id and day number, so frames are sampled at
a fixed rate for downstream stages.

**Acceptance criteria:**

1. WHEN given a local path THEN the system SHALL read that file directly.
2. WHEN given an S3 key THEN the system SHALL download it via boto3 using credentials
   from `pipeline/.env` before reading.
3. WHEN ingesting THEN the system SHALL require `dog_id` (string) and `day` (integer)
   and carry them through to all outputs.
4. WHEN sampling THEN the system SHALL emit frames at 2 fps (configurable) and record
   each sampled frame's timestamp in seconds from clip start.
5. WHEN the video cannot be opened or is empty THEN the system SHALL fail with a clear
   error naming the source.

## Requirement 2 — Tracking (stage 1)

**User story:** As the pipeline, I want the dog's bounding box per sampled frame, so
later stages can measure motion.

**Acceptance criteria:**

1. WHEN tracking THEN the system SHALL use pretrained YOLO11 detection filtered to the
   COCO "dog" class with ByteTrack association.
2. WHEN a frame has no dog detection THEN the system SHALL record that frame as
   "no detection" rather than dropping it, preserving the timeline.
3. WHEN multiple dogs are detected THEN the system SHALL follow one primary track
   (highest-confidence / most-persistent) and document the selection rule.
4. WHEN tracking completes THEN the system SHALL output, per sampled frame: timestamp,
   detected flag, track id, box in pixels and in normalized coordinates, and detection
   confidence.
5. The model weights path and confidence threshold SHALL be configurable.

## Requirement 3 — Kennel zones

**User story:** As the operator, I want a per-camera zone config so "front/door"
proximity can be measured in a camera-independent way.

**Acceptance criteria:**

1. WHEN a camera config exists THEN the system SHALL read the "front/door" region as a
   polygon in normalized (0–1) coordinates.
2. WHEN no config is supplied for a camera THEN the system SHALL default the front zone
   to the bottom 35% of the frame.
3. The config SHALL be a simple JSON file keyed by camera id and editable by hand.

## Requirement 4 — Features per clip

**User story:** As the scoring stage, I want motion features computed from the track,
so scores rest on measurable behavior.

**Acceptance criteria:** The system SHALL compute, per clip:

1. Mean speed and % time moving, normalized by box size.
2. % of time the box is inside the front zone.
3. Direction reversals per minute (pacing indicator).
4. Circling detection.
5. Box height-to-width ratio over time (posture proxy: standing vs. lying vs. crouched).
6. Count of sudden accelerations toward the front zone.
7. WHEN frames are missing detections THEN features SHALL be computed over available
   frames and SHALL record detection coverage (fraction of frames with a detection).
8. The feature layer SHALL expose a stable, documented seam so later pose/keypoint
   features can be added without changing how `scores.py` calls it.

## Requirement 5 — Scores

**User story:** As the pipeline, I want 0–100 scores plus an arousal-spike count from
features, so each dog gets a comparable profile.

**Acceptance criteria:**

1. WHEN scoring THEN the system SHALL produce integer 0–100 values for `energy`,
   `stress`, `approachability`, and `confidence`, and a non-negative integer
   `arousal_spikes` count.
2. Scores SHALL start from hand-tuned formulas over the Requirement 4 features.
3. The scoring layer SHALL allow a later scikit-learn model, trained on hand labels, to
   replace or calibrate the formulas behind the same interface.
4. WHEN detection coverage is low THEN the system SHALL still produce scores and SHALL
   record coverage so low-confidence results are identifiable.

## Requirement 6 — Handling level

**User story:** As the operator, I want the handling level derived from tunable
thresholds, so I can adjust policy without touching code.

**Acceptance criteria:**

1. WHEN assigning a level THEN the system SHALL map scores to `Green`, `Yellow`,
   `Orange`, or `Red` using rules read from one config file.
2. The threshold config SHALL be hand-editable and reloaded per run.
3. The output SHALL never use the banned words; only the four level names.

## Requirement 7 — Needs

**User story:** As the teammate's app, I want plain-English needs, so adopters get
actionable guidance.

**Acceptance criteria:**

1. WHEN scores meet rule conditions THEN the system SHALL emit plain-English needs,
   e.g. high energy → "active home"; high stress + low approachability → "quiet home,
   patient owner".
2. Needs SHALL be rule-based and the rules SHALL live in config so they can be tuned.
3. Needs SHALL never contain the banned words.

## Requirement 8 — Trend

**User story:** As the pipeline, I want a trend across days, so progress is visible.

**Acceptance criteria:**

1. WHEN two or more days of daily averages exist THEN the system SHALL classify the
   trend as `improving`, `stable`, or `worsening`.
2. WHEN only one day exists THEN the system SHALL return `stable`.
3. The comparison SHALL use the dog's daily average scores across days.

## Requirement 9 — Outputs

**User story:** As the operator, I want results persisted and a visual artifact, so the
app and reviewers can consume them.

**Acceptance criteria:**

1. WHEN a clip is analyzed THEN the system SHALL write per-hour time-series rows to
   Tiger Data (TimescaleDB) via psycopg.
2. WHEN a clip is analyzed THEN the system SHALL write a per-dog summary document to
   MongoDB Atlas via pymongo that matches the output contract exactly.
3. WHEN annotating THEN the system SHALL produce an MP4 with the bounding box, the track
   trail, and live scores drawn on each frame.
4. WHEN a datastore is unreachable THEN the system SHALL surface a clear error and
   SHALL NOT silently drop results; local artifacts (summary JSON, MP4) SHALL still be
   written where possible.

## Requirement 10 — FastAPI service

**User story:** As the app, I want HTTP endpoints, so analysis and lookups are callable.

**Acceptance criteria:**

1. `POST /analyze` SHALL accept a video reference (local path or S3 key) plus `dog_id`
   and `day`, run the pipeline, and return the contract summary.
2. `GET /dogs/{dog_id}/profile` SHALL return the stored per-dog summary.
3. `GET /dogs/{dog_id}/trend` SHALL return the dog's trend across days.
4. Errors SHALL return appropriate HTTP status codes with clear messages.

## Requirement 11 — CLI and testability

**User story:** As the developer, I want every module runnable and testable on one
clip, so I can validate end-to-end tonight.

**Acceptance criteria:**

1. Each module (`ingest`, `track`, `features`, `scores`, `levels`, `store_tiger`,
   `store_mongo`, `annotate`) SHALL be invocable from `cli.py` on a single clip.
2. WHEN run end-to-end on one clip THEN the pipeline SHALL produce the contract summary,
   per-hour rows, and the annotated MP4.
3. A committed `pipeline/.env.example` SHALL document every required secret/config key.
