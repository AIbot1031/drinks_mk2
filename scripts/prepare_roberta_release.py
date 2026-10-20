"""Prepare and verify a local RoBERTa release candidate. Never connects or deploys.

Uses the production embed pooling, input validation and candidate-only ranking
contract, but preserves the actual RoBERTa identity. Credentials are not read.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import plistlib
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.macbert_agent import Ranker


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1048576), b''): h.update(block)
    return h.hexdigest()


def verify_report(report_path, catalog_path):
    report = json.loads(Path(report_path).read_text())
    weights = (ROOT / report['checkpoint']).resolve()
    if not weights.is_relative_to(ROOT / 'training_artifacts') or weights.name != 'model.safetensors':
        raise ValueError('Candidate weights must be inside local training_artifacts')
    if report['source']['model'] != 'hfl/chinese-roberta-wwm-ext':
        raise ValueError('Not an approved RoBERTa source')
    if report.get('status', '').startswith(('failed', 'skipped')) or not report.get('weights_changed'):
        raise ValueError('Candidate training was not completed')
    if report.get('optimizer_steps', 0) < 1 or report.get('checkpoint_reload_max_error') is None or report['checkpoint_reload_max_error'] > 1e-5:
        raise ValueError('Candidate has not passed save/reload validation')
    if report['data']['catalog_sha256'] != sha(catalog_path):
        manifest_path = Path(catalog_path).parent / 'catalog-update.json'
        manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
        if manifest.get('catalogVersion') != sha(catalog_path) or report['data']['catalog_sha256'] not in manifest.get('compatibleCatalogVersions', []):
            raise ValueError('Stale training catalog')
    if report['checkpoint_sha256'] != sha(weights): raise ValueError('Candidate checksum mismatch')
    return report, weights


class LocalRoBERTa:
    # Reuse production mask-aware mean pooling, normalization and 64-token limit.
    embed = Ranker.embed
    memory = Ranker.memory

    def __init__(self, report_path, device='mps'):
        import numpy as np
        import torch
        from transformers import AutoModel, AutoTokenizer
        report, weights = verify_report(report_path, ROOT / 'data/catalog.json')
        if device == 'mps' and not torch.backends.mps.is_available(): raise RuntimeError('MPS unavailable')
        torch.set_num_threads(4)
        self.np = np; self.torch = torch; self.device = device
        self.report = report; self.weights = weights
        self.catalog_version = sha(ROOT / 'data/catalog.json')
        self.model_version = 'roberta-wwm-' + report['checkpoint_sha256'][:16]
        self.model = AutoModel.from_pretrained(weights.parent, local_files_only=True,
            trust_remote_code=False, use_safetensors=True, attn_implementation='eager').to(device).eval()
        self.tokenizer = AutoTokenizer.from_pretrained(weights.parent, local_files_only=True, trust_remote_code=False)
        self.rows = json.loads((ROOT / 'data/catalog.json').read_text())['drinks']
        self.ids = [d['id'] for d in self.rows]
        if len(set(self.ids)) != len(self.ids): raise ValueError('Duplicate catalog IDs')
        self.lookup = {key: i for i, key in enumerate(self.ids)}
        self.index_path = ROOT / 'training_artifacts' / ('roberta-wwm-index-' + self.catalog_version[:12] + '-' + report['checkpoint_sha256'][:12] + '.npz')
        if self.index_path.exists():
            with np.load(self.index_path, allow_pickle=False) as cache:
                if list(cache['ids']) != self.ids or str(cache['catalog_sha256']) != self.catalog_version or str(cache['weights_sha256']) != report['checkpoint_sha256']:
                    raise ValueError('Cached index version mismatch')
                self.vectors = cache['vectors']
        else:
            texts = []
            for d in self.rows:
                milk = [] if d.get('milkConflict') else d['milk']
                text = '。'.join([d['brand'], d['name'], '茶種：' + '、'.join(d['tea']),
                    '奶類：' + '、'.join(milk), '配料：' + '、'.join(d['toppings']), d['taste'][:120]])
                texts.append(re.sub(r'https?://\S+|\d+(?:\.\d+)?', '', text))
            self.vectors = np.concatenate([self.embed(texts[i:i+64]) for i in range(0, len(texts), 64)])
            self.validate_vectors()
            np.savez_compressed(self.index_path, ids=np.array(self.ids), vectors=self.vectors,
                catalog_sha256=self.catalog_version, weights_sha256=report['checkpoint_sha256'])
        self.validate_vectors()

    def validate_vectors(self):
        if self.vectors.shape != (len(self.ids), 768) or not self.np.isfinite(self.vectors).all():
            raise ValueError('Invalid index shape or values')
        if not self.np.allclose(self.np.linalg.norm(self.vectors, axis=1), 1, atol=1e-4):
            raise ValueError('Index vectors must be normalized')

    def rank(self, job):
        if job.get('catalogVersion') != self.catalog_version: raise ValueError('Catalog mismatch')
        query, ids, k = job.get('query'), job.get('candidateIds'), job.get('topK')
        if not isinstance(query, str) or len(query) > 300 or not isinstance(ids, list) or not 1 <= len(ids) <= len(self.lookup) or type(k) is not int or not 1 <= k <= 100:
            raise ValueError('Invalid rank request')
        if any(not isinstance(key, str) for key in ids) or len(ids) != len(set(ids)) or any(key not in self.lookup for key in ids):
            raise ValueError('Invalid candidate IDs')
        start = time.perf_counter()
        indexes = [self.lookup[key] for key in ids]
        scores = self.vectors[indexes] @ self.embed([query])[0] if query.strip() else self.np.zeros(len(ids))
        if not self.np.isfinite(scores).all(): raise ValueError('Invalid rank scores')
        order = sorted(range(len(ids)), key=lambda i: (-float(scores[i]), ids[i]))[:k]
        return {'scores': [{'id': ids[i], 'score': float(scores[i])} for i in order],
            'modelVersion': self.model_version, 'catalogVersion': self.catalog_version,
            'durationMs': (time.perf_counter() - start) * 1000}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--report', type=Path, default=ROOT / 'docs/training-runs/20261015T005748-roberta-wwm-contrastive.json')
    parser.add_argument('--benchmark', type=Path, default=ROOT / 'docs/model-validation/20261015T005914-v3.1-encoders/summary.json')
    parser.add_argument('--device', choices=['mps', 'cpu'], default='mps')
    args = parser.parse_args()
    now = datetime.now(ZoneInfo('Asia/Taipei'))
    output = ROOT / 'docs/model-validation' / (now.strftime('%Y%m%dT%H%M%S') + '-roberta-release-preparation.json')
    result = {'started_at': now.isoformat(), 'published': False, 'training_performed': False,
        'deployment_ready': False, 'checks': {}, 'pending': ['3.0 deployment and GitHub completion',
            'Worker routeA, UI and operational monitoring must show RoBERTa identity',
            'isolated Worker integration, outage fallback and deployment rollback validation']}
    try:
        ranker = LocalRoBERTa(args.report, args.device)
        np = ranker.np
        previous = json.loads(args.benchmark.read_text())
        old = next(m for m in previous['models'] if m['name'] == 'roberta-wwm-trained')
        if old['weights_sha256'] != ranker.report['checkpoint_sha256'] or previous['catalog_sha256'] != ranker.catalog_version:
            raise ValueError('Benchmark is not for this candidate/catalog')
        groups = {}
        for i, d in enumerate(ranker.rows): groups.setdefault((d['brand'], d['name']), []).append(i)
        keys = list(groups)
        mismatches = []
        # A deployment adapter must reproduce every recorded top-10 product.
        for case in old['cases']:
            scores = ranker.vectors @ ranker.embed([case['query']])[0]
            order = sorted(range(len(keys)), key=lambda j: (-float(max(scores[groups[keys[j]]])), keys[j]))[:10]
            actual = [keys[i] for i in order]
            expected = [(d['brand'], d['name']) for d in case['top10']]
            if actual != expected: mismatches.append(case['query'])
        if mismatches: raise ValueError('Rankings differ from the evaluated candidate')
        result['checks']['all_24_top10_match_benchmark'] = True
        ids = ranker.ids[:64]
        job = {'query': '紅茶拿鐵', 'candidateIds': ids, 'catalogVersion': ranker.catalog_version, 'topK': 10}
        reply = ranker.rank(job)
        assert all(x['id'] in ids and math.isfinite(x['score']) and abs(x['score']) <= 1.001 for x in reply['scores'])
        assert reply['modelVersion'].startswith('roberta-wwm-')
        result['checks']['actual_candidate_subset_and_identity'] = True
        for patch in [{'catalogVersion': 'stale'}, {'candidateIds': ['unknown']}, {'candidateIds': [ids[0], ids[0]]},
                      {'query': '字' * 301}, {'topK': True}, {'topK': 101}, {'candidateIds': []}]:
            try: ranker.rank({**job, **patch})
            except ValueError: continue
            raise AssertionError('Accepted invalid contract input')
        result['checks']['seven_invalid_requests_rejected'] = True
        result['checks']['blank_query_zero_scores'] = all(x['score'] == 0 for x in ranker.rank({**job, 'query': ' '})['scores'])
        if not result['checks']['blank_query_zero_scores']: raise AssertionError('Blank query mismatch')
        before = ranker.embed(['紅茶拿鐵'])
        # Reload disk index and re-encode through the same object without switching services.
        with np.load(ranker.index_path, allow_pickle=False) as cache:
            assert np.array_equal(cache['vectors'], ranker.vectors)
        assert np.allclose(before, ranker.embed(['紅茶拿鐵']), atol=1e-5)
        result['checks']['index_reload_and_repeat_embedding'] = True
        plist_path = Path.home() / 'Library/LaunchAgents/local.drinks-mk2.macbert.plist'
        args_live = plistlib.loads(plist_path.read_bytes())['ProgramArguments']
        live = Path(args_live[args_live.index('--model') + 1])
        result['rollback_reference'] = {'weights_relative_to_runtime': str(live.relative_to(Path.home() / 'Library/Application Support/DrinksMk2')),
            'weights_sha256': sha(live / 'model.safetensors'), 'launchagent': 'local.drinks-mk2.macbert',
            'service_modified': False, 'rollback_exercised': False}
        result.update(status='offline_preparation_passed', modelVersion=ranker.model_version,
            catalogVersion=ranker.catalog_version, index_relative_path=str(ranker.index_path.relative_to(ROOT)),
            index_sha256=sha(ranker.index_path), vector_shape=list(ranker.vectors.shape), benchmark_report=str(args.benchmark.relative_to(ROOT)))
    except Exception as exc:
        result.update(status='failed', error_class=type(exc).__name__)
        raise
    finally:
        result['ended_at'] = datetime.now(ZoneInfo('Asia/Taipei')).isoformat()
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print('REPORT=' + str(output), flush=True)


if __name__ == '__main__': main()
