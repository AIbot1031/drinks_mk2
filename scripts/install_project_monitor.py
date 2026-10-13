"""Install a small local-only monitoring LaunchAgent using the existing Python runtime."""
import os
import argparse
import plistlib
import shutil
import subprocess
import sys
import time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description='Install the read-only project monitor')
parser.add_argument('--lan',action='store_true',help='Allow devices on the default private IPv4 subnet')
args=parser.parse_args()
runtime=Path.home()/'Library/Application Support/DrinksMk2Monitor'
runtime.mkdir(parents=True,exist_ok=True,mode=0o700)
for name in ['project_monitor.py','project-monitor.html','inference_audit.py']:shutil.copy2(ROOT/'scripts'/name,runtime/name)
logs=runtime/'logs';logs.mkdir(exist_ok=True,mode=0o700)
for name in ['monitor.log','monitor-error.log']:p=logs/name;p.touch(exist_ok=True);p.chmod(0o600)
python=(ROOT/'.venv-llm/bin/python').resolve() if (ROOT/'.venv-llm/bin/python').exists() else Path(sys.executable).resolve()
label='local.drinks-mk2.monitor';plist=Path.home()/'Library/LaunchAgents'/(label+'.plist')
plist.write_bytes(plistlib.dumps({'Label':label,'ProgramArguments':[str(python),'-u',str(runtime/'project_monitor.py')],'WorkingDirectory':str(runtime),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':15,'EnvironmentVariables':{'PYTHONDONTWRITEBYTECODE':'1','DRINKS_MONITOR_LAN':'1' if args.lan else '0'},'StandardOutPath':str(logs/'monitor.log'),'StandardErrorPath':str(logs/'monitor-error.log')}));plist.chmod(0o600)
subprocess.run(['launchctl','bootout',f'gui/{os.getuid()}/{label}'],capture_output=True)
for attempt in range(5):
    result=subprocess.run(['launchctl','bootstrap',f'gui/{os.getuid()}',str(plist)],capture_output=True)
    if result.returncode==0:break
    time.sleep(1)
else:raise RuntimeError('Monitor could not start')
print('Local monitor installed: http://127.0.0.1:8792 (inference Mac only)')
if args.lan:
    from project_monitor import lan_config
    lan=lan_config()
    print(f'Wi-Fi monitor: http://{lan[0]}:8792 (same subnet only)' if lan else 'No private LAN detected; localhost only')
