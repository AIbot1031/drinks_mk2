"""Install the lightweight per-user inference maintenance scheduler."""
from pathlib import Path
import os
import plistlib
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
runtime = Path.home() / 'Library/Application Support/DrinksMk2Maintenance'
runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
script = runtime / 'model_maintenance.py'
shutil.copy2(root / 'scripts/model_maintenance.py', script)
label = 'local.drinks-mk2.model-maintenance'
plist = Path.home() / 'Library/LaunchAgents' / f'{label}.plist'
plist.parent.mkdir(parents=True, exist_ok=True)
for name in ('maintenance.log', 'maintenance-error.log'):
    path = runtime / name
    path.touch(exist_ok=True)
    path.chmod(0o600)
plist.write_bytes(plistlib.dumps({
    'Label': label,
    'ProgramArguments': [sys.executable, '-u', str(script)],
    'RunAtLoad': True,
    # Reconcile on wake/login too; all time decisions use Asia/Taipei rather
    # than the Mac's selected timezone. This process exits after each check.
    'StartInterval': 60,
    'ProcessType': 'Background',
    'EnvironmentVariables': {'PYTHONDONTWRITEBYTECODE': '1'},
    'StandardOutPath': str(runtime / 'maintenance.log'),
    'StandardErrorPath': str(runtime / 'maintenance-error.log'),
}))
plist.chmod(0o600)
domain = f'gui/{os.getuid()}'
subprocess.run(['launchctl', 'bootout', f'{domain}/{label}'], capture_output=True)
subprocess.run(['launchctl', 'enable', f'{domain}/{label}'], check=True)
subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], check=True)
print('Installed: 22:00–08:00 Asia/Taipei inference maintenance; checks every 60 seconds.')
