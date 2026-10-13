"""Record RelGT long-term intent preflight, never substitute snapshot/price training."""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from training.run_reports import add_comparison, comparison_markdown
TZ = ZoneInfo('Asia/Taipei')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit', type=Path, required=True, help='aggregate Cloudflare readiness audit')
    args = parser.parse_args()
    started = datetime.now(TZ)
    run_id = started.strftime('%Y%m%dT%H%M%S') + '-relgt-long-intent-preflight'
    report = {'run_id': run_id, 'started_at': started.isoformat(timespec='seconds'),
              'status': 'running', 'trigger': 'user requested RelGT long-term intent training now',
              'task': 'RelGT long-term intent chronological user interactions',
              'git_commit': subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip(),
              'working_tree_dirty': bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT)),
              'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'environment': {'python': platform.python_version(), 'device': 'not used; preflight only'},
              'parameters': None, 'optimizer_steps': 0, 'weights_changed': False,
              'checkpoint': None, 'published': False, 'updated_users': 0,
              'changes': ['record actual long-term data availability', 'append-only interaction collection',
                          'universal before/after comparison requirement'],
              'limitations': ['no fabricated historical timestamps or preference labels',
                             'guest recommendation traces cannot be assigned to a real user',
                             'chronological RelGT training adapter and ranking evaluation are not implemented',
                             'no nightly scheduler or production neural model publication']}
    try:
        raw = args.audit.read_bytes()
        audit = json.loads(raw)
        if audit.get('kind') != 'long-intent-readiness-aggregate':
            raise ValueError('Wrong audit kind')
        data = audit['data']
        keys = ['real_accounts', 'likes', 'dislikes', 'real_events', 'event_users', 'multi_day_users']
        if any(type(data.get(k)) is not int or data[k] < 0 for k in keys):
            raise ValueError('Invalid aggregate counts')
        report['audit_sha256'] = hashlib.sha256(raw).hexdigest()
        report['data'] = {k:data[k] for k in keys}
        report['data']['audit_checked_at'] = audit['checked_at']
        report['data']['source'] = 'Cloudflare D1 aggregate; testauth prefix excluded'
        report['data']['cutoff'] = audit['checked_at']
        report['split_rows'] = {'train':0, 'validation':0, 'test':0}
        if not data['real_events']:
            report['status'] = 'skipped_no_real_interaction_history'
            report['reason'] = 'No real timestamped user interaction history; no weights were initialized or updated'
        else:
            report['status'] = 'skipped_chronological_adapter_not_implemented'
            report['reason'] = 'History exists but chronological long-intent graph/sampling/training adapter still requires implementation'
    except Exception as exc:
        report['status'] = 'failed_preflight'
        report['error_type'] = type(exc).__name__
        report['reason'] = 'Unable to verify valid aggregate readiness data'
    finally:
        ended = datetime.now(TZ)
        report['ended_at'] = ended.isoformat(timespec='seconds')
        report['duration_seconds'] = (ended-started).total_seconds()
        add_comparison(report)
        folder = ROOT / 'docs/training-runs'
        folder.mkdir(exist_ok=True)
        body = json.dumps(report, ensure_ascii=False, indent=2) + '\n'
        (folder/(run_id+'.json')).write_text(body)
        (folder/(run_id+'.md')).write_text('# RelGT 長期意圖：本次啟動檢查與略過報告\n\n'
            '這次確實檢查了訓練條件，但沒有進行模型訓練。雲端彙總見下方；'
            '不把匿名推薦請求、測試帳號、目前偏好快照或價格實驗冒充長期意圖資料。\n\n'
            '新增事件紀錄只保存之後實際發生的操作時間，不回填猜測的歷史。'
            '正式時間圖／訓練 adapter、時間切分、排序驗證與發布仍待完成。\n\n'
            + comparison_markdown(report) + '\n## 本次實際紀錄\n\n```json\n' + body + '```\n')
        with (ROOT/'daily.txt').open('a') as f:
            f.write(f"\n[{report['ended_at']}｜RelGT 長期意圖啟動檢查]\n"
                    f"- 狀態：{report['status']}；沒有 optimizer 更新，沒有模型權重或發布。\n"
                    f"- 安全彙總：{json.dumps(report.get('data', {}), ensure_ascii=False)}。\n"
                    f'- 前後比較報告：docs/training-runs/{run_id}.md；JSON 保存資料檢查來源與版本。\n'
                    '- 長期意圖正式訓練 adapter 與排序驗證尚未實作；不改跑價格或偏好快照冒充完成。\n')
        print('REPORT=' + str(folder/(run_id+'.md')))
    return 1 if report['status'] == 'failed_preflight' else 0


if __name__ == '__main__':
    raise SystemExit(main())
