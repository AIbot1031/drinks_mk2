"""Offline v3 encoder comparison. No training, service reload, or deployment.
Run: .venv-training/bin/python scripts/benchmark_encoders.py
Each model runs in a fresh process; downloads excluded from timings.
"""
import argparse
import hashlib
import json
import math
import os
import platform
import plistlib
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
SPECS = [
    ('紅茶', {'tea': '紅茶'}), ('想喝紅茶，茶香明顯', {'tea': '紅茶'}),
    ('綠茶', {'tea': '綠茶'}), ('來杯綠茶', {'tea': '綠茶'}),
    ('烏龍茶', {'tea': '烏龍茶'}), ('想喝烏龍茶', {'tea': '烏龍茶'}),
    ('紅茶加鮮奶', {'tea': '紅茶', 'milk': '鮮奶'}),
    ('紅茶拿鐵', {'tea': '紅茶', 'milk': '鮮奶'}),
    ('綠茶加鮮奶', {'tea': '綠茶', 'milk': '鮮奶'}),
    ('奶茶有珍珠', {'milkAny': True, 'topping': '珍珠'}),
    ('想喝有珍珠的奶茶', {'milkAny': True, 'topping': '珍珠'}),
    ('布丁奶茶', {'milkAny': True, 'topping': '布丁'}),
    ('奶蓋茶', {'topping': '奶蓋'}), ('想喝有奶蓋的飲料', {'topping': '奶蓋'}),
    ('仙草飲料', {'topping': '仙草'}), ('椰果飲料', {'topping': '椰果'}),
    ('芋圓飲料', {'topping': '芋圓'}), ('有冰淇淋的飲料', {'topping': '冰淇淋'}),
    ('麥茶', {'tea': '麥茶'}), ('抹茶', {'tea': '抹茶'}),
    ('清心福全紅茶', {'brand': '清心福全', 'tea': '紅茶'}),
    ('一沐日綠茶', {'brand': '一沐日', 'tea': '綠茶'}),
    ('春水堂珍珠奶茶', {'brand': '春水堂', 'milkAny': True, 'topping': '珍珠'}),
    ('植物奶飲料', {'milk': '植物奶'}),
]


def relevant(d, f):
    for k, v in f.items():
        if k == 'brand' and d['brand'] != v: return False
        if k == 'tea' and v not in d['tea']: return False
        if k == 'milk' and (v not in d['milk'] or d.get('milkConflict')): return False
        if k == 'topping' and v not in d['toppings']: return False
        if k == 'milkAny' and (not d['milk'] or (not d['tea'] and '奶茶' not in d.get('name', '')) or d.get('milkConflict')): return False
    return True


def metrics(hits, total):
    k = len(hits)
    ideal = sum(1 / math.log2(i + 2) for i in range(min(k, total)))
    return {'precision_at_10': sum(hits) / k,
            'recall_at_10': sum(hits) / total,
            'ndcg_at_10': sum(v / math.log2(i + 2) for i, v in enumerate(hits)) / ideal}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1048576), b''): h.update(chunk)
    return h.hexdigest()


