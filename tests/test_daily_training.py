"""Verify export failure does not prevent other model trainers from running."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from scripts import run_daily_training as batch


class BatchTests(unittest.TestCase):
    def test_scheduled_encoder_is_macbert_with_ranking_evaluation(self):
        _, commands = batch.commands()
        self.assertNotIn('RoBERTa', commands)
        command = commands['MacBERT']
        self.assertEqual(command[command.index('--model') + 1], 'hfl/chinese-macbert-base')
        self.assertIn('--retrieval-eval', command)

    def test_export_failure_continues_macbert_and_qwen(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            (root/'data').mkdir();(root/'data/catalog.json').write_text('{}')
            (root/'docs/training-runs').mkdir(parents=True)
            runtime=root/'python';runtime.touch()
            commands={name:[str(runtime),str(root/name)] for name in ['RelGT','MacBERT','Qwen']}
            for name in commands:(root/name).touch()
            called=[]
            def execute(cmd,**kwargs):
                if cmd[0]=='pgrep':return SimpleNamespace(returncode=1)
                if cmd[0]=='node':return SimpleNamespace(returncode=1,stdout='')
                name=Path(cmd[1]).name;called.append(name)
                suffix={'MacBERT':'macbert-contrastive','Qwen':'qwen-intent-qlora'}[name]
                (root/'docs/training-runs'/('test-'+suffix+'.json')).write_text(json.dumps({'status':'trained_test_fixture','optimizer_steps':1,'weights_changed':True}))
                return SimpleNamespace(returncode=0)
            with patch.object(batch,'ROOT',root),patch.object(batch,'commands',return_value=('node',commands)),patch.object(batch.subprocess,'run',side_effect=execute),patch.object(batch.subprocess,'check_output',side_effect=lambda *a,**k:'fixture' if k.get('text') else b''),patch('sys.argv',['runner']):
                self.assertEqual(batch.main(),1)
            self.assertEqual(called,['MacBERT','Qwen'])
            report=json.loads(next((root/'docs/training-runs').glob('*daily-training.json')).read_text())
            self.assertEqual(report['models']['RelGT']['optimizer_steps'],0)
            self.assertEqual(report['models']['MacBERT']['optimizer_steps'],1)
            self.assertEqual(report['models']['MacBERT']['exit_code'],0)
            self.assertEqual(report['status'],'completed_with_failures')
            self.assertEqual(report['dashboard_sync']['status'],'failed')
            self.assertFalse(report['dashboard_sync']['raw_reports_uploaded'])


if __name__=='__main__':unittest.main()
