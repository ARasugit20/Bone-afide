"""Staff-facing behavior report for one dog, written by an LLM from our own data.

Inputs: the dog's contract record (MongoDB, ``store_mongo.get_profile``) and its
daily trend (Tiger, ``store_tiger.get_trend``). Breed is never an input.

Provider: ``REPORT_PROVIDER`` in pipeline/.env — "gemini" (default) or "bedrock".
Both get the exact same prompt and the same post-processing.

Reports are cached at data/out/reports/<dog_id>.md; a cached report is returned
as-is unless ``refresh=True`` / ``--refresh``, so a demo doesn't burn quota.
Quota / 429 errors stop immediately with no retries.

Usage (from pipeline/):
    .venv/bin/python -m behavior.report --dog-id luna-01 [--refresh] [--model M] [--provider P]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from .guardrails import GuardrailViolation, assert_no_breed, sanitize
from .settings import PIPELINE_ROOT, load_settings

OUT_DIR = PIPELINE_ROOT / "data" / "out" / "reports"
DISCLAIMER = "Scores are decision support, not a diagnosis; staff and a vet make the final call."
PROVIDERS = ("gemini", "bedrock")
MAX_OUTPUT_TOKENS = 4096
MIN_WORDS = 60   # shorter than this is treated as truncated
MAX_WORDS = 200  # target is 100-130; far longer means the model ignored the brief

SCORE_KEYS = ("energy", "stress", "approachability", "confidence", "arousal_spikes")
# dog_id is deliberately left out of the prompt so the model uses the dog's name.
CONTRACT_KEYS = ("name", "day", *SCORE_KEYS, "handling_level", "trend", "needs")
TREND_KEYS = ("avg_stress", "avg_energy", "avg_approachability", "avg_confidence", "total_spikes")

PROMPT_TEMPLATE = """You are writing a behavior report for animal shelter staff about {name}.
Write 100-130 words, based only on the data below. Tone: warm but professional, plain and practical.

You must include all of the following, quoting each number exactly as given:
- Energy {energy}/100 ({energy_band}), stress {stress}/100 ({stress_band}), approachability {approachability}/100 ({approachability_band}), confidence {confidence}/100 ({confidence_band}).
- {arousal_spikes} arousal spike(s) (sudden bursts of excitement during the clip), written as the digit {arousal_spikes}.
- The handling level: {handling_level}.
- Every one of these needs, in plain words: {needs}.
- The trend: "{trend}". If there is only one day of data, say the trend cannot be judged yet.

Score bands (use these words so the wording matches the numbers):
- 0-30 = low, 31-60 = moderate, 61-100 = high.
- Describe each score with its band word shown above. For example, stress 49 is "moderate" stress.
- Only call {name} calm or relaxed if stress is low (0-30). Stress here is {stress_band}.

Rules:
- Refer to the dog as "{name}". Never use an ID or code for the dog.
- No headings, no bullet points; one or two short paragraphs.
- Never use the words "aggressive", "dangerous" or "menace".
- Never mention breed, breed type or appearance.
- End with exactly this sentence: "{disclaimer}"

Dog record:
{contract}

Daily trend (one row per day, oldest first):
{trend_rows}
"""


class QuotaExceeded(RuntimeError):
    """Provider quota or rate limit hit. Not retried."""


class ReportError(RuntimeError):
    """Missing data or configuration."""


# --- prompt + post-processing (shared by both providers) ---------------------

def _jsonable(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()
    if isinstance(value, float):
        return round(value, 1)
    return value


BANDED_KEYS = ("energy", "stress", "approachability", "confidence")


def band(score: Any) -> str:
    """0-30 = low, 31-60 = moderate, 61-100 = high."""
    if score is None:
        return "unknown"
    s = int(score)
    return "low" if s <= 30 else "moderate" if s <= 60 else "high"


def dog_name(contract: dict) -> str:
    """The dog's display name: the stored ``name``, else 'luna-01' -> 'Luna'."""
    name = (contract.get("name") or "").strip()
    return name or str(contract.get("dog_id", "")).split("-", 1)[0].capitalize()


def _needs_text(needs: Any) -> str:
    return "; ".join(needs) if needs else "none listed"