def worker(args):
    import numpy as np
    import torch
    from transformers import AutoModel, AutoTokenizer
    from scripts.macbert_agent import Ranker
    import resource
    torch.set_num_threads(4)
    if args.device == 'mps' and not torch.backends.mps.is_available(): raise RuntimeError('MPS unavailable')
    sync = torch.mps.synchronize if args.device == 'mps' else lambda: None
    t = time.perf_counter()
    # Existing service pooling, max_length=64 and normalization reused verbatim.
    ranker = Ranker.__new__(Ranker)
    ranker.torch = torch; ranker.device = args.device
    ranker.tokenizer = AutoTokenizer.from_pretrained(args.source, local_files_only=True, trust_remote_code=False)
    ranker.model = AutoModel.from_pretrained(args.source, local_files_only=True, trust_remote_code=False,
        use_safetensors=(Path(args.source) / 'model.safetensors').exists(), weights_only=True, attn_implementation='eager').to(args.device).eval()
    sync(); load_s = time.perf_counter() - t
    rows = json.loads((ROOT / 'data/catalog.json').read_text())['drinks']
    texts = []
    groups = {}
    for i, d in enumerate(rows):
        milk = [] if d.get('milkConflict') else d['milk']
        text = '。'.join([d['brand'], d['name'], '茶種：' + '、'.join(d['tea']),
            '奶類：' + '、'.join(milk), '配料：' + '、'.join(d['toppings']), d['taste'][:120]])
        texts.append(re.sub(r'https?://\S+|\d+(?:\.\d+)?', '', text))
        groups.setdefault((d['brand'], d['name']), []).append(i)
    keys = list(groups)
    labels = [[any(relevant(rows[i], f) for i in groups[k]) for k in keys] for _, f in SPECS]
    if not all(any(x) for x in labels): raise ValueError('Fixture has no relevant products')
    ranker.embed(texts[:2]); sync()  # compilation/warmup excluded
    t = time.perf_counter()
    vectors = np.concatenate([ranker.embed(texts[i:i+64]) for i in range(0, len(texts), 64)])
    sync(); index_s = time.perf_counter() - t
    if not np.isfinite(vectors).all(): raise ValueError('Nonfinite embeddings')
    def query(q):
        score = vectors @ ranker.embed([q])[0]
        product = np.array([max(score[i] for i in groups[k]) for k in keys])
        return sorted(range(len(keys)), key=lambda i: (-float(product[i]), keys[i]))[:10]
    cases = []
    for (q, f), rel in zip(SPECS, labels):
        order = query(q)
        cases.append({'query': q, 'label_fields': f, 'relevant_products': sum(rel),
            **metrics([int(rel[i]) for i in order], sum(rel)),
            'top10': [{'brand': keys[i][0], 'name': keys[i][1], 'relevant': rel[i]} for i in order]})
    latency = []
    # Interleaved queries: three repeats, 72 single-query full catalogue rankings.
    for _ in range(3):
        for q, _ in SPECS:
            sync(); t = time.perf_counter(); query(q); sync()
            latency.append((time.perf_counter() - t) * 1000)
    weights = Path(args.source) / ('model.safetensors' if (Path(args.source) / 'model.safetensors').exists() else 'pytorch_model.bin')
    result = {'name': args.name, 'weights_sha256': digest(weights), 'parameters': sum(p.numel() for p in ranker.model.parameters()),
        'weight_mib': weights.stat().st_size / 1048576, 'load_s': load_s, 'index_s': index_s,
        'index_rows_per_s': len(rows) / index_s, 'query_samples': len(latency),
        'query_median_ms': float(np.median(latency)), 'query_p95_ms': float(np.percentile(latency, 95)),
        'process_peak_rss_mib': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1048576 if sys.platform == 'darwin' else 1024),
        'torch_version': torch.__version__, 'transformers_version': __import__('transformers').__version__,
        'cases': cases, 'means': {k: float(np.mean([c[k] for c in cases])) for k in ['precision_at_10', 'recall_at_10', 'ndcg_at_10']}}
    if args.device == 'mps':
        result['gpu_active_mib'] = torch.mps.current_allocated_memory() / 1048576
        result['gpu_driver_mib'] = torch.mps.driver_allocated_memory() / 1048576
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: result[k] for k in ['name', 'load_s', 'index_s', 'query_median_ms', 'query_p95_ms', 'means']}, ensure_ascii=False), flush=True)


