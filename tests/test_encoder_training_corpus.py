"""Training split checks independent of models; no data augmentation labels."""
import json
import unittest
from scripts.train_macbert import corpus, ROOT


class CorpusTests(unittest.TestCase):
    def test_price_changes_do_not_change_training_corpus(self):
        rows = json.loads((ROOT / 'data/catalog.json').read_text())['drinks'][:100]
        changed = [{**d, 'price': 99999, 'calories': 99999} for d in rows]
        self.assertEqual(corpus(rows, 42), corpus(changed, 42))

    def test_same_name_across_brands_and_variants_stays_in_one_split(self):
        def drink(brand):
            return {'brand': brand, 'name': '測試奶茶', 'tea': ['紅茶'], 'milk': ['鮮奶'], 'toppings': [], 'taste': ''}
        splits, count = corpus([drink('甲'), drink('乙'), drink('甲')], 42)
        self.assertEqual(count, 2)
        self.assertEqual(sorted(map(len, splits.values())), [0, 2])

    def test_corpus_matches_comparison_baseline(self):
        old = json.loads((ROOT / 'docs/training-runs/20261013T231557-macbert-contrastive.json').read_text())
        import hashlib
        raw = (ROOT / 'data/catalog.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), old['data']['catalog_sha256'])
        splits, _ = corpus(json.loads(raw)['drinks'], old['parameters']['seed'])
        self.assertEqual(len(splits['train']), old['data']['train_texts'])
        self.assertEqual(len(splits['validation']), old['data']['validation_texts'])


if __name__ == '__main__': unittest.main()
