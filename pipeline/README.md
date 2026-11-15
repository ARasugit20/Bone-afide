# Bone-a-find — behavior pipeline

Measures shelter-dog behavior from kennel video motion (never breed) and produces
handling levels (Green/Yellow/Orange/Red) and plain-English needs. All pipeline code
lives here under `/pipeline`.

## Setup

```bash
cd pipeline
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # then fill in secrets; .env is gitignored
```

## Layout

- `behavior/` — the pipeline package (settings, schemas, guardrails, and stage modules).
- `config/` — hand-editable JSON: `cameras.json` (zones), `levels.json` (handling
  thresholds), `needs.json` (needs rules).
- `tests/` — unit/smoke tests; drop a 20–60s sample clip in `tests/data/`.

## Status

Scaffold (Task 1) is in place: settings, data contracts, guardrails, and config.
Stage modules (ingest, track, features, scores, levels, needs, trend, stores,
annotate, api, cli) follow in later tasks.

## Run tests

```bash
cd pipeline
python -m pytest tests/test_scaffold.py -q
```
