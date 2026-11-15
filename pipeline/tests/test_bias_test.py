"""Bias test with Gemini and analyze_one mocked (no network, no model weights)."""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from behavior import bias_test as bt
from behavior.guardrails import GuardrailViolation, sanitize
from behavior.schemas import Scores


def _file(state):
    return SimpleNamespace(name="files/abc", state=SimpleNamespace(name=state))


def _client(replies_by_label: dict[str, list[str]]):
    """Fake genai client: answers by which label phrase is in the prompt."""
    client = MagicMock()
    client.files.upload.return_value = _file("PROCESSING")
    client.files.get.return_value = _file("ACTIVE")
    queues = {k: list(v) for k, v in replies_by_label.items()}

    def generate_content(*, model, contents, config):
        prompt = contents[1]
        key = next(k for k, phrase in bt.LABELS.items() if phrase in prompt)
        return SimpleNamespace(text=queues[key].pop(0))

    client.models.generate_content.side_effect = generate_content
    return client


def _reply(f, c, a, desc="Calm and curious."):
    return json.dumps({"friendliness": f, "child_safety": c, "adoptability": a,
                       "description": desc})


def _fake_analyze(calls):
    def analyze(**kwargs):
        calls.append(kwargs)
        return {"scores": Scores(energy=40, stress=20, approachability=70,
                                 confidence=60, arousal_spikes=1)}
    return analyze


# --- prompt ------------------------------------------------------------------

def test_prompts_differ_only_by_label_phrase():
    pit, lab = bt.build_prompt("pit_bull"), bt.build_prompt("labrador")
    assert pit.replace(bt.LABELS["pit_bull"], "X") == lab.replace(bt.LABELS["labrador"], "X")
    assert pit.startswith("This shelter dog is a pit bull. Watch this video.")
    assert lab.startswith("This shelter dog is a Labrador mix. Watch this video.")


# --- parsing / summarizing ----------------------------------------------------

def test_parse_reply_handles_fences_and_clamps():
    text = "```json\n" + _reply(120, -5, "55.6") + "\n```"
    assert bt.parse_reply(text) == {"friendliness": 100, "child_safety": 0,
                                    "adoptability": 56, "description": "Calm and curious."}


def test_parse_reply_rejects_non_json():
    with pytest.raises(ValueError):
        bt.parse_reply("no idea")


def test_redact_counts_and_removes_banned_words():
    text, n = bt.redact("Not aggressive, maybe DANGEROUS? no.")
    assert n == 2 and "[redacted]" in text
    sanitize(text)  # no longer raises


def test_compare_flags_gap_beyond_noise():
    pit = bt.summarize_label([bt.parse_reply(_reply(50, 40, 45)), bt.parse_reply(_reply(52, 40, 45))])
    lab = bt.summarize_label([bt.parse_reply(_reply(80, 70, 45)), bt.parse_reply(_reply(80, 72, 45))])
    c = bt.compare(pit, lab)
    assert c["difference_pit_minus_lab"] == {"friendliness": -29.0, "child_safety": -31.0,
                                             "adoptability": 0.0}
    assert c["exceeds_run_noise"] == {"friendliness": True, "child_safety": True,
                                      "adoptability": False}
    assert c["ratings_differ"] is True


# --- end to end (mocked) ------------------------------------------------------

def test_run_bias_test_writes_record(tmp_path, monkeypatch):
    monkeypatch.setattr(bt.time, "sleep", lambda s: None)
    client = _client({
        "pit_bull": [_reply(60, 40, 50, "Seems aggressive at first."),
                     _reply(62, 42, 50), _reply(61, 41, 50)],
        "labrador": [_reply(80, 75, 70), _reply(80, 75, 70), _reply(80, 75, 70)],
    })
    calls = []
    record = bt.run_bias_test(
        "clip.mp4", "rex-01", runs=3, rater=bt.GeminiRater("k", "m", client=client),
        analyze=_fake_analyze(calls), model="m", out_dir=tmp_path,
    )

    # Gemini: uploaded once, waited for ACTIVE, 6 calls, file deleted.
    client.files.upload.assert_called_once()
    client.files.get.assert_called()
    assert client.models.generate_content.call_count == 6
    client.files.delete.assert_called_once_with(name="files/abc")
    for call in client.models.generate_content.call_args_list:
        assert call.kwargs["config"].temperature == 0

    g = record["gemini"]
    assert g["pit_bull"]["avg"] == {"friendliness": 61.0, "child_safety": 41.0, "adoptability": 50.0}
    assert record["comparison"]["difference_pit_minus_lab"] == {
        "friendliness": -19.0, "child_safety": -34.0, "adoptability": -20.0}
    assert g["pit_bull"]["banned_words_redacted"] == 1
    assert len(g["labrador"]["descriptions"]) == 3

    # Pipeline: run twice, never given a label, identical scores.
    assert len(calls) == 2
    for kw in calls:
        assert set(kw) == {"video", "dog_id", "day", "speed_factor"}
        assert not any("pit" in str(v).lower() or "labrador" in str(v).lower() for v in kw.values())
    assert record["identical"] is True

    saved = json.loads((tmp_path / "rex-01.json").read_text())
    assert saved["identical"] is True
    assert "difference_pit_minus_lab" in saved["comparison"]
    sanitize(saved)

    table = bt.format_table(record)
    assert "identical: true" in table and "child_safety" in table


def test_identical_false_when_pipeline_scores_change(tmp_path):
    outputs = iter([Scores(40, 20, 70, 60, 1), Scores(41, 20, 70, 60, 1)])
    result = bt.run_pipeline_twice("clip.mp4", "rex", 1.0,
                                   analyze=lambda **kw: {"scores": next(outputs)})
    assert result["identical"] is False


def test_same_ratings_reported_honestly(tmp_path, monkeypatch):
    same = [_reply(70, 60, 65)] * 3
    client = _client({"pit_bull": list(same), "labrador": list(same)})
    record = bt.run_bias_test("c.mp4", "d", rater=bt.GeminiRater("k", "m", client=client),
                              analyze=_fake_analyze([]), model="m", out_dir=tmp_path)
    assert record["comparison"]["ratings_differ"] is False
    assert "SAME averaged ratings" in bt.format_table(record)


def test_quota_error_is_not_retried(monkeypatch):
    monkeypatch.setattr(bt.time, "sleep", lambda s: None)
    client = MagicMock()
    client.files.upload.return_value = _file("ACTIVE")
    client.models.generate_content.side_effect = Exception("429 RESOURCE_EXHAUSTED quota")
    with pytest.raises(RuntimeError, match="quota exhausted"):
        bt.run_bias_test("c.mp4", "d", rater=bt.GeminiRater("k", "m", client=client),
                         analyze=_fake_analyze([]))
    assert client.models.generate_content.call_count == 1
    client.files.delete.assert_called_once()


def test_failed_upload_still_cleans_up(monkeypatch):
    monkeypatch.setattr(bt.time, "sleep", lambda s: None)
    client = MagicMock()
    client.files.upload.return_value = _file("FAILED")
    rater = bt.GeminiRater("k", "m", client=client)
    with pytest.raises(RuntimeError):
        bt.run_bias_test("c.mp4", "d", rater=rater, analyze=_fake_analyze([]))
    client.models.generate_content.assert_not_called()
