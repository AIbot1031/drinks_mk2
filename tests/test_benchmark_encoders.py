"""Check evaluation semantics independently of expensive model inference."""
import unittest
from scripts.benchmark_encoders import metrics, relevant, SPECS, ROOT
import json


class EvaluationTests(unittest.TestCase):
    def test_discounted_wrong_first_result(self):
        good = metrics([1, 0], 1)
        bad = metrics([0, 1], 1)
        self.assertAlmostEqual(good['ndcg_at_10'], 1)
        self.assertAlmostEqual(bad['ndcg_at_10'], 1 / __import__('math').log2(3))
        self.assertEqual(good['recall_at_10'], bad['recall_at_10'])

    def test_conflicting_milk_is_not_positive_label(self):
        d = {'milk': ['鮮奶'], 'tea': ['紅茶'], 'milkConflict': True}
        self.assertFalse(relevant(d, {'milk': '鮮奶'}))
        self.assertFalse(relevant(d, {'milkAny': True}))

    def test_named_milk_tea_does_not_require_missing_tea_tag(self):
        d = {'name': '珍珠奶茶', 'milk': ['奶精'], 'tea': [], 'toppings': ['珍珠']}
        self.assertTrue(relevant(d, {'milkAny': True, 'topping': '珍珠'}))

    def test_combined_labels_require_all_conditions(self):
        d = {'milk': ['鮮奶'], 'tea': ['紅茶'], 'toppings': ['珍珠'], 'brand': '測試'}
        self.assertTrue(relevant(d, {'tea': '紅茶', 'milk': '鮮奶'}))
        self.assertFalse(relevant(d, {'tea': '綠茶', 'milk': '鮮奶'}))

    def test_catalog_has_positive_and_negative_products_for_every_query(self):
        rows = json.loads((ROOT / 'data/catalog.json').read_text())['drinks']
        groups = {}
        for d in rows: groups.setdefault((d['brand'], d['name']), []).append(d)
        for q, fields in SPECS:
            labels = [any(relevant(d, fields) for d in variants) for variants in groups.values()]
            self.assertTrue(any(labels), q)
            self.assertTrue(not all(labels), q)


if __name__ == '__main__': unittest.main()
