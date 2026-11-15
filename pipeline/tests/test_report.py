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
BODY = ("Luna is a high-energy dog (energy 100/100) with moderate stress (49/100) who "
        "seeks people out. Her approachability is 99/100 and her confidence 100/100. "
        "She had 7 brief arousal spikes, so greet her calmly and keep sessions short. "
        "Her handling level is Orange: use experienced handlers. She needs an active home "
        "with daily exercise and a calm, predictable routine. Stress eased slightly from "
        "day one to day two, so the trend is stable for now and worth rechecking tomorrow.")
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


def _run(tmp_path, provider, saved=None, dog_id="luna-01", **kw):
    """Run generate_report fully offline; Mongo writes go into ``saved``."""
    saved = [] if saved is None else saved

    def fake_save(d, update):
        saved.append((d, update))
        return True

    kw.setdefault("save_report", fake_save)
    return rp.generate_report(
        dog_id, provider=provider, out_dir=tmp_path,
        load_contract=lambda d: {**CONTRACT, "dog_id": d, "name": "Luna"},
        load_trend=lambda d: list(TREND), **kw)


# --- prompt -------------------------------------------------------------------

def test_prompt_has_contract_and_trend_but_not_private_fields():
    p = rp.build_prompt(CONTRACT, TREND)
    for needle in ('"handling_level": "Orange"', '"arousal_spikes": 7', "2026-11-02",
                   '"avg_stress": 55.0', "100-130 words", rp.DISCLAIMER,
                   "Never mention breed", "warm but professional"):
        assert needle in p, needle
    assert "staff_notes" not in p and "private" not in p


def test_prompt_uses_name_requires_every_fact_and_hides_id():
    p = rp.build_prompt(CONTRACT, TREND)
    assert 'about Luna' in p and 'Refer to the dog as "Luna"' in p
    assert "luna-01" not in p  # the ID never reaches the model
    for needle in ("Energy 100/100", "stress 49/100", "approachability 99/100",
                   "confidence 100/100", "7 arousal spike", "handling level: Orange",
                   'trend: "stable"',
                   "active home with daily exercise; calm, predictable routine"):
        assert needle in p, needle


def test_name_falls_back_to_dog_id_stem_or_stored_name():
    assert rp.dog_name({"dog_id": "kinder-01"}) == "Kinder"
    assert rp.dog_name({"dog_id": "luna-01", "name": "Luna Belle"}) == "Luna Belle"


@pytest.mark.parametrize("text, missing", [
    (BODY.replace("49/100", "moderate"), "stress 49"),
    (BODY.replace("Orange", "elevated"), "handling_level Orange"),
    (BODY.replace("stable", "steady"), "trend stable"),
    (BODY.replace("Luna is", "This dog is").replace("Her ", "The ").replace("She ", "It "), "name Luna"),
    (BODY.replace("Luna is", "luna-01 is"), "uses the ID"),
])
def test_report_missing_required_facts_is_rejected(tmp_path, text, missing):
    g, _ = _gemini(text=text)
    with pytest.raises(rp.ReportError, match=missing):
        _run(tmp_path, g)
    assert not (tmp_path / "luna-01.md").exists()


@pytest.mark.parametrize("spikes, phrase", [(7, "seven arousal spikes"), (0, "no arousal spikes"),
                                            (1, "one arousal spike"), (0, "0 arousal spikes")])
def test_spike_count_may_be_spelled_out(spikes, phrase):
    contract = {**CONTRACT, "arousal_spikes": spikes}
    text = BODY.replace("7 brief arousal spikes", phrase)
    assert not rp.missing_facts(text, contract)


@pytest.mark.parametrize("sentence, ok", [
    ("During the clip, Luna did not exhibit any arousal spikes.", True),
    ("Luna showed arousal spikes without pause.", True),   # negation word present: accepted
    ("Luna showed several arousal spikes.", False),
])
def test_zero_spikes_as_negation(sentence, ok):
    contract = {**CONTRACT, "arousal_spikes": 0}
    text = BODY.replace("She had 7 brief arousal spikes, so greet her calmly and keep sessions short.",
                        sentence)
    assert ("arousal_spikes 0" not in rp.missing_facts(text, contract)) is ok


def test_spelled_out_wrong_count_is_still_missing():
    assert "arousal_spikes 7" in rp.missing_facts(BODY.replace("7 brief", "five brief"), CONTRACT)


# --- score bands ------------------------------------------------------------------

@pytest.mark.parametrize("score, expected", [(0, "low"), (30, "low"), (31, "moderate"),
                                             (60, "moderate"), (61, "high"), (100, "high")])
def test_band_edges(score, expected):
    assert rp.band(score) == expected


def test_prompt_states_bands():
    p = rp.build_prompt(CONTRACT, TREND)
    assert "0-30 = low, 31-60 = moderate, 61-100 = high" in p
    assert "stress 49/100 (moderate)" in p and "Energy 100/100 (high)" in p
    assert "Stress here is moderate" in p


@pytest.mark.parametrize("sentence", [
    "She has a stress level of 49 out of 100, indicating she is generally calm.",
    "Luna seems relaxed in the kennel.",
    "She has a calm demeanor overall.",
    "Her stress of 49/100 shows she stays calm.",
])
def test_moderate_stress_called_calm_is_rejected(tmp_path, sentence):
    g, _ = _gemini(text=BODY + " " + sentence)
    with pytest.raises(rp.ReportError, match="contradicts the scores"):
        _run(tmp_path, g)
    assert not (tmp_path / "luna-01.md").exists()


