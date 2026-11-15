# Behavior intelligence extensions

This branch adds app-side review, context, intervention, export, and outcome records
in separate MongoDB collections. Pipeline-owned `dogs.events` and score history stay
unchanged. The app derives stable observation IDs from dog ID, day, event type, and
timestamps; reviews store the original machine label, reviewer, status, context,
note, and timestamp separately. Each subsequent review appends to `history`.

## Collections and routes

- `behavior_observation_reviews`: human review state and immutable review history.
  `GET/PATCH /api/behavior/reviews` lists and records confirmed, rejected, or
  corrected observations. `GET /behavior-review` is the staff queue.
- `behavior_session_contexts`: optional context keyed by dog and session. Context
  values are staff-entered; older sessions remain `unspecified` until recorded.
- `behavior_interventions`: staff actions and optional outcome notes. The
  `/interventions` page shows session score summaries around the recorded action,
  where available, and describes changes as associations rather than causes.
- `post_adoption_outcomes`: lightweight outcome contract. Records are not consumed
  by scoring or model training.
- `GET /api/behavior/export`: versioned JSON behavior record; `?format=csv` provides
  session score summaries. `?training=1` exports confirmed/corrected labels with
  provenance; no automatic retraining is performed.

## Evidence and quality limits

Event times and labels come from the pipeline `events` array and the stored annotated
video URL. Scores and comparisons come from the existing daily `history` summaries.
The current pipeline's persisted evidence contract contains clip duration, calm-time
fraction, and event counts, but not detector coverage or event-level confidence.
Accordingly the app reports quality as **Unrated** when coverage is absent and does
not assign event confidence. Context metadata is optional and is not retroactively
inferred. The export may only contain event details for the latest dog record because
older `history` entries currently store score summaries only.

## Fairness and transparency

The pipeline's `assert_no_breed` guard rejects breed-like source keys. `FormulaModel`
accepts `ClipFeatures`; formulas are deterministic hand-tuned rules. YOLO11 is
pretrained and ByteTrack associates detections. The evaluation's 86.7% is 13/15
hand-written score-band comparisons over five demo clips, not predictive accuracy.
The 4.6 second Kinder clip accounts for both mismatches. The optional SuperAnimal
pose prototype is separate from default scoring and off by default in the app.

`tests/test_label_robustness.py` checks that breed fields are rejected and that the
two-label pipeline audit calls the scorer without a breed or label input. External
Gemini comparisons remain separate, are reported with repeated-run spread, and do
not establish statistical significance.

Human confirmed/corrected observations are candidate labels for future reviewed
calibration or training work. They must be inspected and curated before use.
