"""Inference tests use existing trusted weights; no optimizer or training."""
import hashlib
import json
import unittest
import tempfile
from pathlib import Path
from scripts.relgt_inference import RelgtRanker,ROOT

CHECKPOINT=ROOT/'training_artifacts/20261013T155618-relgt-long-intent/model.pt'

@unittest.skipUnless(CHECKPOINT.exists(),'Existing local checkpoint required')
class RelgtInferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        report=json.loads((ROOT/'docs/training-runs/20261013T155618-relgt-long-intent.json').read_text())
        cls.rank=RelgtRanker(CHECKPOINT,report['checkpoint_sha256'])
        s=next(s for s in cls.rank.saved['samples'] if s['history'])
        cls.job={'userCode':s['user_code'],'at':s['at'],'history':[{'drinkId':cls.rank.products[e['product']]['id'],'action':e['action'],'occurredAt':e['occurred_at']} for e in s['history']],
                 'candidateIds':list(cls.rank.lookup),'catalogVersion':cls.rank.catalog_version,'topK':100}
        cls.before={k:v.clone() for k,v in cls.rank.model.state_dict().items()}

    def test_full_catalog_is_repeatable_and_preserves_weights(self):
        a=self.rank.rank(self.job);b=self.rank.rank(self.job)
        self.assertEqual(a['scores'],b['scores']);self.assertEqual(len(a['scores']),100)
        self.assertTrue(all(self.rank.torch.equal(v,self.rank.model.state_dict()[k]) for k,v in self.before.items()))
        print('RELGT_INFERENCE_SAFE_SUMMARY='+json.dumps({'candidates':len(self.job['candidateIds']),'outputs':len(a['scores']),'duration_ms':a['durationMs'],'repeatable':True,'weights_changed':False}))

    def test_cold_start_and_future_history_are_not_scored(self):
        self.assertEqual(self.rank.rank({**self.job,'userCode':'u_'+'f'*64})['fallbackReason'],'new_user')
        self.assertEqual(self.rank.rank({**self.job,'history':[]})['fallbackReason'],'no_history')
        for timestamp in [self.job['at'],self.job['at']+1]:
            with self.assertRaises(ValueError):self.rank.rank({**self.job,'history':[{**self.job['history'][0],'occurredAt':timestamp}]})
        with self.assertRaises(ValueError):self.rank.rank({**self.job,'catalogVersion':'stale'})

    def test_single_candidate_and_variant_scores(self):
        ids=self.job['candidateIds'][:1]
        result=self.rank.rank({**self.job,'candidateIds':ids})
        self.assertEqual(len(result['scores']),1)
        self.assertEqual(result['scores'][0]['id'],ids[0])

    def test_changed_product_identity_cannot_use_old_checkpoint(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'data').mkdir()
            catalog=json.loads((ROOT/'data/catalog.json').read_text())
            catalog['drinks'][0]['name']='synthetic incompatible product'
            raw=json.dumps(catalog).encode();(root/'data/catalog.json').write_bytes(raw)
            (root/'data/catalog-update.json').write_text(json.dumps({'catalogVersion':hashlib.sha256(raw).hexdigest(),'compatibleCatalogVersions':[self.rank.training_catalog_version]}))
            with self.assertRaisesRegex(ValueError,'Product identity mismatch'):
                RelgtRanker(CHECKPOINT,hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest(),root)

if __name__=='__main__':unittest.main()
