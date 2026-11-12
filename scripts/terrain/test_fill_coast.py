import unittest
from fill_coast import fill_coast


class CoastInterpolationTest(unittest.TestCase):
    # 突變：把所有缺值補零、修改實測點、取消缺口大小限制、把圖框外當海。
    def setUp(self):
        self.points = [[c*20-20, r*20-20] for r in range(7) for c in range(7)]
        self.land = [[[[0, -30], [130, -30], [130, 130], [0, 130]]]]
        self.extent = [-30, -30, 130, 130]

    def test_sea_zero_and_land_interpolation_preserve_measurements(self):
        source = [100]*49
        source[7], source[17] = None, None  # 海面 (-20,0)、陸地 (40,20)
        heights, sea, estimated, unresolved, _ = fill_coast(source, 7, self.points, self.land, self.extent)
        self.assertEqual(heights[7], 0)
        self.assertEqual(sea, [[7, 1]])
        self.assertGreater(heights[17], 0)
        self.assertLess(heights[17], 100)
        self.assertEqual(estimated, [17])
        self.assertEqual(unresolved, [])
        for i, z in enumerate(source):
            if z is not None:
                self.assertEqual(heights[i], z)

    def test_large_land_hole_stays_unknown(self):
        source = [100]*49
        missing = [r*7+c for r in range(1, 5) for c in range(2, 6)]
        for i in missing:
            source[i] = None
        heights, _, estimated, unresolved, _ = fill_coast(source, 7, self.points, self.land, self.extent)
        self.assertEqual(estimated, [])
        self.assertEqual(unresolved, missing)
        self.assertTrue(all(heights[i] is None for i in missing))

    def test_outside_coast_extent_is_not_assumed_sea(self):
        source = [100]*49
        source[7] = None
        heights, sea, _, _, _ = fill_coast(source, 7, self.points, self.land, [0, -30, 130, 130])
        self.assertIsNone(heights[7])
        self.assertEqual(sea, [])


if __name__ == '__main__':
    unittest.main()
