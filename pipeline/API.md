# Unleashed Behavior Pipeline — API

FastAPI service exposing the behavior pipeline to the frontend.

## Run

```bash
cd pipeline
source .venv/bin/activate
uvicorn behavior.api:app --host 0.0.0.0 --port 8000 --reload
```

Base URL in these examples: `http://localhost:8000`.

## Notes for the frontend

- **CORS** is open to all origins (hackathon setting).
- **Auth** is off by default. If `REQUIRE_AUTH=1` is set in `pipeline/.env`, all
  endpoints except `/health` and `/videos/{name}` require a Cognito JWT in an
  `Authorization: Bearer <token>` header (verified against the pool's JWKS using
  `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `COGNITO_REGION`). Leave it off
  for now.
- **Contract**: every per-dog summary has exactly these keys, in this order:
  `dog_id, day, energy, stress, approachability, confidence, arousal_spikes,
  handling_level, trend, needs`. Scores are integers 0–100. `handling_level` is one
  of `Green, Yellow, Orange, Red`. `trend` is one of `improving, stable, worsening`.
- **Provisional vs reviewed**: a dog's `handling_level` is provisional until a vet
  review is recorded. `GET /dogs/{dog_id}/profile` adds a `level_status` field
  (`"provisional"` or `"reviewed"`) so the UI can badge it.
- **Guardrails**: risk is only ever expressed as a handling level or a plain-English
  need. Posting text containing a banned word returns `400 {"detail": "text rejected
  by content guardrail"}`.

---

## 1. `GET /health`

Liveness plus datastore reachability.

```bash
curl http://localhost:8000/health
```

```json
{"ok": true, "mongo": true, "tiger": true}
```

## 2. `GET /dogs`

All dogs (contract fields only, no history). Returns only the five real demo dogs
unless `?all=true`.

```bash
curl http://localhost:8000/dogs
curl "http://localhost:8000/dogs?all=true"
```

```json
[
  {
    "dog_id": "june-01",
    "approachability": 97,
    "arousal_spikes": 5,
    "confidence": 100,
    "day": 1,
    "energy": 19,
    "handling_level": "Green",
    "needs": ["great for apartments / first-time owners", "enjoys meeting new people"],
    "stress": 8,
    "trend": "stable"
  }
]
```

## 3. `GET /dogs/{dog_id}/profile`

Full Mongo document: contract fields + `history` array + `events` + `welfare` +
`staff_notes`/`vet_review` if present + a derived `level_status`. `404` if the dog is
unknown. (`GET /dogs/{dog_id}` returns this same document.)

The **`welfare`** field is a kennel-decline alert computed from the dog's last 3
Tiger sessions: `{status, sessions, stress_change, message}`. `status` is
`rising_stress` (stress up ≥10 points over the last 3 sessions), `improving` (down
≥10), or `stable`. With fewer than 3 sessions, `status` is `stable` and `message` is
"Not enough sessions yet". `message` is plain staff-facing text.

```bash
curl http://localhost:8000/dogs/luna-01/profile
```

Real response for luna-01 (Lola):

```json
{
  "dog_id": "luna-01",
  "day": 4,
  "energy": 100,
  "stress": 49,
  "approachability": 99,
  "confidence": 100,
  "arousal_spikes": 7,
  "handling_level": "Orange",
  "trend": "stable",
  "needs": ["active home with daily exercise", "owner comfortable with an excitable dog"],
  "history": [{ "day": 1, "energy": 100, "stress": 49, "...": "..." }],
  "name": "Lola",
  "level_status": "provisional",
  "events": [
    {"type": "calm", "start_s": 0.7, "end_s": 7.63, "label": "Watching calmly from the back"}
  ],
  "welfare": {
    "status": "rising_stress",
    "sessions": 4,
    "stress_change": 32,
    "message": "Stress up 32 points over 3 sessions. Consider a quieter kennel or foster priority."
  }
}
```

## 4. `GET /dogs/{dog_id}/trend`

Time-series rows from Tiger Data (`store_tiger.get_trend`). `502` if Tiger is not
configured.

```bash
curl http://localhost:8000/dogs/luna-01/trend
```

```json
{
  "dog_id": "luna-01",
  "rows": [
    {
      "bucket": "2026-11-02T00:00:00Z",
      "dog_id": "luna-01",
      "avg_stress": 49.0,
      "avg_energy": 100.0,
      "avg_approachability": 99.0,
      "avg_confidence": 100.0,
      "total_spikes": 7
    }
  ]
}
```

## 4b. `GET /dogs/{dog_id}/events`

Behavior evidence timeline: timestamped events detected from the dog's motion, for
building a scrubbable timeline next to the annotated video. `404` if the dog is
unknown; returns an empty `events` list if none were detected.

Each event is `{type, start_s, end_s, label}`. `type` is one of `jump`, `reversal`,
`acceleration`, `calm`. `start_s`/`end_s` are seconds from clip start. `label` is a
short plain-English phrase (guardrail-safe: never "aggressive"/"dangerous"/"menace",
never breed). Same-type events closer than 1 s are merged; at most 12 events (the
longest) are returned, sorted by `start_s`.

```bash
curl http://localhost:8000/dogs/luna-01/events
```

Real response for luna-01 (Lola):

```json
{
  "dog_id": "luna-01",
  "events": [
    {"type": "jump", "start_s": 1.85, "end_s": 2.13, "label": "Jumped up at the fence"},
    {"type": "acceleration", "start_s": 3.7, "end_s": 3.75, "label": "Rushed toward the front"},
    {"type": "acceleration", "start_s": 7.33, "end_s": 7.58, "label": "Rushed toward the front"}
  ]
}
```

## 5. `POST /analyze`

Multipart upload: analyze one clip end-to-end — scores, level, needs, events,
welfare, Tiger reading, Mongo summary, and annotated video. Returns quickly; the S3
upload of the thumbnail and video runs **after** the response, then the dog doc's
`media_status` flips from `pending` to `complete` (and `photo`/`video_url` are set).
`400` if analysis fails.

An uploaded dog must use a `dog_id` starting with **`upload-`** (e.g. `upload-rex-01`);
these are owned and fully persisted. The response includes a `stored` block showing
what was written: `mongo` (bool), `tiger` (bool), `s3` (`"pending"` while the
background upload runs, `"skipped"` if Mongo failed).

Form fields: `video` (file, required), `dog_id` (required, `upload-…`), `day` (int,
required), `hour` (int, required), `speed_factor` (float, optional, default 1.0; use
4 for slow-motion), `name` (string, optional; defaults to the capitalized dog_id stem).

```bash
curl -X POST http://localhost:8000/analyze \
  -F "video=@kennel_clip.mp4" \
  -F "dog_id=upload-rex-01" -F "day=1" -F "hour=9" -F "speed_factor=1.0" -F "name=Rex"
```

```json
{
  "summary": {
    "dog_id": "upload-rex-01", "day": 1, "energy": 42, "stress": 20,
    "approachability": 80, "confidence": 70, "arousal_spikes": 1,
    "handling_level": "Green", "trend": "stable",
    "needs": ["enjoys meeting new people"]
  },
  "name": "Rex",
  "events": [
    {"type": "calm", "start_s": 2.1, "end_s": 8.7, "label": "Calm and settled"}
  ],
  "welfare": {"status": "stable", "sessions": 1, "stress_change": 0, "message": "Not enough sessions yet"},
  "annotated_url": "/videos/upload-rex-01_day1_1794731038_kennel_clip_annotated.mp4",
  "stored": {"mongo": true, "tiger": true, "s3": "pending"}
}
```

Poll `GET /dogs/{dog_id}` until `media_status` is `complete` to get the S3 `photo`
and `video_url`.

## 6. `GET /videos/{name}`

Serves an annotated MP4 from `data/out/` so the frontend can play the clip with the
tracking box and live scores. `404` if not found. Supports range requests.

```bash
curl http://localhost:8000/videos/luna_annotated.mp4 --output luna.mp4
```

```
HTTP/1.1 200 OK
content-type: video/mp4
accept-ranges: bytes
```

Use directly in the UI: `<video src="http://localhost:8000/videos/luna_annotated.mp4" controls>`.

## 7a. `POST /dogs/{dog_id}/staff-notes`

Append a staff note. JSON body `{author, note}`. Text is guardrail-sanitized.
`400` on missing fields or banned words; `404` if the dog is unknown.

```bash
curl -X POST http://localhost:8000/dogs/luna-01/staff-notes \
  -H 'Content-Type: application/json' \
  -d '{"author": "Sam", "note": "friendly at the gate"}'
```

```json
{"ok": true, "staff_notes": [{"author": "Sam", "note": "friendly at the gate"}]}
```

## 7b. `POST /dogs/{dog_id}/vet-review`

Record a vet review. JSON body `{vet_name, confirmed_level, comment}`. Sets
`vet_review.status = "reviewed"`; afterwards the profile's `level_status` becomes
`"reviewed"`. Text is guardrail-sanitized.

```bash
curl -X POST http://localhost:8000/dogs/luna-01/vet-review \
  -H 'Content-Type: application/json' \
  -d '{"vet_name": "Dr Lee", "confirmed_level": "Orange", "comment": "agree with assessment"}'
```

```json
{"ok": true, "vet_review": {"vet_name": "Dr Lee", "confirmed_level": "Orange", "comment": "agree with assessment", "status": "reviewed"}}
```

## 8. `GET /bias/{dog_id}`

Returns `data/out/bias/<dog_id>.json` if it exists (produced by Claude Code's bias
tooling), else `404 {"detail": "bias report not available yet"}`.

```bash
curl http://localhost:8000/bias/luna-01
```

## 9. `GET /dogs/{dog_id}/report`

If the `behavior.report` module exists, returns `report.generate_report(dog_id)`
(cached). Otherwise `404 {"detail": "report not available yet"}`.

```bash
curl http://localhost:8000/dogs/luna-01/report
```
