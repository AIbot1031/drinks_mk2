"""Install isolated CPU inference for the existing RelGT checkpoint; no training."""
import hashlib
import json
import os
import plistlib
import shutil
import subprocess
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
LABEL='local.drinks-mk2.relgt'
runtime=Path.home()/'Library/Application Support/DrinksMk2RelGT'
runtime.mkdir(parents=True,exist_ok=True,mode=0o700);runtime.chmod(0o700)
for name in ['scripts','data','training_artifacts','training/vendor','logs']:(runtime/name).mkdir(parents=True,exist_ok=True,mode=0o700)
for name in ['relgt_agent.py','relgt_inference.py','inference_audit.py']:shutil.copy2(ROOT/'scripts'/name,runtime/'scripts'/name)
shutil.copy2(ROOT/'data/catalog.json',runtime/'data/catalog.json')
if (ROOT/'data/catalog-update.json').exists():shutil.copy2(ROOT/'data/catalog-update.json',runtime/'data/catalog-update.json')
shutil.copytree(ROOT/'training/vendor/relgt',runtime/'training/vendor/relgt',dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__'))
shutil.copy2(ROOT/'.relgt-key',runtime/'.relgt-key');(runtime/'.relgt-key').chmod(0o600)
report=json.loads((ROOT/'docs/training-runs/20261013T155618-relgt-long-intent.json').read_text())
source=ROOT/report['checkpoint']
if hashlib.sha256(source.read_bytes()).hexdigest()!=report['checkpoint_sha256']:raise ValueError('Checkpoint checksum mismatch')
target=runtime/report['checkpoint'];target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
shutil.copy2(source,target);target.chmod(0o600)
if not (runtime/'.venv-training').exists():subprocess.run(['cp','-cR',str(ROOT/'.venv-training'),str(runtime/'.venv-training')],check=True)
for name in ['relgt.log','relgt-error.log']:
    p=runtime/'logs'/name;p.touch(exist_ok=True);p.chmod(0o600)
plist=Path.home()/'Library/LaunchAgents'/f'{LABEL}.plist'
plist.write_bytes(plistlib.dumps({'Label':LABEL,'ProgramArguments':[str(runtime/'.venv-training/bin/python'),'-u',str(runtime/'scripts/relgt_agent.py'),'--checkpoint',str(target),'--checkpoint-hash',report['checkpoint_sha256']],
    'WorkingDirectory':str(runtime),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':15,
    'EnvironmentVariables':{'PYTHONDONTWRITEBYTECODE':'1'},
    'StandardOutPath':str(runtime/'logs/relgt.log'),'StandardErrorPath':str(runtime/'logs/relgt-error.log')}));plist.chmod(0o600)
subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}/{LABEL}'],capture_output=True)
for attempt in range(5):
    result=subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(plist)],capture_output=True)
    if result.returncode==0:break
    time.sleep(1)
else:raise RuntimeError('RelGT could not start after restart')
print('RelGT inference LaunchAgent installed; existing weights only, no training schedule.')