def main(args):
    from huggingface_hub import model_info, snapshot_download
    stamp = datetime.now(ZoneInfo('Asia/Taipei')).strftime('%Y%m%dT%H%M%S')
    out = ROOT / 'docs/model-validation' / (stamp + '-' + args.report_prefix + '-encoders')
    out.mkdir(parents=True)
    report = {'started_at': datetime.now(ZoneInfo('Asia/Taipei')).isoformat(), 'device': args.device,
        'platform': platform.platform(), 'git_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'label_rule_sha256': hashlib.sha256(__import__('inspect').getsource(relevant).encode()).hexdigest(),
        'catalog_sha256': digest(ROOT / 'data/catalog.json'), 'fixture_sha256': hashlib.sha256(json.dumps(SPECS, ensure_ascii=False).encode()).hexdigest(),
        'method': '24 authored synthetic queries; binary catalog-field labels; all 5781 variants grouped into 2603 products using max variant score; no hard filtering; K=10; same production pooling; no training; no deployment',
        'limitations': ['Not human taste judgements or unseen-catalog evaluation; fine-tuned MacBERT has seen catalog text.',
            'Related paraphrases are correlated; scores cannot establish statistical superiority.',
            'Sequential models, single run on shared Mac with existing services; local timings exclude network/Worker/RRF/RelGT.',
            'RSS and MPS memory may overlap; do not add them.'], 'models': []}
    (out / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    sources = []
    # Resolve all downloads before measured fresh-process execution.
    for name, repo in [('macbert-base', 'hfl/chinese-macbert-base'), ('roberta-wwm-base', 'hfl/chinese-roberta-wwm-ext')]:
        print('RESOLVE ' + repo, flush=True)
        revision = model_info(repo).sha
        source = snapshot_download(repo, revision=revision, allow_patterns=['*.json', 'vocab.txt', 'model.safetensors', 'pytorch_model.bin'])
        sources.append((name, source, {'repo': repo, 'revision': revision}))
    if args.candidate_report:
        candidate = json.loads(Path(args.candidate_report).read_text())
        checkpoint = (ROOT / candidate['checkpoint']).resolve()
        if (not checkpoint.is_relative_to(ROOT / 'training_artifacts') or
            not candidate.get('weights_changed') or candidate.get('status') == 'failed' or
            digest(checkpoint) != candidate['checkpoint_sha256']):
            raise ValueError('Invalid offline candidate report/checkpoint')
        sources.append(('roberta-wwm-trained', str(checkpoint.parent), {
            'training_run': candidate['run_id'], 'training_source': candidate['source'],
            'training_catalog_sha256': candidate['data']['catalog_sha256']}))
    plist = plistlib.loads((Path.home() / 'Library/LaunchAgents/local.drinks-mk2.macbert.plist').read_bytes())
    argv = plist['ProgramArguments']; live = argv[argv.index('--model') + 1]
    sources.append(('macbert-service-checkpoint', live, {'source': 'installed LaunchAgent checkpoint; not remote readiness assertion'}))
    for name, source, provenance in sources:
        print('BENCHMARK ' + name, flush=True)
        output = out / (name + '.json')
        try:
            subprocess.run([sys.executable, str(Path(__file__).resolve()), '--worker', '--name', name,
                '--source', source, '--device', args.device, '--output', str(output)], check=True,
                env={**os.environ, 'HF_HUB_OFFLINE': '1', 'TOKENIZERS_PARALLELISM': 'false'})
        except subprocess.CalledProcessError:
            report.update(status='failed', failed_model=name, finished_at=datetime.now(ZoneInfo('Asia/Taipei')).isoformat())
            (out / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
            raise
        result = json.loads(output.read_text()); result['provenance'] = provenance
        report['models'].append(result)
        (out / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    report['status'] = 'complete'
    report['finished_at'] = datetime.now(ZoneInfo('Asia/Taipei')).isoformat()
    baseline = report['models'][-1]
    for model in report['models']:
        model['delta_vs_service'] = {k: model['means'][k] - baseline['means'][k] for k in baseline['means']}
        model['ndcg_wins_ties_losses_vs_service'] = [sum((a['ndcg_at_10'] > b['ndcg_at_10'] + 1e-9 if op == 'win' else abs(a['ndcg_at_10'] - b['ndcg_at_10']) <= 1e-9 if op == 'tie' else a['ndcg_at_10'] < b['ndcg_at_10'] - 1e-9) for a, b in zip(model['cases'], baseline['cases'])) for op in ['win', 'tie', 'loss']]
    (out / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print('REPORT=' + str(out), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate-report', help='Completed local RoBERTa training report; checksum verified')
    parser.add_argument('--report-prefix', default='v3', choices=['v3', 'v3.1'])
    parser.add_argument('--worker', action='store_true'); parser.add_argument('--source')
    parser.add_argument('--name'); parser.add_argument('--output'); parser.add_argument('--device', default='mps', choices=['mps', 'cpu'])
    args = parser.parse_args()
    os.environ.update(HF_HUB_DISABLE_TELEMETRY='1', TOKENIZERS_PARALLELISM='false')
    worker(args) if args.worker else main(args)