def build_prompt(contract: dict, trend_rows: list[dict]) -> str:
    """Build the provider-independent prompt. Only contract fields go in."""
    assert_no_breed(contract)  # reject breed in the source record, don't silently drop it
    contract = {**contract, "name": dog_name(contract)}
    record = {k: contract[k] for k in CONTRACT_KEYS if k in contract}
    rows = [
        {"date": _jsonable(r.get("bucket")), **{k: _jsonable(r.get(k)) for k in TREND_KEYS}}
        for r in trend_rows
    ]
    for r in rows:
        assert_no_breed(r)
    trend_text = json.dumps(rows, indent=2) if rows else "[] (no daily trend rows yet)"
    if len(rows) == 1:
        trend_text += "\n(Only one day so far; say the trend cannot be judged yet.)"
    return PROMPT_TEMPLATE.format(
        name=contract["name"],
        **{k: contract.get(k) for k in SCORE_KEYS},
        **{f"{k}_band": band(contract.get(k)) for k in BANDED_KEYS},
        handling_level=contract.get("handling_level"),
        needs=_needs_text(contract.get("needs")),
        trend=contract.get("trend"),
        disclaimer=DISCLAIMER,
        contract=json.dumps(record, indent=2),
        trend_rows=trend_text,
    )


_BREED_RE = re.compile(r"\bbreeds?\b", re.IGNORECASE)
_COUNT_WORDS = (
    ("zero", "no"), ("one", "a single"), ("two",), ("three",), ("four",), ("five",),
    ("six",), ("seven",), ("eight",), ("nine",), ("ten",),
)
_NEGATION_RE = re.compile(r"\b(no|not|none|zero|without|never)\b|n't\b", re.IGNORECASE)


def missing_facts(report: str, contract: dict) -> list[str]:
    """Required facts the report leaves out (scores, level, trend, name; no dog ID)."""
    missing = []
    for k in SCORE_KEYS:
        if k not in contract:
            continue
        n = int(contract[k])
        forms = [rf"(?<![\d.]){n}(?![\d.])"]
        if k == "arousal_spikes" and n < len(_COUNT_WORDS):
            # A count may fairly be spelled out: "five arousal spikes", "no arousal spikes".
            forms += [rf"\b{w}\b" for w in _COUNT_WORDS[n]]
        found = any(re.search(f, report, re.IGNORECASE) for f in forms)
        if not found and k == "arousal_spikes" and n == 0:
            # Zero may be phrased as a negation: "did not exhibit any arousal spikes".
            found = any(
                "arousal spike" in s.lower() and _NEGATION_RE.search(s)
                for s in re.split(r"(?<=[.!?])\s+", report)
            )
        if not found:
            missing.append(f"{k} {n}")
    for k in ("handling_level", "trend"):
        value = str(contract.get(k) or "")
        if value and value.lower() not in report.lower():
            missing.append(f"{k} {value}")
    name = dog_name(contract)
    if name and name not in report:
        missing.append(f"name {name}")
    dog_id = str(contract.get("dog_id") or "")
    if dog_id and dog_id.lower() in report.lower():
        missing.append(f"uses the ID {dog_id} instead of the name")
    return missing


# "calm"/"relaxed" said about the dog or its stress, e.g. "she is generally calm",
# "a calm demeanor". Needs like "a calm, predictable routine" are not matched.
_CALM_ABOUT_DOG_RE = re.compile(
    r"\b(is|was|seems|appears|remains?|remained|stays?|stayed|looks|generally|mostly|"
    r"very|quite|fairly|overall|largely)\s+(calm|relaxed)\b"
    r"|\b(calm|relaxed)\s+(dog|demeanou?r|nature|temperament|disposition|state|manner)\b",
    re.IGNORECASE,
)
_CALM_RE = re.compile(r"\b(calm|calmly|relaxed)\b", re.IGNORECASE)
# "calm" describing what the dog needs, not the dog: "a calm, predictable routine",
# "a calm home", "calm introductions". Removed before the stress-sentence check.
_CALM_NEED_RE = re.compile(
    r"\b(calm|relaxed)\b(,|\s+and)?\s+(\w+\s+){0,2}?"
    r"(routines?|environments?|homes?|households?|spaces?|settings?|handlers?|handling|"
    r"approach(es)?|introductions?|greetings?|areas?|places?|owners?|people|surroundings|"
    r"atmosphere|pace|interactions?|sessions?)\b",
    re.IGNORECASE,
)
# Negated: "she is not calm or relaxed", "never fully relaxed", "isn't calm".
_CALM_NEGATED_RE = re.compile(
    r"(\b(not|never|less|rarely|hardly)\b|n't\b)\s+(\w+\s+){0,2}?(calm|relaxed)\b"
    r"(\s+(or|and|nor)\s+(calm|relaxed)\b)?",
    re.IGNORECASE,
)


def wording_conflicts(report: str, contract: dict) -> list[str]:
    """Wording that contradicts the score bands (moderate/high stress called calm)."""
    stress = contract.get("stress")
    if stress is None or band(stress) == "low":
        return []
    problems = []
    for sentence in re.split(r"(?<=[.!?])\s+", report):
        about_dog = _CALM_NEGATED_RE.sub(" ", _CALM_NEED_RE.sub(" ", sentence))
        about_stress = "stress" in sentence.lower() and _CALM_RE.search(about_dog)
        if about_stress or _CALM_ABOUT_DOG_RE.search(about_dog):
            problems.append(f"{band(stress)} stress ({stress}) described as calm/relaxed: "
                            f"{sentence.strip()[:120]!r}")
    return problems


