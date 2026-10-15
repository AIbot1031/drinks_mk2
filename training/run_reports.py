"""Safe before/after comparisons for every training outcome."""
from __future__ import annotations

import math


def add_comparison(report):
    """Compare only actual measurements on the same evaluation procedure.

    No metrics are substituted from training loss or historical datasets.
    """
    comparison = {'status': report['status'], 'published': report.get('published', False),
                  'updated_users': report.get('updated_users', 0), 'metrics': [],
                  'data_snapshot_sha256': report.get('snapshot_sha256', report.get('data', {}).get('catalog_sha256')),
                  'weights_changed': report.get('weights_changed'),
                  'checkpoint_after': report.get('checkpoint')}
    def metric(name, before, after, direction):
        valid = all(isinstance(v, (int, float)) and math.isfinite(v) for v in [before, after])
        comparison['metrics'].append({'name': name, 'before': before, 'after': after,
                                      'delta_after_minus_before': after-before if valid else None,
                                      'better_direction': direction,
                                      'reason': None if valid else 'No comparable measurement; not estimated'})
    if 'validation_before' in report:
        epochs = report.get('epochs', [])
        metric('heldout_dropout_contrastive_loss', report['validation_before'],
               epochs[-1]['validation_loss'] if epochs else None, 'lower')
    retrieval = report.get('retrieval_evaluation', {})
    before_retrieval = retrieval.get('before', {})
    after_retrieval = retrieval.get('after', {})
    if before_retrieval:
        for key in ['precision_at_10', 'recall_at_10', 'ndcg_at_10']:
            metric('catalog_proxy_' + key, before_retrieval.get('means', {}).get(key),
                   after_retrieval.get('means', {}).get(key), 'higher')
        for key in ['query_median_ms', 'query_p95_ms', 'index_s']:
            metric('retrieval_' + key, before_retrieval.get(key), after_retrieval.get(key), 'lower')
    # Historical price experiment only; the executable is disabled by user request.
    for name in ['mae_ntd', 'rmse_ntd']:
        if 'before_training_validation' in report:
            metric('historical_validation_'+name, report['before_training_validation'].get(name),
                   report.get('best_validation', {}).get(name), 'lower')
    for split, before in report.get('before_training', {}).items():
        after = report.get('after_training', {}).get(split)
        for name, direction in [('bce', 'lower'), ('accuracy', 'higher'), ('sampled_ce','lower'), ('sampled_mrr','higher'), ('sampled_hit_at_5','higher')]:
            if name not in (before or {}) and name not in (after or {}):
                continue
            metric(split+'_'+name, before.get(name) if before else None,
                   after.get(name) if after else None, direction)
    if not comparison['metrics']:
        comparison['reason'] = report.get('reason', 'No before/after measurements were obtained')
    if report.get('optimizer_steps') == 0 or report['status'].startswith('skipped'):
        comparison['weights_changed'] = False
        comparison['checkpoint_after'] = None
    report['before_after_comparison'] = comparison
    return report


def comparison_markdown(report):
    c = report['before_after_comparison']
    rows = ['## 訓練前後比較', '', '| 項目 | 訓練前 | 訓練後 | 差值（後−前） |',
            '| --- | --- | --- | --- |']
    for metric in c['metrics']:
        value = lambda v: '無可比較數值' if v is None else f'{v:.6g}'
        rows.append('| '+metric['name']+' | '+value(metric['before'])+' | '+value(metric['after'])+' | '+value(metric['delta_after_minus_before'])+' |')
    if not c['metrics']:
        rows.append('| 評估指標 | 未取得 | 未取得 | 不計算 |')
    rows += ['', '沒有可比較指標時，不推算改善幅度；未完成訓練不代表模型已更新。',
             '對比 loss／分類 loss 不等同推薦排序品質；只有相同資料與評估方式才能比較。',
             f"發布：{'是' if c['published'] else '否'}；更新用戶：{c['updated_users']}；權重變更："
             + ('未記錄直接比對' if c['weights_changed'] is None else '是' if c['weights_changed'] else '否') + '。', '']
    return '\n'.join(rows)
