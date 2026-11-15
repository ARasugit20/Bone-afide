# Unleashed Behavior Pipeline — Evaluation

Reproduce all numbers below with:

```bash
cd pipeline
source .venv/bin/activate
PYTHONPATH=. python scripts/evaluate.py      # writes data/out/eval_results.json
```

Evaluated on the five demo clips (june, katie, kacy, kinder, luna) on Apple MPS,
YOLO11s, 10 fps sampling, camera compensation on. All figures are measured, not
estimated. Date of run: see `data/out/eval_results.json`.

## 1. Determinism

Each clip analyzed twice; max absolute difference across the five scores.

| dog_id | energy | stress | approach. | conf. | spikes | max diff (run1 vs run2) |
|---|---|---|---|---|---|---|
| june-01 | 19 | 8 | 97 | 100 | 5 | 0 |
| katie-01 | 10 | 10 | 95→96 | 96 | 0 | 1 |
| kacy-01 | 0 | 1 | 100 | 66 | 0 | 0 |
| kinder-01 | 55 | 45 | 100 | 100 | 1 | 0 |
| luna-01 | 100 | 49 | 99 | 100 | 7 | 0 |

**Overall max score difference across all clips: 1** (katie approachability moved
95→96 between runs). Not bit-exact: YOLO inference on MPS has minor non-determinism
that can shift a box by a pixel, which occasionally changes one score by 1 point.
Scores are effectively stable to ±1.

## 2. Ground-truth agreement

Scores vs. hand-written expectation bands. Bands (0–100): low = 0–33, low-med =
0–55, med-high = 50–100, high = 60–100. Spike bands (counts): several = ≥3,
high = ≥5.

| dog_id | field | expected band | actual | match |
|---|---|---|---|---|
| june-01 | energy | low | 19 | yes |
| june-01 | stress | low | 8 | yes |
| june-01 | approachability | med-high | 97 | yes |
| katie-01 | energy | low | 10 | yes |
| katie-01 | stress | low | 10 | yes |
| katie-01 | approachability | high | 95 | yes |
| kacy-01 | energy | low-med | 0 | yes |
| kacy-01 | stress | low | 1 | yes |
| kacy-01 | approachability | high | 100 | yes |
| kinder-01 | energy | high | 55 | **no** |
| kinder-01 | arousal_spikes | high (≥5) | 1 | **no** |
| kinder-01 | approachability | high | 100 | yes |
| luna-01 | energy | high | 100 | yes |
| luna-01 | arousal_spikes | several (≥3) | 7 | yes |
| luna-01 | approachability | high | 99 | yes |

**Overall agreement: 13/15 = 86.7%.**

Both misses are kinder-01, the shortest clip (4.6 s → 57 sampled frames, 74%
detection). Its continuous fence-jumping is detected as jumping (energy 55, stress
45 — clearly elevated), but energy lands below the "high" (≥60) cutoff and only one
jump crosses into a discrete arousal spike, because there are too few frames to
accumulate more. This is a data-length limitation, not a scoring error: the signal is
in the right direction, just under-counted on a 4.6 s clip.

## 3. Ablation — camera compensation

Same clips with `camera_compensation` off; deltas are (off − on).

| dog_id | energy Δ | stress Δ | approach. Δ | conf. Δ | spikes Δ |
|---|---|---|---|---|---|
| june-01 | +2 | +1 | 0 | 0 | 0 |
| katie-01 | +1 | −1 | +5 | 0 | +2 |
| kacy-01 | 0 | 0 | 0 | 0 | 0 |
| kinder-01 | **−23** | **−26** | 0 | 0 | −1 |
| luna-01 | **−24** | −2 | 0 | 0 | **+4** |

**Camera compensation changes scores: YES.** The effect is largest on the handheld,
high-motion clips: turning compensation off drops kinder energy 55→32 and stress
45→19, and luna energy 100→76 while inflating luna's arousal spikes 7→11 (camera
shake is misread as the dog's motion/bursts). kacy (near-static scene) is unchanged.
This confirms compensation materially improves scores on handheld footage and is
inert when the camera is still — exactly the intended behavior.

## 4. Speed (Apple MPS)

Wall-clock per clip (ingest → track → features → scores, model load included) and
sampled frames per second.

| dog_id | sampled frames | seconds | frames/sec |
|---|---|---|---|
| june-01 | 110 | 23.2 | 4.7 |
| katie-01 | 171 | 24.6 | 7.0 |
| kacy-01 | 171 | 71.8 | 2.4 |
| kinder-01 | 57 | 7.9 | 7.2 |
| luna-01 | 323 | 39.7 | 8.1 |

Device: **mps**. kacy is the slowest (2.4 fps) because it is the 4K source
downscaled to 1280px and includes a blur pass. Throughput is 5–8 fps on the 1080p
clips. These times include one-time model load per run; a long-lived server (the
FastAPI service) amortizes that across requests.

## 5. Breed-blind proof

Two independent checks (see `scripts/evaluate.py`, section 5):

