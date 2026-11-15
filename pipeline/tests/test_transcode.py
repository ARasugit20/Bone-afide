"""Transcode tests: OpenCV mp4v -> browser-safe H.264."""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from behavior import transcode


def _write_mp4v(path, w=65, h=49, frames=10, fps=10):
    """Write a small mp4v video with ODD dimensions to exercise the even-scale filter."""
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    assert writer.isOpened()
    for i in range(frames):
        writer.write(np.full((h, w, 3), (i * 20) % 256, dtype=np.uint8))
    writer.release()


def test_transcode_output_is_h264_yuv420p(tmp_path):
    src = tmp_path / "in.mp4"
    _write_mp4v(src)
    out = transcode.to_browser_h264(str(src), str(tmp_path / "out.mp4"))
    info = transcode.probe_codec(out)
    assert info["codec"] == "h264", info
    assert info["pix_fmt"] == "yuv420p", info


def test_transcode_in_place_keeps_path_and_is_h264(tmp_path):
    p = tmp_path / "vid.mp4"
    _write_mp4v(p)
    returned = transcode.transcode_in_place(str(p))
    assert returned == str(p)
    assert transcode.probe_codec(str(p))["codec"] == "h264"


def test_transcode_missing_source_raises(tmp_path):
    with pytest.raises(transcode.TranscodeError):
        transcode.to_browser_h264(str(tmp_path / "nope.mp4"))


def test_even_dimensions_from_odd_input(tmp_path):
    # odd 65x49 input must become even (H.264 yuv420p requirement)
    src = tmp_path / "odd.mp4"
    _write_mp4v(src, w=65, h=49)
    out = transcode.to_browser_h264(str(src), str(tmp_path / "even.mp4"))
    cap = cv2.VideoCapture(out)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    assert w % 2 == 0 and h % 2 == 0, (w, h)
