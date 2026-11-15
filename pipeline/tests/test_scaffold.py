"""Task 1 scaffold tests: guardrails, schemas/contract, and settings.

These exercise only pure-Python scaffolding and need no model weights, network,
or sample clip.
"""

from __future__ import annotations

import pytest

from behavior import guardrails, schemas, settings


# --- guardrails ---------------------------------------------------------------

@pytest.mark.parametrize("word", ["aggressive", "dangerous", "menace"])
def test_sanitize_rejects_banned_words(word):
    with pytest.raises(guardrails.GuardrailViolation):
        guardrails.sanitize({"needs": [f"this dog is {word}"]})


def test_sanitize_is_case_insensitive():
    with pytest.raises(guardrails.GuardrailViolation):
        guardrails.sanitize("DANGEROUS behavior")


def test_sanitize_passes_clean_text():
    obj = {"needs": ["active home", "no cats yet"], "handling_level": "Yellow"}
    assert guardrails.sanitize(obj) is obj


def test_sanitize_allows_substrings_of_banned_words():
    # whole-word match only; "aggregate" contains no banned word boundary hit
    guardrails.sanitize("aggregate the scores")


def test_assert_no_breed_rejects_breed_key():
    with pytest.raises(guardrails.GuardrailViolation):
        guardrails.assert_no_breed({"dog_id": "max-01", "breed": "lab"})


def test_assert_no_breed_passes_without_breed():
    rec = {"dog_id": "max-01", "day": 3}
    assert guardrails.assert_no_breed(rec) is rec


# --- schemas / contract -------------------------------------------------------

def _scores(**kw):
    base = dict(energy=62, stress=31, approachability=74, confidence=58, arousal_spikes=2)
    base.update(kw)
    return schemas.Scores(**base)


def test_build_summary_matches_contract_shape_and_order():
    summary = schemas.build_summary(
        dog_id="max-01",
        day=3,
        scores=_scores(),
        handling_level="Yellow",
        trend="improving",
        needs=["active home", "no cats yet"],
    )
    assert list(summary.keys()) == list(schemas.SUMMARY_KEYS)
    assert summary == {
        "dog_id": "max-01",
        "day": 3,
        "energy": 62,
        "stress": 31,
        "approachability": 74,
        "confidence": 58,
        "arousal_spikes": 2,
        "handling_level": "Yellow",
        "trend": "improving",
        "needs": ["active home", "no cats yet"],
    }


def test_build_summary_rejects_out_of_range_score():
    with pytest.raises(ValueError):
        schemas.build_summary(
            dog_id="x", day=1, scores=_scores(energy=101),
            handling_level="Green", trend="stable", needs=[],
        )


def test_build_summary_rejects_bad_enum():
    with pytest.raises(ValueError):
        schemas.build_summary(
            dog_id="x", day=1, scores=_scores(),
            handling_level="Purple", trend="stable", needs=[],
        )
    with pytest.raises(ValueError):
        schemas.build_summary(
            dog_id="x", day=1, scores=_scores(),
            handling_level="Green", trend="better", needs=[],
        )


def test_build_summary_rejects_banned_need():
    with pytest.raises(guardrails.GuardrailViolation):
        schemas.build_summary(
            dog_id="x", day=1, scores=_scores(),
            handling_level="Green", trend="stable", needs=["dangerous around kids"],
        )


def test_clipfeatures_pose_seam_defaults_none():
    feats = schemas.ClipFeatures()
    assert feats.pose is None


# --- settings -----------------------------------------------------------------

def test_load_settings_defaults():
    s = settings.load_settings()
    assert s.sample_fps == 2.0 or isinstance(s.sample_fps, float)
    assert s.dog_class_id == 16
    assert s.mongo_db  # non-empty default
    assert s.config_dir.name == "config"
