import json
import unittest

from scripts.catalog_products import normalize, expand


class GroupedCatalogTests(unittest.TestCase):
    def test_round_trip_preserves_every_variant_and_original_order(self):
        source = {'total': 3, 'drinks': [
            {'id': 'a', 'brand': 'B', 'name': 'Tea', 'price': 40, 'cupSize': 'M', 'sourceStoreIds': ['s1']},
            {'id': 'b', 'brand': 'C', 'name': 'Coffee', 'price': 50, 'cupSize': 'M'},
            {'id': 'c', 'brand': 'B', 'name': 'Tea', 'price': 55, 'cupSize': 'L', 'sourceStoreIds': ['s2']},
        ]}
        grouped = normalize(source)
        self.assertEqual(grouped['productCount'], 2)
        self.assertEqual(grouped['variantTotal'], 3)
        self.assertEqual(expand(grouped), source)


if __name__ == '__main__':
    unittest.main()
