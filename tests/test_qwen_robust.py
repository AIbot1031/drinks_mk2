import copy
import json
import unittest
from training.qwen_robust_cases import datasets,semantic_metrics,normalized_filters,schema


class RobustDataTests(unittest.TestCase):
    def test_actual_model_payloads_are_disjoint_after_worker_preprocessing(self):
        train,valid=datasets()
        hashed={json.dumps(c['input'],sort_keys=True) for c in train}
        self.assertTrue(all(json.dumps(c['input'],sort_keys=True) not in hashed for c in valid))
        self.assertEqual(sum(c['group']=='regression' for c in valid),29)
        for c in train+valid:
            self.assertIn('guard',c['input']['state'])
            self.assertIn('drink-catalog-v2',c['input']['catalogFeatures']['version'])
            self.assertTrue(schema(c['expected'],c['input']))

    def test_zero_and_false_are_scored_as_real_constraints(self):
        c=next(c for c in datasets()[1] if c['expected']['filters'].get('maxCaffeine')==0)
        correct=copy.deepcopy(c['expected'])
        self.assertEqual(semantic_metrics([{'case':c,'prediction':correct}])['action_filters_rate'],1)
        del correct['filters']['maxCaffeine']
        self.assertEqual(semantic_metrics([{'case':c,'prediction':correct}])['action_filters_rate'],0)
        self.assertEqual(normalized_filters({'milkTea':False,'maxCaffeine':0,'excludedBrands':[]}),{'milkTea':False,'maxCaffeine':0})

    def test_illegal_numeric_and_hallucinated_fields_cannot_score_as_correct(self):
        c=datasets()[0][0]
        for f in [{'maxCaffeine':-1},{'maxCaffeine':float('nan')},{'maxCaffeine':True},{'tools':['delete']},{'brand':'未提供品牌'}]:
            value={**c['expected'],'filters':f}
            self.assertFalse(schema(value,c['input']))

    def test_no_training_target_requires_and_excludes_same_topping(self):
        for c in datasets()[0]:
            f=c['expected']['filters']
            self.assertNotIn(f.get('topping',''),f.get('excludedToppings',[]))
            self.assertFalse(f.get('milk')=='none' and f.get('milkTea') is True)


if __name__=='__main__':unittest.main()
