"""Install the inference agent as a per-user macOS LaunchAgent; no training schedule."""
import os
import plistlib
import subprocess
import shutil
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
LABEL='local.drinks-mk2.macbert'
# A LaunchAgent uses a dedicated application runtime, independent of Documents.
runtime=Path.home()/'Library/Application Support/DrinksMk2'
runtime.mkdir(parents=True,exist_ok=True,mode=0o700)
(runtime/'scripts').mkdir(exist_ok=True)
(runtime/'data').mkdir(exist_ok=True)
(runtime/'training_artifacts').mkdir(exist_ok=True)
shutil.copy2(ROOT/'scripts/macbert_agent.py',runtime/'scripts/macbert_agent.py')
shutil.copy2(ROOT/'scripts/inference_audit.py',runtime/'scripts/inference_audit.py')
shutil.copy2(ROOT/'data/catalog.json',runtime/'data/catalog.json')
shutil.copy2(ROOT/'.semantic-key',runtime/'.semantic-key');(runtime/'.semantic-key').chmod(0o600)
if not (runtime/'.venv-training').exists():
    subprocess.run(['cp','-cR',str(ROOT/'.venv-training'),str(runtime/'.venv-training')],check=True)
model=runtime/'training_artifacts/20261013T143230-macbert-contrastive/model'
if not model.exists():
    model.parent.mkdir(parents=True,exist_ok=True)
    subprocess.run(['cp','-cR',str(ROOT/'training_artifacts/20261013T143230-macbert-contrastive/model'),str(model)],check=True)
for cache in (ROOT/'training_artifacts').glob('macbert-index-*.npz'):
    shutil.copy2(cache,runtime/'training_artifacts'/cache.name)
directory=runtime/'logs';directory.mkdir(exist_ok=True,mode=0o700)
for name in ['macbert.log','macbert-error.log']:
    p=directory/name;p.touch(exist_ok=True);p.chmod(0o600)
plist=Path.home()/'Library/LaunchAgents'/f'{LABEL}.plist'
plist.parent.mkdir(parents=True,exist_ok=True)
value={'Label':LABEL,'ProgramArguments':[str(runtime/'.venv-training/bin/python'),'-u',str(runtime/'scripts/macbert_agent.py')],
       'WorkingDirectory':str(runtime),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':15,
       'StandardOutPath':str(directory/'macbert.log'),'StandardErrorPath':str(directory/'macbert-error.log')}
plist.write_bytes(plistlib.dumps(value));plist.chmod(0o600)
subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}/{LABEL}'],capture_output=True)
subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(plist)],check=True)
print('MacBERT inference LaunchAgent installed. Starts after this macOS user logs in; no model-training schedule.')
