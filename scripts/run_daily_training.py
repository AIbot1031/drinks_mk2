"""Run the three actual trainers sequentially with a lock and safe batch report.

No checkpoint is automatically promoted by this runner. Publication needs a
separate comparison against the currently served model on a fixed holdout.
"""
import argparse
import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT=Path(__file__).resolve().parents[1]
TZ=ZoneInfo('Asia/Taipei')


def now():return datetime.now(TZ).isoformat(timespec='seconds')


def commands():
    node=shutil.which('node')
    if not node:raise RuntimeError('Node unavailable')
    return node, {
        'RelGT':[str(ROOT/'.venv-training/bin/python'),str(ROOT/'scripts/train_long_intent.py')],
        'MacBERT':[str(ROOT/'.venv-training/bin/python'),str(ROOT/'scripts/train_macbert.py'),'--device','mps','--epochs','1'],
        'Qwen':[str(ROOT/'.venv-llm/bin/python'),str(ROOT/'scripts/train_qwen.py'),'--iters','10'],
    }


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--check',action='store_true',help='Check prerequisites only; no export or training')
    p.add_argument('--trigger',default='Codex daily scheduled training')
    args=p.parse_args()
    node,cmds=commands()
    for cmd in cmds.values():
        if not Path(cmd[0]).is_file() or not Path(cmd[1]).is_file():raise RuntimeError('Missing trainer/runtime')
    if args.check:
        print('CHECK_OK: RelGT / MacBERT / Qwen entrypoints available; no training run')
        return 0
    directory=ROOT/'internal_exports';directory.mkdir(mode=0o700,exist_ok=True)
    lock=(directory/'.daily-training.lock').open('a')
    os.chmod(lock.name,0o600)
    run_id=datetime.now(TZ).strftime('%Y%m%dT%H%M%S')+'-daily-training'
    start=time.perf_counter()
    report={'run_id':run_id,'started_at':now(),'trigger':args.trigger,'status':'running',
        'models':{},'optimizer_steps':0,'published':False,'weights_changed':False,
        'catalog_sha256':hashlib.sha256((ROOT/'data/catalog.json').read_bytes()).hexdigest(),
        'git_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        'working_tree_dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT)),
        'limitations':['runner saves candidates only; no automatic model promotion',
            'model-level comparisons are recorded in each linked training report']}
    try:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            report['status']='skipped_training_already_running'
            return 0
        # Detect manual trainer runs outside this wrapper as well.
        processes=subprocess.run(['pgrep','-f','train_long_intent.py|train_macbert.py|train_qwen.py'],capture_output=True,text=True)
        if processes.returncode==0:
            report['status']='skipped_external_training_already_running'
            return 0
        export=subprocess.run([node,str(ROOT/'scripts/export_interactions.mjs')],cwd=ROOT,capture_output=True,text=True)
        snapshot=next((line.removeprefix('SNAPSHOT=') for line in export.stdout.splitlines() if line.startswith('SNAPSHOT=')),None)
        if export.returncode or not snapshot:
            report['models']['RelGT']={'status':'failed_export','optimizer_steps':0,'weights_changed':False,'published':False,
                'reason':'Protected cloud interaction export failed; no model training or fabricated data'}
        else:
            candidate=Path(snapshot).resolve()
            if not candidate.is_relative_to(directory) or not candidate.is_file():
                report['models']['RelGT']={'status':'failed_export_snapshot','optimizer_steps':0,'weights_changed':False,'published':False,
                    'reason':'Export snapshot missing or outside protected directory'}
            else:cmds['RelGT']+=['--snapshot',str(candidate),'--trigger',args.trigger]
        cmds['MacBERT']+=['--trigger',args.trigger]
        for name,cmd in cmds.items():
            if name in report['models']:continue
            before=set((ROOT/'docs/training-runs').glob('*.json'))
            print('TRAINING='+name,flush=True)
            log=directory/(run_id+'-'+name.lower()+'.log')
            with log.open('w') as f:
                log.chmod(0o600)
                try:result=subprocess.run(cmd,cwd=ROOT,stdout=f,stderr=subprocess.STDOUT)
                except OSError as exc:
                    report['models'][name]={'status':'failed_start','optimizer_steps':0,'published':False,'weights_changed':False,'error_type':type(exc).__name__}
                    continue
            new=set((ROOT/'docs/training-runs').glob('*.json'))-before
            suffix={'RelGT':'relgt-long-intent','MacBERT':'macbert-contrastive','Qwen':'qwen-intent-qlora'}[name]
            matches=[path for path in new if path.stem.endswith(suffix)]
            if len(matches)!=1:
                report['models'][name]={'status':'failed_missing_report','optimizer_steps':None,'published':False,
                    'reason':'Trainer did not leave one uniquely identifiable report; completed steps unknown'}
            else:
                path=matches[0];r=json.loads(path.read_text())
                report['models'][name]={k:r.get(k) for k in ['status','optimizer_steps','weights_changed','checkpoint','checkpoint_sha256','before_after_comparison']}
                report['models'][name].update(report=str(path.relative_to(ROOT)),exit_code=result.returncode,published=False)
            print(name+'_STATUS='+report['models'][name]['status'],flush=True)
        report['optimizer_steps']=sum(r.get('optimizer_steps') or 0 for r in report['models'].values())
        report['weights_changed']=any(r.get('weights_changed') for r in report['models'].values())
        report['status']='completed_with_failures' if any(r['status'].startswith('failed') for r in report['models'].values()) else 'completed_candidates_not_published'
    except Exception as exc:
        report['status']='failed_batch';report['error_type']=type(exc).__name__
    finally:
        report['ended_at']=now();report['duration_seconds']=round(time.perf_counter()-start,3)
        folder=ROOT/'docs/training-runs';folder.mkdir(exist_ok=True)
        body=json.dumps(report,ensure_ascii=False,indent=2)+'\n'
        (folder/(run_id+'.json')).write_text(body)
        (folder/(run_id+'.md')).write_text('# 三模型每日訓練執行報告\n\n各模型相同驗證方法之前後指標與版本比較見下方連結報告；候選只保存本機，線上權重未替換。\n\n```json\n'+body+'```\n')
        with (ROOT/'daily.txt').open('a') as f:f.write(f"\n[{report['ended_at']}｜三模型每日訓練]\n- 狀態：{report['status']}；完成步數彙總：{report['optimizer_steps']}；未發布權重。\n- 批次與各模型前後比較報告：docs/training-runs/{run_id}.md／JSON。\n- 沒有將原始用戶互動或金鑰寫入報告／Git；保護的執行日誌只存 internal_exports。\n")
        lock.close()
        print('BATCH_REPORT='+str(folder/(run_id+'.md')),flush=True)
    return 1 if 'fail' in report['status'] else 0


if __name__=='__main__':raise SystemExit(main())