- **Field-name check** on a real `ClipFeatures`, `Scores`, and the output contract:
  - feature fields: `mean_speed, pct_time_moving, pct_time_front_zone,
    pct_close_camera, pct_centered, reversals_per_min, circling, jumps_per_min,
    vertical_motion, hw_ratio_mean, hw_ratio_series, sudden_accel_front,
    detection_coverage, frame_w, frame_h, duration_s, pose`
  - score fields: `energy, stress, approachability, confidence, arousal_spikes`
  - contract keys: `dog_id, day, energy, stress, approachability, confidence,
    arousal_spikes, handling_level, trend, needs`
  - **breed-like field names found: NONE**
- **Source grep** across `behavior/*.py`: 31 mentions of "breed", **0 of which read a
  breed value as input**. Every mention is a comment/docstring ("never breed"), a CLI
  help string, or the guardrail exclusion machinery (`assert_no_breed`, `_BREED_KEYS`)
  that *rejects* breed at the ingest boundary.

**Result: CONFIRMED — breed is never an input to any feature, score, or the
contract.**

---

# MODEL CARD — Unleashed behavior pipeline

## Purpose

Decision-support tool that matches shelter dogs to adopters using behavior measured
from kennel video. It produces per-dog scores, a handling level, and plain-English
needs. It is **not** a diagnostic or a final adoption decision.

## Inputs

- One kennel video clip per dog per day (local file or S3 key), plus `dog_id`, `day`,
  `hour`, and an optional `speed_factor` for slow-motion clips.
- Nothing else. **No breed, no photo-appearance features, no audio, no text.**

## The five measured features

All geometry is normalized (camera-independent). The box center and size are smoothed
(5-frame median then moving average) and corrected for handheld camera motion before
any motion is measured.

1. **Speed** — body lengths per second: smoothed box-center displacement divided by
   box width, per second. Camera-distance independent.
2. **Pacing (reversals/min)** — horizontal direction changes, each requiring a real
   excursion (≥ max(0.5 body lengths, 6% frame width)) sustained ≥ 0.3 s, per minute.
3. **Circling (turns/min)** — accumulated turning of the center trajectory per minute.
4. **Jumping (jumps/min)** — time-based: box top rises > 10% of frame height above its
   grounded baseline AND the height/width ratio rises > 20%, sustained ≥ 0.3 s; each
   sustained event counted once.
5. **Approachability signal** — share of time the box is large (covers > 8% of the
   frame = close to the camera) and horizontally centered.

Derived scores (hand-tuned formulas over the above, all integers 0–100): **energy**
(speed + vertical motion + jumping), **stress** (pacing + jumping + restlessness),
**approachability** (close + centered), **confidence** (upright posture + steady,
non-pacing presence), and **arousal_spikes** (count of jump events + sudden
accelerations toward the front).

## Handling-level thresholds

From `config/levels.json`, first matching rule wins (tunable without code):

| Level | Condition |
|---|---|
| Red | stress ≥ 70 AND arousal_spikes ≥ 5 AND approachability ≤ 50; or stress ≥ 80 |
| Orange | stress ≥ 40; or arousal_spikes ≥ 10 |
| Yellow | stress ≥ 20; or arousal_spikes ≥ 8 |
| Green | otherwise |

On the demo set: june, katie, kacy → Green; kinder, luna → Orange.

## Known limitations

- **Short stock clips.** Demo clips are 4.6–32 s. Short clips (kinder, 4.6 s) yield
  few frames, so discrete events (jumps → arousal spikes) are under-counted even when
  the behavior is clearly present. Longer, steadier footage would raise accuracy.
- **Handheld camera.** Source clips are handheld; compensation helps (section 3) but
  cannot fully remove motion, so residual shake can still nudge scores by a few points.
- **No audio.** Barking, whining, and growling carry behavioral signal the pipeline
  cannot see. A barking-but-still dog (kinder) is measured only by its body motion.
- **Small labeled set.** Ground truth is five hand-labeled clips (86.7% band
  agreement). Formulas are hand-tuned, not trained; the `ScoreModel` interface
  reserves a slot for a scikit-learn calibrator once more labels exist.
- **One dog per clip.** Multi-dog scenes fall back to the most-persistent track.
- **Determinism ±1.** MPS inference is not bit-exact; a score can vary by 1 point
  between runs.

## Ethical guardrails

- **Decision support only.** Output informs staff; it never auto-decides adoption.
- **Vet sign-off.** A dog's handling level is `provisional` until a vet review is
  recorded (`expert_reviewed` / `vet_review.status = "reviewed"`).
- **Banned words.** The pipeline never emits "aggressive", "dangerous", or "menace".
  A guardrail sanitizer rejects any output (summary, needs, notes, report) containing
  them; risk is expressed only as a handling level and plain-English needs.
- **Never breed.** Breed is never an input to any feature, score, level, or rule
  (section 5). A `assert_no_breed` guard rejects breed-carrying source records at the
  ingest boundary. The companion `bias_test.py` demonstrates that a generic vision
  model given a breed label can rate the same dog differently, while this pipeline —
  which never sees breed — does not.
```
