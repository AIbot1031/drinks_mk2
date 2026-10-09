import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path

from training.preference_data import prepare


def catalog(n=1):
    return [{'id': f'd{i}', 'brand': '品牌', 'name': f'品名{i//2}',
             'richness': 0.2, 'noMilk': True, 'tea': ['綠茶'], 'milk': [],
             'toppings': []} for i in range(n)]


def snapshot(likes, dislikes):
    return {'schema': 1, 'kind': 'current-preference-snapshot', 'users': [
        {'user_code': 'u_'+'a'*64, 'likedIds': likes, 'dislikedIds': dislikes}]}


class PreferenceDataTest(unittest.TestCase):
    def test_unlabelled_never_negative_and_one_real_label_allowed(self):
        rows, split, count, _ = prepare(snapshot(['d0'], []), catalog(10))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['label'], 1)
        self.assertEqual(count['dislikes'], 0)
        self.assertEqual(split, {'train': [0], 'validation': [], 'test': []})

    def test_invalid_duplicates_and_conflicts_do_not_become_labels(self):
        rows, _, count, _ = prepare(snapshot(['d0', 'd0', 'd1', 'missing'], ['d1']), catalog(3))
        self.assertEqual([(r['drink']['id'], r['label']) for r in rows], [('d0', 1)])
        self.assertEqual(count['conflicts_removed'], 1)
        self.assertEqual(count['invalid_ids'], 1)
        self.assertEqual(count['duplicates_removed'], 1)

    def test_login_ids_rejected_and_empty_snapshot_skips(self):
        s = snapshot([], [])
        s['users'][0]['user_code'] = 'realLogin123'
        with self.assertRaises(ValueError):
            prepare(s, catalog())
        rows, _, counts, _ = prepare({'schema': 1, 'kind': 'current-preference-snapshot', 'users': []}, catalog())
        self.assertEqual(rows, [])
        self.assertEqual(counts['rows'], 0)

    def test_variants_do_not_cross_holdout_groups(self):
        drinks = catalog(200)
        rows, split, _, _ = prepare(snapshot([d['id'] for d in drinks[:100]],
                                            [d['id'] for d in drinks[100:]]), drinks)
        self.assertTrue(all(split.values()))
        groups = {k: {rows[i]['group'] for i in ids} for k, ids in split.items()}
        self.assertFalse(groups['train'] & groups['validation'])
        self.assertFalse(groups['train'] & groups['test'])
        self.assertFalse(groups['validation'] & groups['test'])

    def test_singleton_official_model_backward_and_checkpoint_reload(self):
        # Artificial fixture ONLY for software verification, never a real-user run.
        root = Path(__file__).resolve().parents[1]
        spec = importlib.util.spec_from_file_location('preference_trainer', root/'scripts/train_preferences.py')
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        rows, split, _, _ = prepare(snapshot(['d0'], []), catalog())
        args = type('Args', (), {'seed': 42, 'epochs': 1, 'batch_size': 64, 'learning_rate': 0.001})()
        (root/'training_artifacts').mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root/'training_artifacts', prefix='software-test-') as folder:
            report = {'snapshot_sha256': 'fixture-only'}
            with contextlib.redirect_stdout(io.StringIO()):
                mod.train(rows, split, args, report, Path(folder))
            self.assertEqual(report['status'], 'trained_unvalidated')
            self.assertTrue(report['checkpoint_reload_verified'])
            self.assertEqual(report['after_training']['train']['rows'], 1)
            self.assertIsNone(report['after_training']['test'])


if __name__ == '__main__':
    unittest.main()
