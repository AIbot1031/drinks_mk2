import unittest
from scripts.build_training_summaries import summarize
class SummaryTests(unittest.TestCase):
 def test_raw_content_never_copied_and_failure_not_filled(self):
  r={'run_id':'20261016T020051-qwen-intent-qlora','started_at':'2026-10-16T02:00:51+08:00','status':'failed','optimizer_steps':0,'cookie':'secret','history':['private'],'reason':'sensitive traceback','before_after_comparison':{'metrics':[{'name':'all_intent_exact_rate','before':.9,'after':None,'better_direction':'higher'}]}}
  s=summarize(r)
  self.assertNotIn('cookie',s);self.assertNotIn('history',s);self.assertNotIn('reason',s)
  self.assertIsNone(s['metrics'][0]['after']);self.assertIsNone(s['metrics'][0]['delta']);self.assertEqual(s['steps'],0)
 def test_real_temporal_holdout_is_not_described_as_training_only(self):
  s=summarize({'run_id':'20261016T015906-relgt-long-intent','started_at':'2026-10-16T01:59:06+08:00','split_rows':{'validation':2},'status':'trained_chronological_holdout'})
  self.assertEqual(s['scope'],'temporal-holdout')
if __name__=='__main__':unittest.main()