@pytest.mark.parametrize("sentence", [
    # The real Bedrock sentence that was wrongly rejected once:
    "Her stress level is moderate at 49, meaning she can handle a calm, predictable "
    "routine but may not be suited to a very chaotic home.",
    "With moderate stress, she needs a calm home and calm introductions.",
    "Her stress is moderate, so keep a calm and quiet environment.",
    # Negations are correct wording for moderate stress (also a real Bedrock sentence):
    "Her stress level is moderate at 49, meaning she is not calm or relaxed but can "
    "handle moderate stress.",
    "With stress at 49 she isn't fully relaxed yet.",
])
def test_calm_routine_need_is_not_a_conflict(sentence):
    # "calm" describing what she needs (routine/home/setting) is fine at stress 49.
    assert rp.wording_conflicts(BODY, CONTRACT) == []
    assert rp.wording_conflicts(sentence, CONTRACT) == []


def test_low_stress_may_be_called_calm():
    low = {**CONTRACT, "stress": 10}
    assert rp.wording_conflicts("Katie is generally calm, with stress at 10/100.", low) == []


# --- MongoDB save ------------------------------------------------------------------

def test_passing_report_is_saved_to_mongo_with_exact_fields(tmp_path):
    saved = []
    b, _ = _bedrock()
    report = _run(tmp_path, b, saved=saved)
    assert len(saved) == 1
    dog_id, update = saved[0]
    assert dog_id == "luna-01"
    assert set(update) == {"$set"}  # direct $set, nothing else
    assert set(update["$set"]) == set(rp.REPORT_FIELDS)
    assert update["$set"]["behavior_report"] == report
    assert update["$set"]["behavior_report_provider"] == "bedrock"
    assert datetime.fromisoformat(update["$set"]["behavior_report_at"]).tzinfo is not None


def test_gemini_provider_name_is_recorded(tmp_path):
    saved = []
    g, _ = _gemini()
    _run(tmp_path, g, saved=saved)
    assert saved[0][1]["$set"]["behavior_report_provider"] == "gemini"


def test_unowned_dog_is_never_written_to_mongo(tmp_path):
    saved = []
    g, _ = _gemini()
    _run(tmp_path, g, saved=saved, dog_id="seed-dog-07")
    assert saved == []


def test_failed_checks_and_cache_hits_do_not_write_to_mongo(tmp_path):
    saved = []
    g, client = _gemini(text=BODY.replace("Orange", "elevated"))
    with pytest.raises(rp.ReportError):
        _run(tmp_path, g, saved=saved)
    client.models.generate_content.return_value = SimpleNamespace(text=BODY)
    _run(tmp_path, g, saved=saved)          # passes -> one write
    _run(tmp_path, g, saved=saved)          # cache hit -> no new write
    assert len(saved) == 1


def test_unmatched_mongo_document_raises(tmp_path):
    g, _ = _gemini()
    with pytest.raises(rp.ReportError, match="no MongoDB document matched"):
        _run(tmp_path, g, save_report=lambda d, u: False)


def test_real_mongo_writer_uses_set_without_upsert(monkeypatch):
    col = MagicMock()
    col.update_one.return_value = SimpleNamespace(matched_count=1)
    import behavior.store_mongo as sm
    monkeypatch.setattr(sm, "get_collection", lambda *a, **k: col)
    update = rp.report_update("text", "bedrock")
    assert rp._save_report_to_mongo("luna-01", update) is True
    args, kwargs = col.update_one.call_args
    assert args == ({"dog_id": "luna-01"}, update) and "upsert" not in kwargs


def test_word_limit_upper_bound():
    with pytest.raises(rp.ReportError, match="too long"):
        rp.postprocess(BODY + " More detail." * 70)


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


def _capture_bedrock(monkeypatch):
    seen = {}

    class FakeBedrock:
        def __init__(self, model_id, region, client=None, key_id=None, secret=None):
            seen.update(model_id=model_id, region=region, key_id=key_id, secret=secret)

    monkeypatch.setattr(rp, "BedrockProvider", FakeBedrock)
    monkeypatch.setattr(rp, "load_settings", lambda: None)
    return seen


def test_bedrock_prefers_bedrock_keys_over_aws(monkeypatch):
    seen = _capture_bedrock(monkeypatch)
    for k, v in {"BEDROCK_KEY_ID": "bk", "BEDROCK_SECRET": "bs", "AWS_ACCESS_KEY_ID": "ak",
                 "AWS_SECRET_ACCESS_KEY": "as", "BEDROCK_REGION": "us-east-2",
                 "AWS_REGION": "us-west-2", "BEDROCK_MODEL_ID": "us.amazon.nova-lite-v1:0"}.items():
        monkeypatch.setenv(k, v)
    rp.make_provider("bedrock")
    assert seen == {"model_id": "us.amazon.nova-lite-v1:0", "region": "us-east-2",
                    "key_id": "bk", "secret": "bs"}


def test_bedrock_falls_back_to_aws_keys_and_region(monkeypatch):
    seen = _capture_bedrock(monkeypatch)
    monkeypatch.delenv("BEDROCK_KEY_ID", raising=False)
    monkeypatch.delenv("BEDROCK_SECRET", raising=False)
    monkeypatch.delenv("BEDROCK_REGION", raising=False)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "ak")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "as")
    monkeypatch.setenv("AWS_REGION", "us-west-2")
    monkeypatch.setenv("BEDROCK_MODEL_ID", "m")
    rp.make_provider("bedrock")
    assert (seen["key_id"], seen["secret"], seen["region"]) == ("ak", "as", "us-west-2")


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
