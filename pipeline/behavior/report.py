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
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable, Optional

from .guardrails import GuardrailViolation, assert_no_breed, sanitize
from .settings import PIPELINE_ROOT, load_settings

OUT_DIR = PIPELINE_ROOT / "data" / "out" / "reports"
DISCLAIMER = "Scores are decision support, not a diagnosis; staff and a vet make the final call."
PROVIDERS = ("gemini", "bedrock")
MAX_OUTPUT_TOKENS = 4096
MIN_WORDS = 60  # a ~120-word report shorter than this is treated as truncated

CONTRACT_KEYS = (
    "dog_id", "day", "energy", "stress", "approachability", "confidence",
    "arousal_spikes", "handling_level", "trend", "needs",
)
TREND_KEYS = ("avg_stress", "avg_energy", "avg_approachability", "avg_confidence", "total_spikes")

PROMPT_TEMPLATE = """You are writing for animal shelter staff.
Write a behavior report of about 120 words for the dog below, based only on this data.
Cover: energy, stress, approachability, confidence, the handling level, the needs, and the trend across days.
Rules:
- Plain, calm, practical language for staff. No headings, no bullet points, one or two short paragraphs.
- Scores are 0-100. arousal_spikes counts sudden bursts of excitement in the clip.
- Never use the words "aggressive", "dangerous" or "menace".
- Never mention breed, breed type or appearance.
- End with exactly this sentence: "{disclaimer}"

Dog record:
{contract}

Daily trend (one row per day, oldest first):
{trend}
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


def build_prompt(contract: dict, trend_rows: list[dict]) -> str:
    """Build the provider-independent prompt. Only contract fields go in."""
    assert_no_breed(contract)  # reject breed in the source record, don't silently drop it
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
        disclaimer=DISCLAIMER, contract=json.dumps(record, indent=2), trend=trend_text
    )


_BREED_RE = re.compile(r"\bbreeds?\b", re.IGNORECASE)


def postprocess(text: str) -> str:
    """Normalize the model's text, enforce the disclaimer ending, apply guardrails."""
    body = (text or "").strip()
    body = re.sub(r"^```(?:\w+)?\s*|\s*```$", "", body).strip()
    if not body:
        raise ReportError("provider returned an empty report")
    # Drop any (possibly paraphrased) disclaimer the model wrote, then add the exact one.
    if body.endswith(DISCLAIMER):
        body = body[: -len(DISCLAIMER)].rstrip()
    body = re.sub(r"\s*Scores are decision support[^\n]*$", "", body).rstrip()
    if len(body.split()) < MIN_WORDS:
        raise ReportError(f"report too short ({len(body.split())} words); likely truncated")
    report = f"{body}\n\n{DISCLAIMER}\n"
    sanitize(report)  # raises GuardrailViolation on a banned word
    if _BREED_RE.search(report):
        raise GuardrailViolation("report mentions breed")
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
        return BedrockProvider(
            model or os.getenv("BEDROCK_MODEL_ID", ""),
            os.getenv("BEDROCK_REGION") or os.getenv("AWS_REGION") or "us-east-1",
            key_id=os.getenv("BEDROCK_KEY_ID"), secret=os.getenv("BEDROCK_SECRET"),
        )
    raise ReportError(f"REPORT_PROVIDER must be one of {PROVIDERS}, got {name!r}")


# --- data loading ------------------------------------------------------------

def _load_contract(dog_id: str) -> Optional[dict]:
    from .store_mongo import get_profile
    return get_profile(dog_id)


def _load_trend(dog_id: str) -> list[dict]:
    from .store_tiger import get_trend
    return get_trend(dog_id)


# --- main entry --------------------------------------------------------------

def report_path(dog_id: str, out_dir: Path = OUT_DIR) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9_-]+", dog_id or ""):
        raise ReportError(f"invalid dog_id {dog_id!r}")
    return out_dir / f"{dog_id}.md"


def generate_report(dog_id: str, *, refresh: bool = False, provider: Any = None,
                    provider_name: Optional[str] = None, model: Optional[str] = None,
                    load_contract: Callable[[str], Optional[dict]] = _load_contract,
                    load_trend: Callable[[str], list[dict]] = _load_trend,
                    out_dir: Path = OUT_DIR) -> str:
    """Return the staff report for ``dog_id`` (cached unless ``refresh``)."""
    path = report_path(dog_id, out_dir)
    if path.exists() and not refresh:
        return sanitize(path.read_text())

    contract = load_contract(dog_id)
    if not contract:
        raise ReportError(f"no contract record for {dog_id} in MongoDB")
    trend = load_trend(dog_id)
    prompt = build_prompt(contract, trend)

    provider = provider or make_provider(provider_name, model=model)
    report = postprocess(provider.generate(prompt))

    out_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(report)
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
