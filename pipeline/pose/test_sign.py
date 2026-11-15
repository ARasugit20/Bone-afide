"""Facing left and facing right must give the same height sign. Run: python -m unittest test_sign"""
import unittest

from pose_features import signed_height


class SignTest(unittest.TestCase):
    def test_same_sign_either_facing(self):
        # Nose sits above the back line in image space (smaller y).
        right = signed_height((20, -30), (0, 0), (100, 0))
        left = signed_height((80, -30), (100, 0), (0, 0))
        self.assertGreater(right, 0)
        self.assertGreater(left, 0)
        self.assertAlmostEqual(right, left, places=6)


if __name__ == "__main__":
    unittest.main()
