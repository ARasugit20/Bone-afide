"""Pure diagnostics for a SuperAnimal pose JSON. No model calls."""
import math

CUTOFF = 0.25
GROUPS = {
    "head": ("nose", "upper_jaw", "lower_jaw", "left_eye", "right_eye", "left_earbase", "right_earbase", "left_earend", "right_earend"),
    "torso": ("neck_base", "neck_end", "back_base", "back_middle", "back_end", "throat_base", "throat_end"),
    "legs": ("front_left_thai", "front_right_thai", "front_left_knee", "front_right_knee", "front_left_paw", "front_right_paw",
             "back_left_thai", "back_right_thai", "back_left_knee", "back_right_knee", "back_left_paw", "back_right_paw"),
    "tail": ("tail_base", "tail_end"),
}
GATES = (0.15, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50)


def iqr(xs):
    if not xs:
        return None
    s = sorted(xs)

    def q(p):
        i = (len(s) - 1) * p
        lo, hi = math.floor(i), math.ceil(i)
        return s[lo] if lo == hi else s[lo] * (hi - i) + s[hi] * (i - lo)

    return q(0.75) - q(0.25)


def median(xs):
    if not xs:
        return None
    s = sorted(xs)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def frame_confs(pose, names=None):
    """Mean confidence of the requested keypoints per frame. Missing keypoints count as 0."""
    out = []
    for f in pose["frames"]:
        kp = f["keypoints"]
        use = names or list(kp)
        vals = [kp[n][2] if n in kp else 0.0 for n in use]
        out.append(sum(vals) / len(vals) if vals else 0.0)
    return out


def confidence_distribution(pose):
    confs = frame_confs(pose)
    n = len(confs) or 1
    return {
        "mean": round(sum(confs) / n, 3) if confs else None,
        "median": None if not confs else round(median(confs), 3),
        "iqr": None if not confs else round(iqr(confs), 3),
        "frac": {f">={g:.2f}": round(sum(c >= g for c in confs) / n, 3) for g in GATES},
    }


def group_confidence(pose):
    names = set(pose.get("keypoint_names") or [])
    out = {}
    for group, members in GROUPS.items():
        present = [m for m in members if m in names]
        if not present:
            out[group] = None
            continue
        confs = frame_confs(pose, present)
        low = sum(c < CUTOFF for c in confs) / (len(confs) or 1)
        out[group] = {"mean": round(sum(confs) / len(confs), 3), "median": round(median(confs), 3),
                      "iqr": round(iqr(confs), 3), "low_rate": round(low, 3)}
    return out


def _body_scale(frame):
    kp = frame["keypoints"]
    a, b = kp.get("neck_base"), kp.get("tail_base")
    if not a or not b or a[2] < CUTOFF or b[2] < CUTOFF:
        a, b = kp.get("neck_base"), kp.get("back_base")
    if not a or not b:
        return None
    d = math.hypot(b[0] - a[0], b[1] - a[1])
    return d if d > 1 else None


def normalized_jitter(pose, names):
    """Median frame-to-frame displacement divided by body length. None when scale is unknown."""
    frames = pose["frames"]
    moves = []
    for a, b in zip(frames, frames[1:]):
        scale = _body_scale(a) or _body_scale(b)
        if not scale:
            continue
        d = [math.hypot(b["keypoints"][n][0] - a["keypoints"][n][0], b["keypoints"][n][1] - a["keypoints"][n][1]) / scale
             for n in names if n in a["keypoints"] and n in b["keypoints"] and a["keypoints"][n][2] >= CUTOFF and b["keypoints"][n][2] >= CUTOFF]
        if d:
            moves.append(median(d))
    return None if not moves else round(median(moves), 4)


def median_filter(series, window):
    if window % 2 == 0:
        raise ValueError("window must be odd")
    half = window // 2
    out = []
    for i in range(len(series)):
        chunk = [v for v in series[max(0, i - half): i + half + 1] if v is not None]
        out.append(None if not chunk else median(chunk))
    return out


def quality_status(usable_frac, mean_conf, jitter):
    """Defined before use. STABLE needs usable frames, confidence, and low jitter together."""
    if usable_frac is None or usable_frac < 0.5 or mean_conf is None:
        return "INSUFFICIENT_VISIBILITY"
    if mean_conf >= 0.45 and usable_frac >= 0.8 and (jitter is None or jitter <= 0.05):
        return "STABLE"
    if mean_conf >= 0.35 and usable_frac >= 0.5:
        return "PARTIALLY_STABLE"
    return "UNSTABLE"
