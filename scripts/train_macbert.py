"""Unsupervised dropout-view contrastive fine-tuning of Chinese BERT encoders on menu text.

No price target, user records, synthetic query labels, or production publishing.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import random
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from training.run_reports import add_comparison, comparison_markdown
TZ = ZoneInfo('Asia/Taipei')


def now():
    return datetime.now(TZ).isoformat(timespec='seconds')


def corpus(drinks, seed):
    # Same name, including different brands/cups/regions, stays in one split.
    groups = {}
    for d in drinks:
        key = (d['brand'], d['name'])
        groups.setdefault(key, []).append(d)
    splits = {'train': [], 'validation': []}
    seen = set()
    for (brand, name), variants in sorted(groups.items()):
        tea = sorted({v for d in variants for v in d['tea']})
        # Conflicting milk rows do not supply training milk labels.
        milk = sorted({v for d in variants if not d.get('milkConflict') for v in d['milk']})
        toppings = sorted({v for d in variants for v in d['toppings']})
        taste = next((d['taste'] for d in variants if d['taste']), '')[:120]
        text = '。'.join([brand, name, '茶種：' + '、'.join(tea),
                         '奶類：' + '、'.join(milk), '配料：' + '、'.join(toppings), taste])
        # Exclude numerical/menu promotion targets; price/nutrients never read.
        text = re.sub(r'https?://\S+|\d+(?:\.\d+)?', '', text)
        if text in seen:
            continue
        seen.add(text)
        bucket = int(hashlib.sha256((str(seed) + name.strip()).encode()).hexdigest()[:8], 16) % 100
        splits['validation' if bucket < 10 else 'train'].append(text)
    return splits, len(groups)


def evaluate_retrieval(args, report, out, source, phase):
    """Fixed query/catalog proxy in a fresh process; failures fail the run honestly."""
    from scripts.benchmark_encoders import SPECS, relevant
    import inspect
    protocol = {
        'catalog_sha256': hashlib.sha256((ROOT / 'data/catalog.json').read_bytes()).hexdigest(),
        'fixture_sha256': hashlib.sha256(json.dumps(SPECS, ensure_ascii=False).encode()).hexdigest(),
        'label_rule_sha256': hashlib.sha256(inspect.getsource(relevant).encode()).hexdigest(),
        'queries': len(SPECS), 'kind': 'catalog-field relevance proxy; not human taste satisfaction',
        'same_catalog_seen_during_training': True,
    }
    report.setdefault('retrieval_evaluation', {'protocol': protocol, 'published': False})
    if report['retrieval_evaluation']['protocol'] != protocol:
        raise RuntimeError('Retrieval evaluation protocol changed during training')
    output = out / ('retrieval-' + phase + '.json')
    command = [sys.executable, str(ROOT / 'scripts/benchmark_encoders.py'), '--worker',
        '--name', phase, '--source', str(source), '--device', args.device, '--output', str(output)]
    subprocess.run(command, cwd=ROOT, check=True)
    result = json.loads(output.read_text())
    if [x.get('query') for x in result.get('cases', [])] != [q for q, _ in SPECS]:
        raise RuntimeError('Incomplete or changed retrieval evaluation queries')
    if hashlib.sha256((ROOT / 'data/catalog.json').read_bytes()).hexdigest() != protocol['catalog_sha256']:
        raise RuntimeError('Catalog changed during retrieval evaluation')
    metrics = result.get('means', {})
    import math
    if any(not isinstance(metrics.get(k), (int, float)) or not math.isfinite(metrics[k])
           for k in ['precision_at_10', 'recall_at_10', 'ndcg_at_10']):
        raise RuntimeError('Missing or nonfinite retrieval metrics')
    if phase == 'after':
        before = report['retrieval_evaluation']['before']
        if [x['query'] for x in before['cases']] != [x['query'] for x in result['cases']]:
            raise RuntimeError('Query order differs between evaluations')
        report['retrieval_evaluation']['delta_after_minus_before'] = {
            k: metrics[k] - before['means'][k] for k in metrics}
        report['retrieval_evaluation']['regressions'] = [a['query'] for a, b in zip(before['cases'], result['cases'])
            if b['ndcg_at_10'] < a['ndcg_at_10'] - 1e-9]
    report['retrieval_evaluation'][phase] = result


def train(args, report, out):
    import torch
    import torch.nn.functional as F
    from huggingface_hub import model_info, snapshot_download
    from transformers import AutoModel, AutoTokenizer

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(4)
    device = torch.device(args.device)
    if args.device == 'mps' and not torch.backends.mps.is_available():
        raise RuntimeError('MPS unavailable; choose CPU explicitly')
    raw = (ROOT / 'data/catalog.json').read_bytes()
    splits, products = corpus(json.loads(raw)['drinks'], args.seed)
    if min(len(v) for v in splits.values()) < args.batch_size:
        raise RuntimeError('Insufficient disjoint train/validation text')
    report['data'] = {'catalog_sha256': hashlib.sha256(raw).hexdigest(),
                      'catalog_variants': len(json.loads(raw)['drinks']),
                      'products': products, 'train_texts': len(splits['train']),
                      'validation_texts': len(splits['validation']),
                      'split': 'deterministic name-group holdout; no cup/region/name crossover',
                      'user_events': 0, 'new_user_events': 0, 'cutoff': 'catalog snapshot only',
                      'removed_duplicate_texts': products - sum(map(len, splits.values()))}
    report['environment'] = {'device': str(device), 'packages': {
        n: importlib.metadata.version(n) for n in ['torch', 'transformers', 'safetensors']}}
    revision = model_info(args.model, revision=args.revision).sha
    report['source'] = {'model': args.model, 'revision': revision,
                        'license': 'Apache-2.0'}
    report['attention_implementation'] = 'eager (MPS SDPA does not support dropout)'
    if args.retrieval_eval:
        source = snapshot_download(args.model, revision=revision, allow_patterns=['*.json', 'vocab.txt', 'pytorch_model.bin'])
        evaluate_retrieval(args, report, out, source, 'before')
    print('Loading pinned official model ' + revision, flush=True)
    tokenizer = AutoTokenizer.from_pretrained(report['source']['model'], revision=revision, trust_remote_code=False)
    # Official pinned repo has pytorch_model.bin; restrict loading to tensor weights.
    model = AutoModel.from_pretrained(report['source']['model'], revision=revision,
                                      use_safetensors=False, weights_only=True, trust_remote_code=False,
                                      attn_implementation='eager').to(device)

    def embed(texts, encoder=model):
        inputs = tokenizer(texts, padding=True, truncation=True,
                           max_length=args.max_length, return_tensors='pt').to(device)
        states = encoder(**inputs).last_hidden_state
        mask = inputs['attention_mask'].clone()
        mask[inputs['input_ids'] == tokenizer.cls_token_id] = 0
        mask[inputs['input_ids'] == tokenizer.sep_token_id] = 0
        mask = mask.unsqueeze(-1)
        return F.normalize((states * mask).sum(1) / mask.sum(1).clamp(min=1), dim=-1)

    def loss(texts):
        a, b = embed(texts), embed(texts)
        scores = a @ b.T / args.temperature
        target = torch.arange(len(texts), device=device)
        return (F.cross_entropy(scores, target) + F.cross_entropy(scores.T, target)) / 2

    def evaluate():
        # Dropout is required for this objective; restore fixed RNG for comparisons.
        model.train()
        torch.manual_seed(args.seed + 10000)
        values = []
        with torch.no_grad():
            for i in range(0, len(splits['validation']), args.batch_size):
                batch = splits['validation'][i:i + args.batch_size]
                if len(batch) > 1:
                    values.append((float(loss(batch).cpu()), len(batch)))
        return sum(v * n for v, n in values) / sum(n for _, n in values)

    report['validation_before'] = evaluate()
    torch.manual_seed(args.seed)
    probe_before = next(model.parameters()).detach().cpu().clone()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=0.01)
    history = []
    report['optimizer_steps'] = 0
    for epoch in range(args.epochs):
        model.train()
        texts = list(splits['train'])
        random.shuffle(texts)
        losses = []
        for start in range(0, len(texts), args.batch_size):
            batch = texts[start:start + args.batch_size]
            if len(batch) < 2:
                continue
            optimizer.zero_grad(set_to_none=True)
            value = loss(batch)
            if not torch.isfinite(value):
                raise RuntimeError('Non-finite training loss')
            value.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            report['optimizer_steps'] += 1
            losses.append((float(value.detach().cpu()), len(batch)))
            if report['optimizer_steps'] % 5 == 0:
                print(f"step={report['optimizer_steps']} loss={losses[-1][0]:.4f}", flush=True)
        result = {'epoch': epoch + 1, 'train_loss': sum(v*n for v,n in losses)/sum(n for _,n in losses),
                  'validation_loss': evaluate()}
        history.append(result)
        report['epochs'] = history
        print(json.dumps(result), flush=True)
    report['weights_changed'] = not torch.equal(probe_before, next(model.parameters()).detach().cpu())
    if not report['weights_changed']:
        raise RuntimeError('Weights did not change')
    model.eval()
    with torch.no_grad():
        expected = embed(splits['validation'][:2]).cpu()
    model.save_pretrained(out / 'model', safe_serialization=True)
    tokenizer.save_pretrained(out / 'model')
    del optimizer
    reloaded = AutoModel.from_pretrained(out / 'model', use_safetensors=True,
                                        attn_implementation='eager').to(device).eval()
    with torch.no_grad():
        actual = embed(splits['validation'][:2], reloaded).cpu()
    report['checkpoint_reload_max_error'] = float((expected - actual).abs().max())
    if not torch.allclose(expected, actual, atol=1e-5):
        raise RuntimeError('Reloaded vectors differ')
    checkpoint = out / 'model/model.safetensors'
    report['checkpoint'] = str(checkpoint.relative_to(ROOT))
    report['checkpoint_sha256'] = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    report['status'] = 'trained_unvalidated_for_retrieval'
    if args.retrieval_eval:
        evaluate_retrieval(args, report, out, out / 'model', 'after')
        report['status'] = 'trained_proxy_evaluated_not_published'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model', choices=['hfl/chinese-macbert-base', 'hfl/chinese-roberta-wwm-ext'], default='hfl/chinese-macbert-base')
    p.add_argument('--retrieval-eval', action='store_true', help='Run fixed query ranking before/after; no deployment')
    p.add_argument('--revision', help='Pin official source revision; omission resolves current official commit')
    p.add_argument('--epochs', type=int, default=1)
    p.add_argument('--batch-size', type=int, default=32)
    p.add_argument('--max-length', type=int, default=64)
    p.add_argument('--learning-rate', type=float, default=1e-5)
    p.add_argument('--temperature', type=float, default=0.05)
    p.add_argument('--seed', type=int, default=42)
    p.add_argument('--device', choices=['cpu', 'mps'], default='mps')
    p.add_argument('--trigger', default='user requested immediate MacBERT training')
    args = p.parse_args()
    if args.epochs < 1 or args.batch_size < 2 or args.max_length < 8 or args.learning_rate <= 0 or args.temperature <= 0:
        p.error('Invalid training settings')
    model_label = 'MacBERT' if args.model == 'hfl/chinese-macbert-base' else 'RoBERTa-WWM'
    run_suffix = 'macbert' if model_label == 'MacBERT' else 'roberta-wwm'
    run_id = datetime.now(TZ).strftime('%Y%m%dT%H%M%S') + '-' + run_suffix + '-contrastive'
    out = ROOT / 'training_artifacts' / run_id
    out.mkdir(parents=True, exist_ok=False)
    started = time.perf_counter()
    report = {'run_id': run_id, 'started_at': now(), 'status': 'running',
              'trigger': args.trigger, 'parameters': vars(args),
              'git_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'working_tree_dirty': bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT)),
              'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'task': 'unsupervised dropout-view contrastive fine-tuning on drink text',
              'published': False, 'updated_users': 0,
              'changes': [model_label + ' domain contrastive fine-tuning on current catalog', 'product/name grouped holdout',
                          'no price or nutrition targets', 'no user information'],
              'limitations': ['ranking labels are catalog proxies, not human judgements or unseen-catalog tests',
                             'fresh official initialization each run, not continued training from the live checkpoint',
                             'not official MacBERT correction/WWM/SOP pretraining reproduction',
                             'no manually labelled query relevance evaluation',
                             'similar drinks may be false in-batch negatives',
                             'contrastive validation loss does not prove ranking improvements',
                             'source taste/milk metadata may contain errors',
                             'trainer does not replace current Worker inference weights automatically',
                             'schedule managed by Codex; this task is not RelGT long-term intent training']}
    try:
        train(args, report, out)
    except Exception as exc:
        report['status'] = 'failed'
        # Only exception class in public logs; raw dependency errors may contain URLs/tokens.
        report['error'] = type(exc).__name__
        print('Training failed: ' + type(exc).__name__, flush=True)
        raise
    finally:
        report['ended_at'] = now()
        report['duration_seconds'] = round(time.perf_counter() - started, 3)
        add_comparison(report)
        reports = ROOT / 'docs/training-runs'
        reports.mkdir(exist_ok=True)
        (reports / (run_id + '.json')).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        md = reports / (run_id + '.md')
        md.write_text('# ' + model_label + ' 飲料語意微調報告\n\n'
                      '本次學習飲料文字的向量表示，不訓練價格或用戶長期意圖。'
                      '驗證 loss 只衡量對比任務，不代表消費者推薦品質改善；未更新網站模型。\n\n'
                      + comparison_markdown(report) + '\n實際開始／結束、資料、參數、更新步數、驗證、權重與限制如下：\n\n```json\n' +
                      json.dumps(report, ensure_ascii=False, indent=2) + '\n```\n')
        with (ROOT / 'daily.txt').open('a') as f:
            f.write(f"\n[{report['ended_at']}｜{model_label} 飲料語意微調]\n"
                    f"- 狀態：{report['status']}；步數：{report.get('optimizer_steps', 0)}；耗時：{report['duration_seconds']} 秒。\n"
                    '- 任務：飲料文字無監督對比學習，沒有價格目標、沒有用戶資料。\n'
                    f'- 完整更新報告：{md.relative_to(ROOT)}；同名 JSON 保存參數與實測。\n'
                    '- 本訓練入口未發布模型、未更新用戶推薦；排程由 Codex 管理，發布仍需人工查詢相關性與線上舊新版比較。\n')
        print('REPORT=' + str(md), flush=True)


if __name__ == '__main__':
    main()
