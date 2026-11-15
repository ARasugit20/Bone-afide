"""Report tests with Gemini, Bedrock, Mongo and Tiger all mocked."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from behavior import report as rp
from behavior.guardrails import GuardrailViolation

CONTRACT = {
    "dog_id": "luna-01", "day": 1, "energy": 100, "stress": 49, "approachability": 99,
    "confidence": 100, "arousal_spikes": 7, "handling_level": "Orange", "trend": "stable",
    "needs": ["active home with daily exercise", "calm, predictable routine"],
    "staff_notes": [{"author": "a", "note": "private"}], "history": [],
}
TREND = [
    {"bucket": datetime(2026, 11, 2, tzinfo=timezone.utc), "dog_id": "luna-01",
     "avg_stress": 55.0, "avg_energy": 90.0, "avg_approachability": 95.0,
     "avg_confidence": 98.0, "total_spikes": 9},
    {"bucket": datetime(2026, 11, 3, tzinfo=timezone.utc), "dog_id": "luna-01",
     "avg_stress": 49.0, "avg_energy": 100.0, "avg_approachability": 99.0,
     "avg_confidence": 100.0, "total_spikes": 7},
]
BODY = ("Luna is a high-energy dog with moderate stress who seeks people out. "
        "She approaches the front of the kennel readily and shows high confidence. "
        "She had seven brief arousal spikes, so greet her calmly and keep sessions short. "
        "Her handling level is Orange: use experienced handlers and a predictable routine. "
        "She needs an active home with daily exercise. Stress eased slightly from day one "
        "to day two, so the trend is stable for now and worth rechecking tomorrow.")
UPDATED = BODY.replace("Luna is", "Updated: Luna is")


def _gemini(text=BODY, error=None):
    client = MagicMock()
    if error:
        client.models.generate_content.side_effect = error
    else:
        client.models.generate_content.return_value = SimpleNamespace(text=text)
    return rp.GeminiProvider("key", "gemini-test", client=client), client


def _bedrock(text=BODY, error=None):
    client = MagicMock()
    if error:
        client.converse.side_effect = error
    else:
        client.converse.return_value = {
            "output": {"message": {"content": [{"text": text}]}}}
    return rp.BedrockProvider("bedrock-test", "us-west-2", client=client), client


def _run(tmp_path, provider, **kw):
    return rp.generate_report(
        "luna-01", provider=provider, out_dir=tmp_path,
        load_contract=lambda d: dict(CONTRACT), load_trend=lambda d: list(TREND), **kw)


# --- prompt -------------------------------------------------------------------

def test_prompt_has_contract_and_trend_but_not_private_fields():
    p = rp.build_prompt(CONTRACT, TREND)
    for needle in ('"handling_level": "Orange"', '"arousal_spikes": 7', "2026-11-02",
                   '"avg_stress": 55.0', "about 120 words", rp.DISCLAIMER,
                   "Never mention breed"):
        assert needle in p, needle
    assert "staff_notes" not in p and "private" not in p


def test_prompt_rejects_breed_input():
    with pytest.raises(GuardrailViolation):
        rp.build_prompt({**CONTRACT, "breed": "x"}, TREND)


def test_single_day_trend_is_flagged():
    assert "Only one day so far" in rp.build_prompt(CONTRACT, TREND[:1])


# --- providers: same prompt, same post-processing ------------------------------

def test_both_providers_get_identical_prompt_and_output(tmp_path):
    g, gclient = _gemini()
    b, bclient = _bedrock()
    out_g = _run(tmp_path / "g", g)
    out_b = _run(tmp_path / "b", b)

    gprompt = gclient.models.generate_content.call_args.kwargs["contents"]
    bprompt = bclient.converse.call_args.kwargs["messages"][0]["content"][0]["text"]
    assert gprompt == bprompt == rp.build_prompt(CONTRACT, TREND)
    assert bclient.converse.call_args.kwargs["modelId"] == "bedrock-test"
    assert out_g == out_b == f"{BODY}\n\n{rp.DISCLAIMER}\n"


def test_make_provider_switch(monkeypatch):
    monkeypatch.setattr(rp, "load_settings", lambda: None)
    monkeypatch.setenv("REPORT_PROVIDER", "nope")
    with pytest.raises(rp.ReportError):
        rp.make_provider()
    monkeypatch.setenv("BEDROCK_MODEL_ID", "")
    with pytest.raises(rp.ReportError, match="BEDROCK_MODEL_ID"):
        rp.make_provider("bedrock")


# --- post-processing -------------------------------------------------------------

def test_disclaimer_is_not_duplicated_and_paraphrase_is_replaced():
    assert rp.postprocess(f"{BODY} {rp.DISCLAIMER}").count(rp.DISCLAIMER) == 1
    out = rp.postprocess(f"{BODY}\nScores are decision support only, ask a vet.")
    assert out.endswith(rp.DISCLAIMER + "\n") and "ask a vet" not in out


def test_truncated_replies_are_rejected_and_not_cached(tmp_path):
    # Gemini says it hit the token limit.
    client = MagicMock()
    client.models.generate_content.return_value = SimpleNamespace(
        text=BODY, candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="MAX_TOKENS"))])
    with pytest.raises(rp.ReportError, match="cut off"):
        _run(tmp_path, rp.GeminiProvider("k", "m", client=client))
    # Bedrock says it hit the token limit.
    b, bclient = _bedrock()
    bclient.converse.return_value = {"stopReason": "max_tokens",
                                     "output": {"message": {"content": [{"text": BODY}]}}}
    with pytest.raises(rp.ReportError, match="cut off"):
        _run(tmp_path, b)
    # A suspiciously short reply, e.g. "On Day 1, Luna displays energy (10".
    g, _ = _gemini(text="On Day 1, Luna displays maximum energy (10")
    with pytest.raises(rp.ReportError, match="too short"):
        _run(tmp_path, g)
    assert not (tmp_path / "luna-01.md").exists()


@pytest.mark.parametrize("bad", [BODY + " She can be aggressive at the gate.",
                                 BODY + " Typical of the breed, she is lively."])
def test_guardrail_violation_is_not_cached(tmp_path, bad):
    g, _ = _gemini(text=bad)
    with pytest.raises(GuardrailViolation):
        _run(tmp_path, g)
    assert not (tmp_path / "luna-01.md").exists()


# --- caching -----------------------------------------------------------------------

def test_cache_is_reused_unless_refresh(tmp_path):
    g, client = _gemini()
    first = _run(tmp_path, g)
    assert (tmp_path / "luna-01.md").read_text() == first
    assert _run(tmp_path, g) == first
    assert client.models.generate_content.call_count == 1

    client.models.generate_content.return_value = SimpleNamespace(text=UPDATED)
    assert _run(tmp_path, g, refresh=True).startswith("Updated: Luna")
    assert client.models.generate_content.call_count == 2


def test_missing_contract_raises(tmp_path):
    g, _ = _gemini()
    with pytest.raises(rp.ReportError, match="no contract"):
        rp.generate_report("ghost-01", provider=g, out_dir=tmp_path,
                           load_contract=lambda d: None, load_trend=lambda d: [])


def test_bad_dog_id_rejected(tmp_path):
    with pytest.raises(rp.ReportError):
        rp.report_path("../etc/passwd", tmp_path)


# --- quota: stop immediately, no retry ---------------------------------------------

def test_gemini_quota_stops_without_retry(tmp_path):
    g, client = _gemini(error=Exception("429 RESOURCE_EXHAUSTED. quota exceeded"))
    with pytest.raises(rp.QuotaExceeded, match="not retrying"):
        _run(tmp_path, g)
    assert client.models.generate_content.call_count == 1
    assert not (tmp_path / "luna-01.md").exists()


def test_bedrock_throttling_stops_without_retry(tmp_path):
    err = Exception("An error occurred (ThrottlingException) when calling Converse")
    err.response = {"Error": {"Code": "ThrottlingException"},
                    "ResponseMetadata": {"HTTPStatusCode": 429}}
    b, client = _bedrock(error=err)
    with pytest.raises(rp.QuotaExceeded):
        _run(tmp_path, b)
    assert client.converse.call_count == 1


def test_cli_quota_exit_code(monkeypatch, capsys):
    def boom(*a, **k):
        raise rp.QuotaExceeded("Gemini quota hit; not retrying.")
    monkeypatch.setattr(rp, "generate_report", boom)
    assert rp.main(["--dog-id", "luna-01"]) == 3
    assert "QUOTA" in capsys.readouterr().err
