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
