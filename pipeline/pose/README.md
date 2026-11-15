# SuperAnimal-Quadruped pose prototype

Estimates 39 quadruped keypoints on a kennel clip, then summarizes posture and tail/head height. Nothing here is wired into the app.

## Setup

Python 3.10 is required (`brew install python@3.10` on macOS).

```bash
cd pipeline/pose
python3.10 -m venv .venv
source .venv/bin/activate
pip install "deeplabcut[modelzoo]"
```

ffmpeg must be on PATH. The first run downloads the HRNet and Faster R-CNN weights from Hugging Face.

## Run

```bash
source .venv/bin/activate
python run_pose.py --video ../data/raw/katie.mp4 --out output --fps 2 --max-seconds 30
python pose_features.py --pose output/katie_pose.json
```

`run_pose.py` writes a 2 fps, max-720px copy trimmed to 30 seconds, runs `deeplabcut.video_inference_superanimal` on that copy (`superanimal_quadruped`, `hrnet_w32`, `fasterrcnn_resnet50_fpn_v2`, `video_adapt=False`, `dest_folder` set), and converts the `.h5` into `output/<name>_pose.json`.

`pose_features.py` prints the keypoint names, drops anything under 0.5 confidence, and writes `output/<name>_features.json` with posture percentages, tail and head height relative to body length, mean confidence, and frames used.

Checked against DeepLabCut 3.0.2. `video_inference_superanimal` accepts `dest_folder`.

## Tuning and evaluation

```bash
python tune.py                 # profile + crop + grid-search every clip in ../data/raw (cached)
python tune.py --clips katie   # one clip
python tune.py --adapt         # also try video_adapt=True (very slow on CPU)
python evaluate.py             # score best runs against criteria.json -> eval_report.json
python label_posture.py --clip katie   # 15 frames to hand-label for posture accuracy
python push_pose.py --dry-run  # preview the dogs.<id>.pose docs
python push_pose.py            # needs MONGODB_URI; requires pymongo
```

`tune.py` profiles each clip (resolution, fps, dog bbox, viewpoint), crops to the dog plus 15%, upscales so the dog is about 400px (never downscales), lifts contrast on dark clips, samples at 5 fps, then grids `scale_list` x `video_adapt` x `bbox_threshold`. Best run per clip is the highest `mean_conf x backline_coverage x (1 - jitter)`. Results cache in `tune_cache.json`, so reruns skip finished clips.

`criteria.json` holds the ideal and minimum thresholds and is meant to be edited. Readiness is the mean percentage of ideal across the metrics that could be measured. Posture accuracy stays `pending` until a label CSV exists.

## Integration (off by default)

`push_pose.py` writes `dogs.<id>.pose = {posture_pct, tail_h, head_h, readiness, confidence, version}` and touches nothing else. The app reads it only when `POSE_ENABLED=true` and `readiness >= 70`; it then nudges energy and stress by at most 15%, weighted by readiness, and adds a plain-English reason. Guardrails (handling level, approachability, needs) are never affected. With pose absent or the flag off, matching is byte-identical, which `app/src/lib/match.test.ts` asserts.
