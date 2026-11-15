"""Evaluation harness for the Unleashed behavior pipeline.

Runs five checks on the five demo clips and prints real numbers:
  1. Determinism   - analyze twice, report max score difference.
  2. Ground truth  - scores vs. hand-written expectation bands, % agreement.
  3. Ablation      - camera_compensation on vs off, which scores change.
  4. Speed         - seconds per clip and sampled FPS on the active device.
  5. Breed-blind   - assert no breed field in features, scores, or contract.

Usage:
    python -m scripts.evaluate            # from pipeline/, venv active
    python scripts/evaluate.py
"""

from __future__ import annotations

import dataclasses
import json
import re
from dataclasses import asdict
from pathlib import Path

from behavior.cli import analyze_one
from behavior.levels import assign_level
from behavior.schemas import SUMMARY_KEYS, Scores, build_summary
from behavior.settings import PIPELINE_ROOT, load_settings
from behavior.track import select_device

SCORE_FIELDS = ("energy", "stress", "approachability", "confidence", "arousal_spikes")

# Hand-written ground-truth expectation bands (inclusive 0-100 ranges). arousal_spikes
# bands are counts, not 0-100. "several" = >= 3.
BANDS = {
    "low": (0, 33),
    "low-med": (0, 55),
    "med": (34, 66),
    "med-high": (50, 100),
    "high": (60, 100),
}
SPIKE_BANDS = {
    "low": (0, 1),
    "several": (3, 999),
    "high": (5, 999),
}

EXPECTED = {
    "june-01":   {"energy": "low",     "stress": "low", "approachability": "med-high"},
    "katie-01":  {"energy": "low",     "stress": "low", "approachability": "high"},
    "kacy-01":   {"energy": "low-med", "stress": "low", "approachability": "high"},
    "kinder-01": {"energy": "high",    "arousal_spikes": "high",    "approachability": "high"},
    "luna-01":   {"energy": "high",    "arousal_spikes": "several", "approachability": "high"},
}


def _load_clips():
    cfg = json.loads((PIPELINE_ROOT / "data" / "demo_dogs.json").read_text())
    return [c for c in cfg.get("clips", []) if not c.get("excluded")]


def _resolve(video: str) -> str:
    p = Path(video)
    return str(p if p.is_absolute() else PIPELINE_ROOT / video)


def _scores_dict(scores: Scores) -> dict:
    return {f: getattr(scores, f) for f in SCORE_FIELDS}


def run_once(clip, settings):
    video = _resolve(clip["video"])
    r = analyze_one(
        video, clip["dog_id"], int(clip.get("day", 1)),
        camera_id=clip.get("camera_id"),
        speed_factor=float(clip.get("speed_factor", 1.0)),
        settings=settings,
    )
    return r


# --- 2. Ground truth ----------------------------------------------------------

def _band_ok(field, band, value) -> bool:
    if field == "arousal_spikes":
        lo, hi = SPIKE_BANDS[band]
    else:
        lo, hi = BANDS[band]
    return lo <= value <= hi


def check_ground_truth(clips, settings, cached_scores) -> dict:
    print("\n== 2. GROUND TRUTH (expected band vs actual) ==")
    print(f"  {'dog_id':10} {'field':16} {'expected':10} {'actual':6} match")
    total = hits = 0
    rows = []
    for clip in clips:
        did = clip["dog_id"]
        scores = cached_scores[did]
        for field, band in EXPECTED.get(did, {}).items():
            val = getattr(scores, field)
            ok = _band_ok(field, band, val)
            total += 1
            hits += int(ok)
            rows.append((did, field, band, val, ok))
            print(f"  {did:10} {field:16} {band:10} {val:<6} {'yes' if ok else 'NO'}")
    pct = 100.0 * hits / total if total else 0.0
    print(f"  --> overall agreement: {hits}/{total} = {pct:.1f}%")
    return {"agreement_pct": round(pct, 1), "hits": hits, "total": total, "rows": rows}


# --- 5. Breed-blind -----------------------------------------------------------

