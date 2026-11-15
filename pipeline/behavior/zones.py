"""Kennel zones: per-camera "front/door" region in normalized coordinates.

Zones are read from ``config/cameras.json``, keyed by camera id, as a polygon in
normalized (0-1) coordinates. A missing camera defaults to the bottom 35% of the
frame. Membership is tested against a box's bottom-center point (where a standing
dog's feet are), which is the most stable indicator of being at the door.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .settings import CONFIG_DIR

Point = tuple[float, float]
Polygon = list[Point]

# Bottom 35% of the frame, normalized.
DEFAULT_FRONT_ZONE: Polygon = [(0.0, 0.65), (1.0, 0.65), (1.0, 1.0), (0.0, 1.0)]


def load_zone(camera_id: str, *, config_dir: Optional[Path] = None) -> Polygon:
    """Return the front/door polygon for ``camera_id`` or the default."""
    config_dir = config_dir or CONFIG_DIR
    path = config_dir / "cameras.json"
    if not path.exists():
        return list(DEFAULT_FRONT_ZONE)
    data = json.loads(path.read_text())
    cam = data.get(camera_id)
    if not cam or "front_zone" not in cam:
        return list(DEFAULT_FRONT_ZONE)
    return [(float(x), float(y)) for x, y in cam["front_zone"]]


def point_in_polygon(pt: Point, polygon: Polygon) -> bool:
    """Ray-casting point-in-polygon test in normalized coordinates."""
    x, y = pt
    inside = False
    n = len(polygon)
    for i in range(n):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            x_cross = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < x_cross:
                inside = not inside
    return inside


def box_bottom_center(box_norm: tuple[float, float, float, float]) -> Point:
    """Bottom-center point of a normalized (x1,y1,x2,y2) box."""
    x1, _y1, x2, y2 = box_norm
    return ((x1 + x2) / 2.0, y2)


def in_zone(box_norm: tuple[float, float, float, float], polygon: Polygon) -> bool:
    """True if the box's bottom-center is inside ``polygon``."""
    return point_in_polygon(box_bottom_center(box_norm), polygon)
