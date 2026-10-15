"""Verify ranking changes and failed evaluation cannot masquerade as improvement."""
import unittest
from training.run_reports import add_comparison, comparison_markdown


class ScheduledRankingReports(unittest.TestCase):
    def fixture(self):
        return {'status': 'trained_proxy_evaluated_not_published', 'optimizer_steps': 75,
                'published': False, 'weights_changed': True,
                'retrieval_evaluation': {
                    'before': {'means': {'precision_at_10': 0.5, 'recall_at_10': 0.1, 'ndcg_at_10': 0.6},
                               'query_median_ms': 8, 'query_p95_ms': 10, 'index_s': 16},
                    'after': {'means': {'precision_at_10': 0.7, 'recall_at_10': 0.09, 'ndcg_at_10': 0.72},
                              'query_median_ms': 9, 'query_p95_ms': 11, 'index_s': 17}}}

    def test_reports_improvement_regression_and_latency_without_training_loss(self):
        r = add_comparison(self.fixture())
        metrics = {x['name']: x for x in r['before_after_comparison']['metrics']}
        self.assertAlmostEqual(metrics['catalog_proxy_precision_at_10']['delta_after_minus_before'], 0.2)
        self.assertAlmostEqual(metrics['catalog_proxy_recall_at_10']['delta_after_minus_before'], -0.01)
        self.assertEqual(metrics['retrieval_query_median_ms']['delta_after_minus_before'], 1)
        self.assertEqual(metrics['catalog_proxy_ndcg_at_10']['better_direction'], 'higher')
        self.assertIn('catalog_proxy_ndcg_at_10', comparison_markdown(r))
        self.assertFalse(r['before_after_comparison']['published'])

    def test_failed_post_evaluation_preserves_actual_steps_and_unknown_metrics(self):
        r = self.fixture(); r['status'] = 'failed'; del r['retrieval_evaluation']['after']
        add_comparison(r)
        self.assertEqual(r['optimizer_steps'], 75)
        self.assertTrue(r['before_after_comparison']['weights_changed'])
        for m in r['before_after_comparison']['metrics']:
            self.assertIsNone(m['after']); self.assertIsNone(m['delta_after_minus_before'])
            self.assertIsNotNone(m['reason'])

    def test_pre_training_failure_has_no_fabricated_weights_or_improvement(self):
        r = {'status': 'failed', 'optimizer_steps': 0, 'weights_changed': False}
        add_comparison(r)
        self.assertFalse(r['before_after_comparison']['weights_changed'])
        self.assertEqual(r['before_after_comparison']['metrics'], [])
        self.assertIn('未取得', comparison_markdown(r))


if __name__ == '__main__': unittest.main()
