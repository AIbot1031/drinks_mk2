"""Install the inference agent as a per-user macOS LaunchAgent; no training schedule."""
import os
import plistlib
import subprocess
import shutil
import time
from qwen_sandbox import build_profile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
LABEL='local.drinks-mk2.qwen'
# A LaunchAgent uses a dedicated application runtime, independent of Documents.
runtime=Path.home()/'Library/Application Support/DrinksMk2LLM'
runtime.mkdir(parents=True,exist_ok=True,mode=0o700)
(runtime/'scripts').mkdir(exist_ok=True)
(runtime/'data').mkdir(exist_ok=True)
(runtime/'training_artifacts').mkdir(exist_ok=True)
shutil.copy2(ROOT/'scripts/qwen_agent.py',runtime/'scripts/qwen_agent.py')
shutil.copy2(ROOT/'scripts/qwen_relay.py',runtime/'scripts/qwen_relay.py')
shutil.copy2(ROOT/'scripts/inference_audit.py',runtime/'scripts/inference_audit.py')
shutil.copy2(ROOT/'data/catalog.json',runtime/'data/catalog.json')
(runtime/'.semantic-key').unlink(missing_ok=True)
shutil.copy2(ROOT/'.llm-key',runtime/'.llm-key');(runtime/'.llm-key').chmod(0o600)
if not (runtime/'.venv-llm').exists():
    subprocess.run(['cp','-cR',str(ROOT/'.venv-llm'),str(runtime/'.venv-llm')],check=True)
model=runtime/'training_artifacts/qwen3-8b-4bit'
if not model.exists():
    model.parent.mkdir(parents=True,exist_ok=True)
    subprocess.run(['cp','-cR',str(ROOT/'training_artifacts/qwen3-8b-4bit'),str(model)],check=True)
directory=runtime/'logs';directory.mkdir(exist_ok=True,mode=0o700)
for name in ['qwen.log','qwen-error.log','qwen-relay.log','qwen-relay-error.log']:
    p=directory/name;p.touch(exist_ok=True);p.chmod(0o600)
plist=Path.home()/'Library/LaunchAgents'/f'{LABEL}.plist'
plist.parent.mkdir(parents=True,exist_ok=True)
profile=build_profile(runtime)
value={'Label':LABEL,'ProgramArguments':['/usr/bin/sandbox-exec','-f',str(profile),str(runtime/'.venv-llm/bin/python'),'-u',str(runtime/'scripts/qwen_agent.py')],
       'EnvironmentVariables':{'TMPDIR':str(runtime/'tmp'),'HF_HOME':str(runtime/'cache/huggingface'),'XDG_CACHE_HOME':str(runtime/'cache'),'PYTHONDONTWRITEBYTECODE':'1','HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','HF_HUB_DISABLE_TELEMETRY':'1','DO_NOT_TRACK':'1'},'WorkingDirectory':str(runtime),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':15,
       'StandardOutPath':str(directory/'qwen.log'),'StandardErrorPath':str(directory/'qwen-error.log')}
plist.write_bytes(plistlib.dumps(value));plist.chmod(0o600)
relay_label='local.drinks-mk2.qwen-relay'
relay=dict(value,Label=relay_label,ProgramArguments=['/usr/bin/sandbox-exec','-f',str(runtime/'qwen-relay.sb'),str(runtime/'.venv-llm/bin/python'),'-u',str(runtime/'scripts/qwen_relay.py')],StandardOutPath=str(directory/'qwen-relay.log'),StandardErrorPath=str(directory/'qwen-relay-error.log'))
relay_plist=plist.parent/(relay_label+'.plist');relay_plist.write_bytes(plistlib.dumps(relay));relay_plist.chmod(0o600)
for label,location in [(relay_label,relay_plist),(LABEL,plist)]:
    subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}/{label}'],capture_output=True)
    for attempt in range(5):
        result=subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(location)],capture_output=True)
        if result.returncode==0:break
        time.sleep(1)
    else:raise RuntimeError('Could not bootstrap '+label)
print('Qwen inference LaunchAgent installed. Starts after this macOS user logs in; no model-training schedule.')
