"""Export 15 evenly spaced frames per clip for hand labelling.

Usage:
  python label_posture.py --clip katie          # writes labels/katie.csv + labels/katie/*.jpg
Then open the jpgs and fill the label column with s (standing), i (sitting), l (lying) or x (unclear).
"""
import argparse
import json
from pathlib import Path

import cv2

HERE = Path(__file__).parent
LABELS = HERE / "labels"
CACHE = HERE / "tune_cache.json"
N = 15


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--clip", required=True)
    p.add_argument("--n", type=int, default=N)
    args = p.parse_args()

    cache = json.loads(CACHE.read_text())
    entry = cache.get(args.clip)
    if not entry or not entry.get("best"):
        raise SystemExit(f"no tuned run for {args.clip}; run tune.py first")
    video = HERE / "work" / f"{args.clip}_p.mp4"
    if not video.exists():
        raise SystemExit(f"missing preprocessed clip {video}")

    dest = LABELS / args.clip
    dest.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(video))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    idxs = [round(i * (total - 1) / max(1, args.n - 1)) for i in range(args.n)]
    rows = ["frame,label"]
    for i in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, frame = cap.read()
        if not ok:
            continue
        cv2.imwrite(str(dest / f"{i:04d}.png"), frame)
        rows.append(f"{i},")
    cap.release()
    csv = LABELS / f"{args.clip}.csv"
    if csv.exists():
        print(f"{csv} already exists; leaving it alone")
    else:
        csv.write_text("\n".join(rows) + "\n")
        print(f"wrote {csv} and {len(rows) - 1} frames to {dest}")


if __name__ == "__main__":
    main()
