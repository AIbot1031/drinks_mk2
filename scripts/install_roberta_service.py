"""Stage, activate or restore a verified RoBERTa candidate using the existing agent slot.

Staging writes no credentials and does not restart services. State/backups remain
local and ignored; only explicit --activate changes the inference service.
"""
import argparse
import json
import os
import plistlib
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
from prepare_roberta_release import ROOT, verify_report, sha

LABEL = 'local.drinks-mk2.macbert'  # stable operational slot, actual modelVersion identifies encoder
RUNTIME = Path.home() / 'Library/Application Support/DrinksMk2'
STATE = ROOT / '.wrangler/roberta-release-state.json'
FILES = ['scripts/macbert_agent.py', 'scripts/inference_audit.py', 'scripts/prepare_roberta_release.py']
PLIST = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')


def restart():
    subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}/{LABEL}'], capture_output=True)
    for _ in range(5):
        r = subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(PLIST)], capture_output=True)
        if r.returncode == 0: return
        time.sleep(1)
    raise RuntimeError('LaunchAgent restart failed')


def stage(report_path):
    report, weights = verify_report(report_path, ROOT / 'data/catalog.json')
    if STATE.exists(): raise ValueError('Existing release state; inspect or rollback before restaging')
    if not (RUNTIME / '.venv-training/bin/python').exists() or not PLIST.exists(): raise ValueError('Existing runtime required')
    backup = ROOT / 'training_artifacts' / (datetime.now(ZoneInfo('Asia/Taipei')).strftime('%Y%m%dT%H%M%S') + '-semantic-rollback')
    backup.mkdir()
    shutil.copy2(PLIST, backup / 'agent.plist')
    for file in FILES:
        source = RUNTIME / file
        if source.exists():
            target = backup / file; target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(source, target)
    model = RUNTIME / weights.parent.relative_to(ROOT)
    model.parent.mkdir(parents=True, exist_ok=True)
    if not model.exists(): subprocess.run(['cp', '-cR', str(weights.parent), str(model)], check=True)
    if sha(model / 'model.safetensors') != report['checkpoint_sha256']: raise ValueError('Staged checksum mismatch')
    local_report = RUNTIME / 'docs/training-runs' / report_path.name
    local_report.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(report_path, local_report)
    (RUNTIME / 'docs/model-validation').mkdir(parents=True, exist_ok=True)
    for file in FILES: shutil.copy2(ROOT / file, RUNTIME / file)
    for index in (ROOT / 'training_artifacts').glob('roberta-wwm-index-*.npz'):
        shutil.copy2(index, RUNTIME / 'training_artifacts' / index.name)
    if sha(ROOT / 'data/catalog.json') != sha(RUNTIME / 'data/catalog.json'): raise ValueError('Runtime catalog differs')
    state = {'backup': str(backup), 'candidate_report': str(local_report), 'model_version': 'roberta-wwm-' + report['checkpoint_sha256'][:16], 'status': 'staged'}
    STATE.parent.mkdir(exist_ok=True); STATE.write_text(json.dumps(state, indent=2) + '\n')
    print(json.dumps(state))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=['stage', 'activate', 'rollback'])
    p.add_argument('--report', type=Path, default=ROOT / 'docs/training-runs/20261015T005748-roberta-wwm-contrastive.json')
    args = p.parse_args()
    if args.mode == 'stage': stage(args.report); return
    state = json.loads(STATE.read_text())
    if args.mode == 'activate':
        verify_report(Path(state['candidate_report']), ROOT / 'data/catalog.json')
        for file in FILES: shutil.copy2(ROOT / file, RUNTIME / file)
        value = plistlib.loads((Path(state['backup']) / 'agent.plist').read_bytes())
        value['ProgramArguments'] = [str(RUNTIME / '.venv-training/bin/python'), '-u', str(RUNTIME / 'scripts/macbert_agent.py'), '--candidate-report', state['candidate_report']]
        PLIST.write_bytes(plistlib.dumps(value)); PLIST.chmod(0o600)
        restart(); state['status'] = 'activated'
    else:
        backup = Path(state['backup'])
        for file in FILES:
            if (backup / file).exists(): shutil.copy2(backup / file, RUNTIME / file)
        shutil.copy2(backup / 'agent.plist', PLIST); PLIST.chmod(0o600)
        restart(); state['status'] = 'rolled_back'
    STATE.write_text(json.dumps(state, indent=2) + '\n')
    print('STATUS=' + state['status'])


if __name__ == '__main__': main()
