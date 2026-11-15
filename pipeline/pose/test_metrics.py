import unittest

from metrics import confidence_distribution, group_confidence, iqr, median, median_filter, normalized_jitter, quality_status


def pose(frames):
    return {"keypoint_names": ["nose", "neck_base", "tail_base"], "frames": [{"keypoints": f} for f in frames]}


class MetricsTest(unittest.TestCase):
    def test_iqr_and_median(self):
        self.assertEqual(median([1, 3, 2]), 2)
        self.assertAlmostEqual(iqr([1, 2, 3, 4]), 1.5)

    def test_confidence_distribution(self):
        p = pose([{ "nose": [0, 0, 0.2], "neck_base": [0, 0, 0.6], "tail_base": [1, 0, 0.9] }])
        d = confidence_distribution(p)
        self.assertAlmostEqual(d["mean"], 0.567, places=3)
        self.assertEqual(d["frac"][">=0.50"], 1.0)

    def test_group_confidence(self):
        p = pose([{"nose": [0, 0, 0.9], "neck_base": [0, 0, 0.1], "tail_base": [10, 0, 0.8]}])
        g = group_confidence(p)
        self.assertGreater(g["head"]["mean"], g["torso"]["mean"])
        self.assertEqual(g["torso"]["low_rate"], 1.0)

    def test_jitter_uses_body_scale(self):
        a = {"nose": [0, 0, 0.9], "neck_base": [0, 0, 0.9], "tail_base": [10, 0, 0.9]}
        b = {"nose": [5, 0, 0.9], "neck_base": [0, 0, 0.9], "tail_base": [10, 0, 0.9]}
        self.assertAlmostEqual(normalized_jitter(pose([a, b]), ["nose"]), 0.5)

    def test_median_filter_keeps_a_real_jump_visible_nearby(self):
        self.assertEqual(median_filter([1, 100, 1, 1, 1], 3)[1], 1)

    def test_quality_status_rules(self):
        self.assertEqual(quality_status(0.9, 0.5, 0.02), "STABLE")
        self.assertEqual(quality_status(0.6, 0.36, 0.2), "PARTIALLY_STABLE")
        self.assertEqual(quality_status(0.2, 0.2, 0.4), "INSUFFICIENT_VISIBILITY")
        self.assertEqual(quality_status(0.7, 0.3, 0.01), "UNSTABLE")


if __name__ == "__main__":
    unittest.main()
