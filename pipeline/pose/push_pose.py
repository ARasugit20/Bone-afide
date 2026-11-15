"""Write pose features onto bonafide.dogs.<id>.pose. Never creates dogs, never touches other fields.

Usage:
  python push_pose.py --dry-run
  python push_pose.py            # needs MONGODB_URI
"""
import argparse
import json
import os
from pathlib import Path

HERE = Path(__file__).parent
REPORT = HERE / "eval_report.json"


def pose_doc(entry: dict) -> dict:
    f = entry["features"]
    val = lambda v: None if isinstance(v, str) else v  # noqa: E731 - "not_measurable" becomes null
    posture = val(f["posture_pct"])
    # Plain-English note (no em dashes, no curly quotes, no breed/diagnosis wording).
    note = None
    if isinstance(posture, dict):
        lying = posture.get("lying")
        if isinstance(lying, (int, float)):
            note = f"Lying {round(lying)} percent of the clip."
    return {
        # Contract fields the app and API.md document:
        "available": True,
        "keypoints_url": entry.get("keypoints_url"),
        "notes": note,
        # Richer fields the app's pose-nudge logic consumes:
        "posture_pct": posture,
        "tail_h": val(f.get("tail_height_median")),
        "head_h": val(f.get("head_height_median")),
        "readiness": entry["readiness"],
        "confidence": f["mean_confidence"],
        "version": entry["version"],
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()
    report = json.loads(REPORT.read_text())

    uri = os.environ.get("MONGODB_URI", "").strip()
    if not args.dry_run and not uri:
        raise SystemExit("MONGODB_URI is not set")

    client = None
    dogs = None
    if not args.dry_run:
        from pymongo import MongoClient

        client = MongoClient(uri, serverSelectionTimeoutMS=8000)
        dogs = client["bonafide"]["dogs"]

    for clip, entry in sorted(report.items()):
        doc = pose_doc(entry)
        if args.dry_run:
            print(f"{clip}: {json.dumps(doc)}")
            continue
        # Match clip name to a dog by id prefix, then by display name.
        target = dogs.find_one({"dog_id": {"$regex": f"^{clip}(-|_|$)", "$options": "i"}}, {"dog_id": 1})
        if not target:
            target = dogs.find_one({"name": {"$regex": f"^{clip}$", "$options": "i"}}, {"dog_id": 1})
        if not target:
            print(f"{clip}: no matching dog, skipped")
            continue
        dogs.update_one({"dog_id": target["dog_id"]}, {"$set": {"pose": doc}})
        print(f"{clip} -> {target['dog_id']}: readiness {doc['readiness']}")
    if client:
        client.close()


if __name__ == "__main__":
    main()
