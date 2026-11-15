"""Transcode OpenCV-written MP4s to browser-safe H.264.

OpenCV's ``cv2.VideoWriter(..., "mp4v")`` produces MPEG-4 Part 2, which every major
browser rejects (HTMLMediaElement error code 4 / MEDIA_ERR_SRC_NOT_SUPPORTED). We
re-encode to H.264 (yuv420p, +faststart) so a `<video>` tag just works.

ffmpeg resolution order:
  1. system ``ffmpeg`` on PATH, if it reports a libx264 encoder;
  2. otherwise the static ffmpeg bundled by ``imageio-ffmpeg``.

``probe_codec`` reports the video stream's codec and pixel format using the same
ffmpeg binary (no separate ffprobe needed).
"""

from __future__ import annotations

import re
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path
from typing import Optional

H264_ARGS = [
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    # Guarantee even dimensions (H.264 yuv420p requires them).
    "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
]


class TranscodeError(RuntimeError):
    pass


def _has_libx264(exe: str) -> bool:
    try:
        out = subprocess.run([exe, "-hide_banner", "-encoders"],
                             capture_output=True, text=True, timeout=30).stdout
        return "libx264" in out
    except Exception:
        return False


@lru_cache(maxsize=1)
def ffmpeg_exe() -> str:
    """Path to an ffmpeg binary that supports libx264."""
    sys_ff = shutil.which("ffmpeg")
    if sys_ff and _has_libx264(sys_ff):
        return sys_ff
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if _has_libx264(exe):
            return exe
    except Exception as e:  # pragma: no cover
        raise TranscodeError(f"no ffmpeg with libx264 available: {e}")
    raise TranscodeError("no ffmpeg with libx264 available")


def to_browser_h264(src: str, dst: Optional[str] = None) -> str:
    """Transcode ``src`` to browser-safe H.264 at ``dst`` (default: alongside src).

    Returns the output path. Overwrites ``dst`` if it exists.
    """
    src_p = Path(src)
    if not src_p.exists():
        raise TranscodeError(f"source video not found: {src}")
    if dst is None:
        dst = str(src_p.with_name(src_p.stem + "_h264.mp4"))
    exe = ffmpeg_exe()
    cmd = [exe, "-y", "-i", str(src_p), *H264_ARGS, str(dst)]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not Path(dst).exists():
        raise TranscodeError(f"ffmpeg failed: {proc.stderr[-400:]}")
    return dst


def transcode_in_place(path: str) -> str:
    """Transcode ``path`` to H.264 and replace it (same filename). Returns ``path``."""
    tmp = to_browser_h264(path, str(Path(path).with_name(Path(path).stem + ".__h264.mp4")))
    Path(tmp).replace(path)
    return path


def probe_codec(path: str) -> dict:
    """Return {'codec': str, 'pix_fmt': str} for the first video stream.

    Parsed from ffmpeg's stream banner (works without a separate ffprobe binary).
    """
    exe = ffmpeg_exe()
    out = subprocess.run([exe, "-hide_banner", "-i", path],
                         capture_output=True, text=True).stderr
    codec = pix_fmt = None
    vline = next((ln for ln in out.splitlines() if "Video:" in ln), "")
    cm = re.search(r"Video:\s*([A-Za-z0-9_]+)", vline)
    if cm:
        codec = cm.group(1)
    pm = re.search(r"\b(yuv[a-z0-9]+|yuvj[a-z0-9]+|rgb[a-z0-9]+|gray|nv12|nv21)\b", vline)
    if pm:
        pix_fmt = pm.group(1)
    return {"codec": codec, "pix_fmt": pix_fmt}
