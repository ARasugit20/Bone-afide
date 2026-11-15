Project: Unleashed (sunhacks 2026 hackathon, deadline 11 AM Sunday). Matches shelter dogs to families using behavior measured from kennel video, never breed.

My scope: everything inside /pipeline only. Never edit /app (my teammate's folder, built in Cursor).

Stack: Python 3.12 (venv at pipeline/.venv), Ultralytics YOLO11 (detection + tracking, later pose), OpenCV, numpy, pandas, scikit-learn, FastAPI, boto3 (S3, Bedrock), psycopg (Tiger Data / TimescaleDB), pymongo (MongoDB Atlas), google-genai (Gemini).

Secrets come from pipeline/.env (never hardcode, never commit). Provide pipeline/.env.example.

Priorities: working end-to-end over perfect accuracy. Every module must run from the CLI and be testable on one clip.

Guardrails: never output the words aggressive, dangerous or menace. Use handling levels (Green, Yellow, Orange, Red) and "needs". Breed is never an input to any model.

Output contract (must match exactly, my teammate depends on it):

{"dog_id": "max-01", "day": 3, "energy": 62, "stress": 31, "approachability": 74, "confidence": 58, "arousal_spikes": 2, "handling_level": "Yellow", "trend": "improving", "needs": ["active home", "no cats yet"]}

All scores are integers 0-100. trend is one of improving, stable, worsening.
