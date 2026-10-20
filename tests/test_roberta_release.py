"""Offline candidate release checks: metadata, ranking scope and rejection paths."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path
try:
    import numpy as np
except ImportError:
    np = None
from scripts.prepare_roberta_release import ROOT, LocalRoBERTa, verify_report


class ReleaseReportTests(unittest.TestCase):
    def test_bad_source_stale_catalog_and_changed_weights_rejected(self):
        (ROOT / 'training_artifacts').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / 'training_artifacts') as directory:
            root = Path(directory)
            weights = root / 'model.safetensors'; weights.write_bytes(b'fixture-weights')
            catalog = root / 'catalog.json'; catalog.write_bytes(b'catalog-v1')
            good = {'source': {'model': 'hfl/chinese-roberta-wwm-ext'},
                'checkpoint': str(weights.relative_to(ROOT)), 'checkpoint_sha256': hashlib.sha256(weights.read_bytes()).hexdigest(),
                'status': 'trained_unvalidated_for_retrieval', 'weights_changed': True,
                'optimizer_steps': 75, 'checkpoint_reload_max_error': 0,
                'data': {'catalog_sha256': hashlib.sha256(catalog.read_bytes()).hexdigest()}}
            report = root / 'report.json'; report.write_text(json.dumps(good))
            self.assertEqual(verify_report(report, catalog)[1], weights)
            for patch in [{'source': {'model': 'hfl/chinese-macbert-base'}},
                          {'data': {'catalog_sha256': 'stale'}}, {'checkpoint_sha256': 'wrong'},
                          {'optimizer_steps': 0}, {'checkpoint_reload_max_error': 0.1},
                          {'status': 'failed'}, {'checkpoint': '/tmp/model.safetensors'}]:
                report.write_text(json.dumps({**good, **patch}))
                with self.assertRaises(ValueError): verify_report(report, catalog)

    def test_reindex_uses_explicit_compatible_catalog_and_same_weights(self):
        (ROOT / 'training_artifacts').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=ROOT / 'training_artifacts') as directory:
            root=Path(directory);weights=root/'model.safetensors';weights.write_bytes(b'fixed-weights')
            catalog=root/'catalog.json';catalog.write_bytes(b'expanded catalog')
            report=root/'report.json'
            value={'source':{'model':'hfl/chinese-roberta-wwm-ext'},'checkpoint':str(weights.relative_to(ROOT)),
                   'checkpoint_sha256':hashlib.sha256(weights.read_bytes()).hexdigest(),'status':'trained',
                   'weights_changed':True,'optimizer_steps':1,'checkpoint_reload_max_error':0,
                   'data':{'catalog_sha256':'old-trained-catalog'}}
            report.write_text(json.dumps(value))
            manifest=root/'catalog-update.json'
            manifest.write_text(json.dumps({'catalogVersion':hashlib.sha256(catalog.read_bytes()).hexdigest(),
                                            'compatibleCatalogVersions':['old-trained-catalog']}))
            self.assertEqual(verify_report(report,catalog)[1],weights)
            manifest.write_text(json.dumps({'catalogVersion':'wrong','compatibleCatalogVersions':['old-trained-catalog']}))
            with self.assertRaises(ValueError):verify_report(report,catalog)


@unittest.skipIf(np is None, 'Optional model runtime NumPy not installed')
class LocalRankContractTests(unittest.TestCase):
    def setUp(self):
        self.ranker = LocalRoBERTa.__new__(LocalRoBERTa)
        r = self.ranker
        r.np = np; r.catalog_version = 'catalog'; r.model_version = 'roberta-wwm-test'
        r.lookup = {'tea': 0, 'milk': 1, 'excluded': 2}
        r.vectors = np.eye(3, dtype=np.float32)
        r.embed = lambda texts: np.array([[0.6, 0, 0.8]], dtype=np.float32)
        self.job = {'query': '茶', 'candidateIds': ['tea', 'milk'], 'catalogVersion': 'catalog', 'topK': 2}

    def test_high_scoring_excluded_product_cannot_enter_results(self):
        reply = self.ranker.rank(self.job)
        self.assertEqual([x['id'] for x in reply['scores']], ['tea', 'milk'])
        self.assertEqual(reply['modelVersion'], 'roberta-wwm-test')
        self.assertAlmostEqual(reply['scores'][0]['score'], 0.6)

    def test_stale_duplicate_and_unknown_candidates_fail_closed(self):
        for patch in [{'catalogVersion': 'old'}, {'candidateIds': ['tea', 'tea']},
                      {'candidateIds': ['unknown']}, {'candidateIds': [[]]}, {'topK': True}]:
            with self.assertRaises(ValueError): self.ranker.rank({**self.job, **patch})

    def test_empty_query_stable_zero_scores(self):
        reply = self.ranker.rank({**self.job, 'query': ' '})
        self.assertEqual(reply['scores'], [{'id': 'milk', 'score': 0}, {'id': 'tea', 'score': 0}])


if __name__ == '__main__': unittest.main()
