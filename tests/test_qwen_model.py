"""Model provenance and default selection checks; no weights or training."""
import json
import tempfile
import unittest
from pathlib import Path
from scripts.qwen_model import default_model_path,model_version
from scripts.qwen_output import normalize_optional_caps


class ModelSelectionTests(unittest.TestCase):
    def test_null_optional_numbers_are_omitted_without_altering_constraints_or_input(self):
        result={'filters':{'maxCaffeine':None,'maxPrice':80,'milkTea':False,'excludedToppings':['珍珠'],'milk':None}}
        normalized=normalize_optional_caps(result)
        self.assertNotIn('maxCaffeine',normalized['filters'])
        self.assertEqual(normalized['filters']['maxPrice'],80)
        self.assertFalse(normalized['filters']['milkTea'])
        self.assertEqual(normalized['filters']['excludedToppings'],['珍珠'])
        self.assertIsNone(normalized['filters']['milk'])
        self.assertIn('maxCaffeine',result['filters'])
    def test_training_and_inference_default_is_the_requested_9b_family(self):
        self.assertEqual(default_model_path(Path('/project')),Path('/project/training_artifacts/qwen3.5-9b-4bit'))

    def test_supported_rollback_and_new_model_have_distinct_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)
            for base,repo,prefix in [
                ('Qwen/Qwen3-8B','mlx-community/Qwen3-8B-4bit','qwen3-8b-4bit-'),
                ('Qwen/Qwen3.5-9B','mlx-community/Qwen3.5-9B-4bit','qwen3.5-9b-4bit-')]:
                source={'base':base,'model':repo,'revision':'a'*40,'quantization':'4bit'}
                (path/'source.json').write_text(json.dumps(source))
                self.assertTrue(model_version(path).startswith(prefix))
                for update in [{'model':'untrusted/repo'},{'revision':'main'},{'base':'Qwen/Qwen3.5-4B'},{'quantization':'8bit'}]:
                    (path/'source.json').write_text(json.dumps(dict(source,**update)))
                    with self.assertRaises(ValueError):model_version(path)

if __name__=='__main__':unittest.main()
