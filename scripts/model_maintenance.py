"""Reconcile local inference services with the daily Asia/Taipei maintenance window."""
import argparse
from datetime import datetime
import os
from pathlib import Path
import subprocess
from zoneinfo import ZoneInfo

SERVICES = ('qwen-relay', 'macbert', 'relgt', 'qwen')


def maintenance_active(now=None):
    local = (now or datetime.now(ZoneInfo('Asia/Taipei'))).astimezone(ZoneInfo('Asia/Taipei'))
    return local.hour >= 22 or local.hour < 8


def reconcile(now=None, run=subprocess.run):
    off = maintenance_active(now)
    domain = f'gui/{os.getuid()}'
    failures = []
    names = tuple(reversed(SERVICES)) if off else SERVICES
    for name in names:
        label = f'local.drinks-mk2.{name}'
        target = f'{domain}/{label}'
        plist = Path.home() / 'Library/LaunchAgents' / f'{label}.plist'
        if not plist.is_file():
            failures.append(f'{name}: service not installed')
            continue
        # Persist the intended state across login. Do not kill individual PIDs:
        # KeepAlive would restart them, and an unrelated process could be affected.
        result = run(['launchctl', 'disable' if off else 'enable', target], capture_output=True)
        if result.returncode:
            failures.append(f'{name}: cannot set enabled state')
            continue
        loaded = run(['launchctl', 'print', target], capture_output=True).returncode == 0
        if loaded == off:
            command = ['launchctl', 'bootout', target] if off else ['launchctl', 'bootstrap', domain, str(plist)]
            if run(command, capture_output=True).returncode:
                failures.append(f'{name}: cannot change loaded state')
    return off, failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Print intended state without changing services')
    args = parser.parse_args()
    if args.check:
        print('maintenance' if maintenance_active() else 'daytime')
        return
    off, failures = reconcile()
    if failures:
        for failure in failures:
            print(failure, flush=True)
        raise SystemExit(1)
    print(datetime.now(ZoneInfo('Asia/Taipei')).isoformat(timespec='seconds'), 'maintenance: inference off' if off else 'daytime: inference enabled', flush=True)


if __name__ == '__main__':
    main()