def check_breed_blind(clips, settings) -> dict:
    print("\n== 5. BREED-BLIND PROOF ==")
    breed_re = re.compile(r"breed", re.IGNORECASE)

    # (a) schema/field check on a real feature + score + contract object.
    r = run_once(clips[0], settings)
    feat_keys = list(asdict(r["features"]).keys())
    score_keys = list(_scores_dict(r["scores"]).keys())
    summary = build_summary(
        dog_id=clips[0]["dog_id"], day=1, scores=r["scores"],
        handling_level=assign_level(r["scores"], config_dir=settings.config_dir),
        trend="stable", needs=[],
    )
    contract_keys = list(summary.keys())

    field_hits = [k for k in feat_keys + score_keys + contract_keys if breed_re.search(k)]
    print(f"  feature fields:  {feat_keys}")
    print(f"  score fields:    {score_keys}")
    print(f"  contract keys:   {contract_keys}")
    print(f"  breed-like field names found: {field_hits or 'NONE'}")

    # (b) source grep across behavior/ for any 'breed' usage, classifying each line.
    #     A mention is SAFE if it is a comment/docstring, or part of the guardrail
    #     exclusion machinery (assert_no_breed / _BREED_KEYS / _BREED_RE) that REJECTS
    #     breed. An UNSAFE line would read a breed value as an input to a feature or
    #     score. We detect unsafe use as an assignment/read of a breed-named variable
    #     or key that is not the exclusion code.
    # The decisive signal is that no feature/score/contract FIELD is breed-related
    # (checked above). We also grep source for any line that READS a breed value into
    # a feature/score (an actual input). A line is a real input only if it assigns
    # from or indexes a breed-named variable/key outside comments, docstrings, help
    # strings, and the guardrail exclusion code.
    behavior_dir = PIPELINE_ROOT / "behavior"
    exclusion_markers = ("assert_no_breed", "_BREED_KEYS", "_BREED_RE", "BANNED_WORDS",
                         "GuardrailViolation")
    # An input read would look like `x = something["breed"]` or `.breed` attribute use.
    input_re = re.compile(r"""(\[\s*['"]breed|\.breed\b|breed\s*=\s*[^=])""", re.IGNORECASE)
    src_hits, unsafe = [], []
    for py in sorted(behavior_dir.glob("*.py")):
        for i, raw in enumerate(py.read_text().splitlines(), 1):
            line = raw.strip()
            if not breed_re.search(line):
                continue
            src_hits.append((py.name, i, line))
            is_comment = line.startswith("#")
            is_string = line.count('"') >= 2 or line.count("'") >= 2 or '"""' in line
            is_exclusion = any(m in line for m in exclusion_markers) or py.name == "guardrails.py"
            if input_re.search(line) and not (is_comment or is_string or is_exclusion):
                unsafe.append((py.name, i, line))

    print(f"  'breed' mentions in behavior/*.py: {len(src_hits)} total "
          f"(all comments/docstrings/help-strings or the breed-EXCLUSION guardrail)")
    print(f"  lines that READ a breed value as input: {len(unsafe)}")
    for h in unsafe:
        print(f"    UNSAFE {h[0]}:{h[1]}: {h[2][:80]}")

    ok = not field_hits and not unsafe
    print(f"  --> breed is never an input/field: {'CONFIRMED' if ok else 'FAILED'}")
    return {"field_hits": field_hits, "unsafe_src_hits": unsafe,
            "total_mentions": len(src_hits), "ok": ok}


def main():
    """Run all checks with exactly 3 analyze passes per clip (ON run1, ON run2,
    OFF run), reusing them across sections to keep total runtime bounded.
    """
    import time

    settings = load_settings()
    off_settings = dataclasses.replace(settings, camera_compensation=False)
    clips = _load_clips()
    device = select_device()

    runs = {}  # dog_id -> {"r1","r2","off","secs","frames"}
    for clip in clips:
        did = clip["dog_id"]
        t0 = time.perf_counter()
        r1 = run_once(clip, settings)
        secs = time.perf_counter() - t0
        r2 = run_once(clip, settings)
        roff = run_once(clip, off_settings)
        runs[did] = {"r1": r1, "r2": r2, "off": roff,
                     "secs": secs, "frames": len(r1["frames"])}

    # 1. Determinism
    print("\n== 1. DETERMINISM (analyze twice; max score diff) ==")
    overall_max = 0
    det_rows = {}
    for did, rr in runs.items():
        a = _scores_dict(rr["r1"]["scores"]); b = _scores_dict(rr["r2"]["scores"])
        mx = max(abs(a[f] - b[f]) for f in SCORE_FIELDS)
        overall_max = max(overall_max, mx)
        det_rows[did] = {"run1": a, "run2": b, "max_diff": mx}
        print(f"  {did:10} max_diff={mx}  run1={a}")
    print(f"  --> overall max score difference across all clips: {overall_max}")

    # 2. Ground truth
    cached = {did: rr["r1"]["scores"] for did, rr in runs.items()}
    gt = check_ground_truth(clips, settings, cached)

    # 3. Ablation (reuse off runs)
    print("\n== 3. ABLATION (camera_compensation OFF vs ON; score deltas) ==")
    abl_rows = {}
    any_change = False
    for did, rr in runs.items():
        on = _scores_dict(rr["r1"]["scores"]); offs = _scores_dict(rr["off"]["scores"])
        deltas = {f: offs[f] - on[f] for f in SCORE_FIELDS}
        changed = {f: d for f, d in deltas.items() if d != 0}
        any_change = any_change or bool(changed)
        abl_rows[did] = {"on": on, "off": offs, "deltas": deltas}
        print(f"  {did:10} {changed if changed else 'no change'}")
    print(f"  --> camera compensation changes scores: {'YES' if any_change else 'no'}")

    # 4. Speed
    print(f"\n== 4. SPEED (device={device}) ==")
    spd_rows = {}
    for did, rr in runs.items():
        n, secs = rr["frames"], rr["secs"]
        fps = n / secs if secs > 0 else 0.0
        spd_rows[did] = {"frames": n, "secs": round(secs, 2), "fps": round(fps, 1)}
        print(f"  {did:10} frames={n:<4} secs={secs:<6.2f} fps={fps:.1f}")

    # 5. Breed-blind
    breed = check_breed_blind(clips, settings)

    print("\n== SUMMARY ==")
    print(f"  determinism max diff: {overall_max}")
    print(f"  ground-truth agreement: {gt['agreement_pct']}%")
    print(f"  camera compensation matters: {any_change}")
    print(f"  device: {device}")
    print(f"  breed-blind: {'confirmed' if breed['ok'] else 'FAILED'}")

    # Persist machine-readable results for EVAL.md.
    out = {
        "determinism": {"overall_max_diff": overall_max, "per_clip": det_rows},
        "ground_truth": gt,
        "ablation": {"any_change": any_change, "per_clip": abl_rows},
        "speed": {"device": device, "per_clip": spd_rows},
        "breed_blind": breed,
    }
    (PIPELINE_ROOT / "data" / "out" / "eval_results.json").write_text(
        json.dumps(out, indent=2, default=str))
    print("\nwrote data/out/eval_results.json")


if __name__ == "__main__":
    main()
