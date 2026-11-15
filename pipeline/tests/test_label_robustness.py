from behavior.bias_test import run_pipeline_twice
from behavior.guardrails import GuardrailViolation, assert_no_breed


def test_behavior_pipeline_rejects_breed_fields():
    for key in ("breed", "breeds", "breed_name", "dog_breed", "primary_breed"):
        try:
            assert_no_breed({key: "Labrador"})
        except GuardrailViolation:
            continue
        raise AssertionError(f"breed field {key!r} was accepted")


def test_pipeline_scores_do_not_receive_the_supplied_label():
    calls = []

    def analyze(**kwargs):
        calls.append(kwargs)
        return {"scores": {"energy": 20, "stress": 10, "approachability": 70, "confidence": 80, "arousal_spikes": 1}}

    result = run_pipeline_twice("clip.mp4", "demo-01", 1, analyze=analyze)
    assert result["identical"] is True
    assert len(calls) == 2
    assert all("breed" not in call and "label" not in call for call in calls)
