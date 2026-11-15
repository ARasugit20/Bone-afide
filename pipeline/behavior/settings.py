"""Settings for the behavior pipeline.

Loads ``pipeline/.env`` (if present) and exposes typed constants. Secrets are only
ever read here, never hardcoded. Every key is documented in ``pipeline/.env.example``.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

try:
    from dotenv import load_dotenv
except ImportError:  # dependency not yet installed (e.g. scaffold-only check)
    def load_dotenv(*_args, **_kwargs):  # type: ignore
        return False

# pipeline/behavior/settings.py -> parents[1] == pipeline/
PIPELINE_ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = PIPELINE_ROOT / "config"
ENV_PATH = PIPELINE_ROOT / ".env"

# Load .env from the pipeline root if it exists; real env vars still win.
load_dotenv(dotenv_path=ENV_PATH, override=False)


def _get(key: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(key, default)
    return value if value not in ("",) else default


@dataclass(frozen=True)
class Settings:
    # AWS / S3
    aws_access_key_id: Optional[str]
    aws_secret_access_key: Optional[str]
    aws_region: str
    s3_bucket: Optional[str]
    # Tiger Data / TimescaleDB
    tiger_dsn: Optional[str]
    # MongoDB Atlas
    mongo_uri: Optional[str]
    mongo_db: str
    # Gemini (reserved, not used in stage 1)
    gemini_api_key: Optional[str]
    # Model + sampling
    yolo_weights: str
    dog_class_id: int
    detection_conf: float
    sample_fps: float
    max_frame_width: int
    max_interp_gap_s: float
    blur_rel_threshold: float
    camera_compensation: bool
    close_area_frac: float
    # API auth (optional Cognito JWT; off by default)
    require_auth: bool
    cognito_user_pool_id: Optional[str]
    cognito_app_client_id: Optional[str]
    cognito_region: Optional[str]
    # Defaults
    default_camera_id: str

    @property
    def config_dir(self) -> Path:
        return CONFIG_DIR


def load_settings() -> Settings:
    """Read current environment into a Settings object."""
    return Settings(
        aws_access_key_id=_get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=_get("AWS_SECRET_ACCESS_KEY"),
        aws_region=_get("AWS_REGION", "us-east-1"),
        s3_bucket=_get("S3_BUCKET"),
        tiger_dsn=_get("TIGER_DSN"),
        # Accept MONGO_URI (canonical) or MONGODB_URI (common alias) from .env.
        mongo_uri=_get("MONGO_URI") or _get("MONGODB_URI"),
        mongo_db=_get("MONGO_DB", "unleashed"),
        gemini_api_key=_get("GEMINI_API_KEY"),
        yolo_weights=_get("YOLO_WEIGHTS", "yolo11s.pt"),
        dog_class_id=int(_get("DOG_CLASS_ID", "16")),
        detection_conf=float(_get("DETECTION_CONF", "0.25")),
        sample_fps=float(_get("SAMPLE_FPS", "10")),
        max_frame_width=int(_get("MAX_FRAME_WIDTH", "1280")),
        max_interp_gap_s=float(_get("MAX_INTERP_GAP_S", "1.0")),
        blur_rel_threshold=float(_get("BLUR_REL_THRESHOLD", "0.4")),
        camera_compensation=_get("CAMERA_COMPENSATION", "1") not in ("0", "false", "False"),
        close_area_frac=float(_get("CLOSE_AREA_FRAC", "0.08")),
        require_auth=_get("REQUIRE_AUTH", "0") in ("1", "true", "True"),
        cognito_user_pool_id=_get("COGNITO_USER_POOL_ID"),
        cognito_app_client_id=_get("COGNITO_APP_CLIENT_ID"),
        cognito_region=_get("COGNITO_REGION"),
        default_camera_id=_get("DEFAULT_CAMERA_ID", "cam-default"),
    )


# Module-level singleton for convenience; call load_settings() for a fresh read.
settings = load_settings()