def postprocess(text: str, contract: Optional[dict] = None) -> str:
    """Normalize the model's text, enforce the disclaimer ending, apply guardrails.

    With ``contract``, also require the scores, handling level, trend and the
    dog's name to be quoted, so an incomplete report is never cached.
    """
    body = (text or "").strip()
    body = re.sub(r"^```(?:\w+)?\s*|\s*```$", "", body).strip()
    if not body:
        raise ReportError("provider returned an empty report")
    # Drop any (possibly paraphrased) disclaimer the model wrote, then add the exact one.
    if body.endswith(DISCLAIMER):
        body = body[: -len(DISCLAIMER)].rstrip()
    body = re.sub(r"\s*Scores are decision support[^\n]*$", "", body).rstrip()
    words = len(body.split())
    if words < MIN_WORDS:
        raise ReportError(f"report too short ({words} words); likely truncated")
    if words > MAX_WORDS:
        raise ReportError(f"report too long ({words} words); asked for 100-130")
    report = f"{body}\n\n{DISCLAIMER}\n"
    sanitize(report)  # raises GuardrailViolation on a banned word
    if _BREED_RE.search(report):
        raise GuardrailViolation("report mentions breed")
    if contract is not None:
        missing = missing_facts(body, contract)
        if missing:
            raise ReportError(f"report is missing required facts: {', '.join(missing)}")
        conflicts = wording_conflicts(body, contract)
        if conflicts:
            raise ReportError(f"report wording contradicts the scores: {'; '.join(conflicts)}")
    return report


# --- providers ---------------------------------------------------------------

def _is_quota_error(e: Exception) -> bool:
    text = str(e)
    if getattr(e, "code", None) == 429:
        return True
    resp = getattr(e, "response", None)
    if isinstance(resp, dict):
        code = resp.get("Error", {}).get("Code", "")
        status = resp.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if status == 429 or code in (
            "ThrottlingException", "ServiceQuotaExceededException", "TooManyRequestsException",
        ):
            return True
    return any(s in text for s in ("RESOURCE_EXHAUSTED", "429", "ThrottlingException",
                                    "ServiceQuotaExceeded", "Too many requests"))


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: str, client: Any = None):
        if not api_key or not model:
            raise ReportError("GEMINI_API_KEY and GEMINI_MODEL must be set in pipeline/.env")
        if client is None:
            from google import genai
            client = genai.Client(api_key=api_key)
        self.client, self.model = client, model

    def generate(self, prompt: str) -> str:
        from google.genai import types
        try:
            resp = self.client.models.generate_content(
                model=self.model, contents=prompt,
                # Thinking models spend output tokens on reasoning, so leave headroom.
                config=types.GenerateContentConfig(temperature=0.2,
                                                   max_output_tokens=MAX_OUTPUT_TOKENS),
            )
        except Exception as e:
            if _is_quota_error(e):
                raise QuotaExceeded(f"Gemini quota/rate limit hit for {self.model}; "
                                    f"not retrying. {e}") from e
            raise
        candidates = getattr(resp, "candidates", None) or []
        reason = getattr(getattr(candidates[0], "finish_reason", None), "name", None) \
            if candidates else None
        if reason == "MAX_TOKENS":
            raise ReportError(f"Gemini reply was cut off at the token limit ({self.model})")
        return resp.text or ""


class BedrockProvider:
    name = "bedrock"

    def __init__(self, model_id: str, region: str, client: Any = None,
                 key_id: Optional[str] = None, secret: Optional[str] = None):
        if not model_id:
            raise ReportError("BEDROCK_MODEL_ID must be set in pipeline/.env")
        if client is None:
            import boto3
            kwargs = {"region_name": region}
            if key_id and secret:
                kwargs.update(aws_access_key_id=key_id, aws_secret_access_key=secret)
            client = boto3.client("bedrock-runtime", **kwargs)
        self.client, self.model = client, model_id

    def generate(self, prompt: str) -> str:
        try:
            resp = self.client.converse(
                modelId=self.model,
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                inferenceConfig={"maxTokens": MAX_OUTPUT_TOKENS, "temperature": 0.2},
            )
        except Exception as e:
            if _is_quota_error(e):
                raise QuotaExceeded(f"Bedrock quota/throttling hit for {self.model}; "
                                    f"not retrying. {e}") from e
            raise
        if resp.get("stopReason") == "max_tokens":
            raise ReportError(f"Bedrock reply was cut off at the token limit ({self.model})")
        parts = resp["output"]["message"]["content"]
        return "".join(p.get("text", "") for p in parts)


