"""Train official RelGT on explicit likes/dislikes; never invent labels."""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
import random
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from training.preference_data import prepare
from training.run_reports import add_comparison, comparison_markdown
TZ = ZoneInfo('Asia/Taipei')
UPSTREAM = '19e423ca3e7cac761130aba790857f2dc3a46ef7'


def now():
    return datetime.now(TZ).isoformat(timespec='seconds')


def train(rows, splits, args, report, out):
    import numpy as np
    import pandas as pd
    import torch
    import torch_frame
    from torch_frame.data import Dataset
    sys.path.insert(0, str(ROOT/'training/vendor/relgt'))
    from model import RelGT
    torch.set_num_threads(4)
    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)
    report['environment'] = {'python': platform.python_version(), 'device': 'cpu',
                            'packages': {n: importlib.metadata.version(n) for n in
                                         ['torch', 'torch-geometric', 'pytorch-frame', 'einops']}}
    names = ['drink', 'user', 'brand', 'tea', 'milk', 'toppings']
    type_map = {name: i for i, name in enumerate(names)}
    tables = {}
    for name in names:
        if name == 'drink':
            tables[name] = pd.DataFrame({'richness': [r['drink']['richness'] for r in rows],
                                        'no_milk': [float(r['drink']['noMilk']) for r in rows]})
        else:
            tables[name] = pd.DataFrame({'value': [
                r['user_code'] if name == 'user' else r['drink'][name] if name == 'brand'
                else '|'.join(sorted(r['drink'][name])) or 'NONE' for r in rows]})
    frames, cols, stats = {}, {}, {}
    for name, table in tables.items():
        types = {c: torch_frame.numerical if name == 'drink' else torch_frame.categorical for c in table.columns}
        ds = Dataset(table.iloc[splits['train']].reset_index(drop=True), col_to_stype=types).materialize()
        frames[name] = ds.convert_to_tensor_frame(table)
        cols[name], stats[name] = ds.tensor_frame.col_names_dict, ds.col_stats
    config = dict(num_nodes=len(rows), max_neighbor_hop=1, node_type_map=type_map,
                  col_names_dict=cols, col_stats_dict=stats, local_num_layers=1,
                  channels=32, out_channels=1, global_dim=32, heads=4,
                  conv_type='full', gnn_pe_dim=0, num_centroids=8, sample_node_len=6,
                  ff_dropout=0.0, attn_dropout=0.0)
    model = RelGT(**config)
    initial_parameters = [p.detach().clone() for p in model.parameters()]
    optimizer = torch.optim.Adam(model.parameters(), lr=args.learning_rate)
    labels = torch.tensor([r['label'] for r in rows], dtype=torch.float32)
    criterion = torch.nn.BCEWithLogitsLoss()
    report['parameters'] = {'epochs': args.epochs, 'batch_size': args.batch_size,
                            'seed': args.seed, 'learning_rate': args.learning_rate,
                            'loss': 'BCEWithLogits on explicit labels only', 'optimizer': 'Adam',
                            'channels': 32, 'heads': 4, 'centroids': 8, 'conv_type': 'full',
                            'trainable_parameters': sum(p.numel() for p in model.parameters()),
                            'starting_checkpoint': None}

    def forward(ids):
        actual = len(ids)
        # Upstream BN/squeeze needs >=2. Repeat the same real sample, not a fake label.
        padded = ids if actual > 1 else ids*2
        b, k = len(padded), 6
        grouped = {'grouped_tfs': {t: frames[name][padded] for name, t in type_map.items()},
                   'grouped_indices': {t: [i*k+t for i in range(b)] for t in range(k)},
                   'flat_batch_idx': [i for i in range(b) for _ in range(k)],
                   'flat_nbr_idx': list(range(k))*b}
        edges = [(i*k, i*k+j) for i in range(b) for j in range(1, k)]
        edges += [(v, u) for u, v in edges]
        logits = model(torch.arange(k).repeat(b, 1), torch.tensor(padded),
                       torch.tensor([0, 1, 1, 1, 1, 1]).repeat(b, 1), torch.zeros(b, k),
                       grouped, torch.tensor(edges).t().contiguous(),
                       torch.arange(b).repeat_interleave(k)).reshape(-1)
        return logits[:actual]

    def chunks(ids):
        return [ids[i:i+args.batch_size] for i in range(0, len(ids), args.batch_size)]

    def evaluate(ids):
        if not ids:
            return None
        model.eval()
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(args.seed+1)
            with torch.no_grad():
                logits = torch.cat([forward(c) for c in chunks(ids)])
                target = labels[ids]
                return {'bce': float(criterion(logits, target)),
                        'accuracy': float(((logits >= 0).float() == target).float().mean()),
                        'rows': len(ids)}

    report['before_training'] = {name: evaluate(ids) for name, ids in splits.items()}
    report['optimizer_steps'] = 0
    ratio = labels[splits['train']].mean().clamp(1e-6, 1-1e-6)
    report['baseline_train_like_fraction'] = float(ratio)
    history, best = [], math.inf
    for epoch in range(1, args.epochs+1):
        model.train()
        order = splits['train'].copy()
        random.shuffle(order)
        total = 0.0
        for ids in chunks(order):
            optimizer.zero_grad()
            loss = criterion(forward(ids), labels[ids])
            if not torch.isfinite(loss):
                raise RuntimeError('Non-finite loss')
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            report['optimizer_steps'] += 1
            total += float(loss.detach())*len(ids)
        validation = evaluate(splits['validation'])
        item = {'epoch': epoch, 'train_bce': total/len(order), 'validation': validation}
        history.append(item)
        report['history'] = history
        print(json.dumps(item), flush=True)
        # With no holdout, preserve final weights; no quality claim or promotion.
        score = validation['bce'] if validation else -epoch
        if score < best:
            best = score
            torch.save({'model': model.state_dict(), 'optimizer': optimizer.state_dict(),
                        'config': config, 'epoch': epoch, 'split': splits, 'feature_tables': tables,
                        'torch_rng': torch.get_rng_state(), 'numpy_rng': np.random.get_state(),
                        'python_rng': random.getstate(), 'labels': labels,
                        'snapshot_sha256': report['snapshot_sha256'], 'upstream_commit': UPSTREAM}, out/'best.pt')
            report['saved_epoch'] = epoch
    checkpoint = torch.load(out/'best.pt', weights_only=False)
    model.load_state_dict(checkpoint['model'])
    report['weights_changed'] = any(not torch.equal(a, b.detach()) for a, b in zip(initial_parameters, model.parameters()))
    report['after_training'] = {name: evaluate(ids) for name, ids in splits.items()}
    fresh = RelGT(**checkpoint['config'])
    fresh.load_state_dict(checkpoint['model'])
    model = fresh
    assert evaluate(splits['train']) == report['after_training']['train']
    report['checkpoint_reload_verified'] = True
    report['checkpoint'] = str((out/'best.pt').relative_to(ROOT))
    report['status'] = 'trained_unvalidated' if not splits['validation'] else 'trained_snapshot_holdout'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--epochs', type=int, default=10)
    parser.add_argument('--batch-size', type=int, default=64)
    parser.add_argument('--learning-rate', type=float, default=0.001)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()
    if args.epochs < 1 or args.batch_size < 2 or args.learning_rate <= 0:
        parser.error('Invalid training parameters')
    started = time.perf_counter()
    run_id = datetime.now(TZ).strftime('%Y%m%dT%H%M%S')+'-preferences'
    out = ROOT/'training_artifacts'/run_id
    out.mkdir(parents=True, exist_ok=False)
    report = {'run_id': run_id, 'started_at': now(), 'status': 'running',
              'task': 'explicit consumer likes/dislikes snapshot classification',
              'git_commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'working_tree_dirty': bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT)),
              'training_script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'upstream_commit': UPSTREAM, 'published': False, 'updated_users': 0,
              'limitations': ['current snapshots have no interaction timestamps', 'unlabelled drinks are never negatives',
                              'small samples cannot prove recommendation quality', 'no nightly schedule or cloud publication',
                              'user identities and snapshots stay in ignored local files', 'no checkpoint resume CLI yet']}
    try:
        raw = args.snapshot.read_bytes()
        report['snapshot_sha256'] = hashlib.sha256(raw).hexdigest()
        catalog_raw = (ROOT/'data/catalog.json').read_bytes()
        report['catalog_sha256'] = hashlib.sha256(catalog_raw).hexdigest()
        snapshot = json.loads(raw)
        report['snapshot_exported_at'] = snapshot.get('exported_at')
        report['snapshot_source'] = snapshot.get('source')
        rows, splits, counts, method = prepare(snapshot, json.loads(catalog_raw)['drinks'], args.seed)
        report['data'] = counts
        report['split_method'] = method
        report['split_rows'] = {k: len(v) for k, v in splits.items()}
        if not rows:
            report['status'] = 'skipped_no_real_preferences'
            report['reason'] = 'No valid real likes/dislikes; no optimizer steps or checkpoint produced'
        else:
            if not counts['likes'] or not counts['dislikes']:
                report['limitations'].append('only one label class: cannot learn a reliable like/dislike boundary')
            train(rows, splits, args, report, out)
    except Exception as exc:
        # Exception text may contain snapshot data; do not copy it into tracked reports.
        report['status'] = 'failed'
        report['error_type'] = type(exc).__name__
        print('Training failed: '+type(exc).__name__, file=sys.stderr)
    finally:
        report['ended_at'] = now()
        report['duration_seconds'] = round(time.perf_counter()-started, 3)
        add_comparison(report)
        folder = ROOT/'docs/training-runs'
        folder.mkdir(parents=True, exist_ok=True)
        body = json.dumps(report, ensure_ascii=False, indent=2)+'\n'
        (folder/(run_id+'.json')).write_text(body)
        (folder/(run_id+'.md')).write_text(f'# 用戶偏好訓練紀錄：{run_id}\n\n'
            f"狀態：{report['status']}。開始／結束採台灣時間。\n\n"
            '只有真實收藏是正向標籤，明確不喜歡是負向標籤；未操作不當成負向。'
            '少量資料可訓練，但沒有足夠保留資料時不能宣稱推薦品質改善。'
            '資料為零時略過，不生成模型。不會自動發布雲端。\n\n'+comparison_markdown(report)+'\n```json\n'+body+'```\n')
        with (ROOT/'daily.txt').open('a') as f:
            f.write(f"\n[{report['ended_at']}｜用戶偏好訓練 {run_id}]\n"
                    f"- 狀態：{report['status']}；耗時 {report['duration_seconds']} 秒。\n"
                    f"- 彙總：{json.dumps(report.get('data', {}), ensure_ascii=False)}。\n"
                    f"- 報告：docs/training-runs/{run_id}.md。\n"
                    '- 未更新雲端模型或用戶榜單，未啟用排程；沒有將秘密或逐人偏好放入工作紀錄。\n')
        print('REPORT='+str(folder/(run_id+'.md')), flush=True)
    return 1 if report['status'] == 'failed' else 0


if __name__ == '__main__':
    raise SystemExit(main())
