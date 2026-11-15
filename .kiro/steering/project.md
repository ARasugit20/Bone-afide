Project: Bone-a-find (sunhacks 2026 hackathon). Matches shelter dogs to families using behavior measured from kennel video, never breed. (Formerly "Unleashed"; renamed to "Bone-a-find".)

Ownership: I own the WHOLE repo now - /pipeline, /app, and /landing. Claude Code is offline. There is no longer an off-limits folder; edit anything in the repo. Do NOT rename the repo, the Mongo database "bonafide", the S3 bucket, or env var names.

Stack: Python 3.12 (venv at pipeline/.venv), Ultralytics YOLO11 (detection + tracking + pose), OpenCV, numpy, pandas, scikit-learn, FastAPI, boto3 (S3, Bedrock), psycopg (Tiger Data / TimescaleDB), pymongo (MongoDB Atlas), google-genai (Gemini). App is Next.js; landing is Vite. TinyFish for async web lookups.

Secrets come from pipeline/.env and app .env.local. NEVER commit .env or .env.local. Secret-scan every staged diff before committing. Provide pipeline/.env.example.

Per-task workflow (every task): run tests (pipeline: pytest; app: npm run build + npm run lint), commit with a clear message, git pull --rebase=merges origin main, push to main, never force. Test the pipeline server on port 8010+ and never kill other servers (Claude Code's or anyone's).

App UI checks: Playwright screenshots at 1440 and 390 widths, console must be clean. Keep the existing Dog Park visual style.

Priorities: working end-to-end over perfect accuracy. Every pipeline module must run from the CLI and be testable on one clip.

Guardrails for ALL user-facing copy: never output the words aggressive, dangerous or menace; no breed as an input or in output; no diagnosis wording; no em dashes; no curly quotes; no slogans. Communicate risk only through handling levels (Green, Yellow, Orange, Red) and plain-English "needs".

Output contract (must match exactly, the app depends on it):

{"dog_id": "max-01", "day": 3, "energy": 62, "stress": 31, "approachability": 74, "confidence": 58, "arousal_spikes": 2, "handling_level": "Yellow", "trend": "improving", "needs": ["active home", "no cats yet"]}

All scores are integers 0-100. trend is one of improving, stable, worsening.