def make_provider(name: Optional[str] = None, *, model: Optional[str] = None):
    load_settings()  # loads pipeline/.env into the environment
    name = (name or os.getenv("REPORT_PROVIDER") or "gemini").strip().lower()
    if name == "gemini":
        return GeminiProvider(os.getenv("GEMINI_API_KEY", ""),
                              model or os.getenv("GEMINI_MODEL", ""))
    if name == "bedrock":
        # Bedrock has its own key pair so S3 can use separate AWS_* keys.
        # AWS_* is only a fallback when the BEDROCK_* pair is not set.
        key_id, secret = os.getenv("BEDROCK_KEY_ID"), os.getenv("BEDROCK_SECRET")
        if not (key_id and secret):
            key_id, secret = os.getenv("AWS_ACCESS_KEY_ID"), os.getenv("AWS_SECRET_ACCESS_KEY")
        return BedrockProvider(
            model or os.getenv("BEDROCK_MODEL_ID", ""),
            os.getenv("BEDROCK_REGION") or os.getenv("AWS_REGION") or "us-east-1",
            key_id=key_id, secret=secret,
        )
    raise ReportError(f"REPORT_PROVIDER must be one of {PROVIDERS}, got {name!r}")


# --- data loading ------------------------------------------------------------

def _load_contract(dog_id: str) -> Optional[dict]:
    from .store_mongo import get_profile
    return get_profile(dog_id)


def _load_trend(dog_id: str) -> list[dict]:
    from .store_tiger import get_trend
    return get_trend(dog_id)


# Only these dogs are owned by this pipeline; the teammate's seed dogs are never written.
OWNED_DOG_IDS = ("june-01", "katie-01", "kacy-01", "kinder-01", "luna-01")
REPORT_FIELDS = ("behavior_report", "behavior_report_provider", "behavior_report_at")


def report_update(report: str, provider_name: str, at: Optional[datetime] = None) -> dict:
    """The exact $set payload written to the dog's Mongo document."""
    at = at or datetime.now(timezone.utc)
    return {"$set": {
        "behavior_report": report,
        "behavior_report_provider": provider_name,
        "behavior_report_at": at.isoformat(timespec="seconds"),
    }}


def _save_report_to_mongo(dog_id: str, update: dict) -> bool:
    """Direct $set on bonafide.dogs for an owned dog. No upsert. True if matched."""
    from .store_mongo import get_collection
    return get_collection().update_one({"dog_id": dog_id}, update).matched_count == 1


# --- main entry --------------------------------------------------------------

def report_path(dog_id: str, out_dir: Path = OUT_DIR) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", dog_id or ""):
        raise ReportError(f"invalid dog_id {dog_id!r}")
    return out_dir / f"{dog_id}.md"


def generate_report(dog_id: str, *, refresh: bool = False, provider: Any = None,
                    provider_name: Optional[str] = None, model: Optional[str] = None,
                    load_contract: Callable[[str], Optional[dict]] = _load_contract,
                    load_trend: Callable[[str], list[dict]] = _load_trend,
                    save_report: Callable[[str, dict], bool] = _save_report_to_mongo,
                    out_dir: Path = OUT_DIR) -> str:
    """Return the staff report for ``dog_id`` (cached unless ``refresh``).

    A freshly generated report that passes every check is cached to disk and, for
    the five owned dogs, written to the dog's MongoDB document.
    """
    path = report_path(dog_id, out_dir)
    if path.exists() and not refresh:
        return sanitize(path.read_text())

    contract = load_contract(dog_id)
    if not contract:
        raise ReportError(f"no contract record for {dog_id} in MongoDB")
    trend = load_trend(dog_id)
    prompt = build_prompt(contract, trend)

    provider = provider or make_provider(provider_name, model=model)
    report = postprocess(provider.generate(prompt), contract)

    out_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(report)

    if dog_id in OWNED_DOG_IDS:
        name = getattr(provider, "name", None) or "unknown"
        if not save_report(dog_id, report_update(report, name)):
            raise ReportError(f"report cached, but no MongoDB document matched {dog_id}")
    return report


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Generate a staff-facing behavior report")
    ap.add_argument("--dog-id", required=True)
    ap.add_argument("--refresh", action="store_true", help="ignore the cached report")
    ap.add_argument("--provider", choices=PROVIDERS, help="override REPORT_PROVIDER")
    ap.add_argument("--model", help="override GEMINI_MODEL / BEDROCK_MODEL_ID")
    args = ap.parse_args(argv)
    try:
        report = generate_report(args.dog_id, refresh=args.refresh,
                                 provider_name=args.provider, model=args.model)
    except QuotaExceeded as e:
        print(f"QUOTA: {e}", file=sys.stderr)
        return 3
    except (ReportError, GuardrailViolation) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 2
    print(report)
    print(f"[saved] {report_path(args.dog_id)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
