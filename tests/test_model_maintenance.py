import importlib.util
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('maintenance', Path(__file__).resolve().parents[1] / 'scripts/model_maintenance.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MaintenanceTests(unittest.TestCase):
    def test_taipei_boundaries_and_utc(self):
        for value, expected in [('2026-10-25T07:59:59+08:00', True), ('2026-10-25T08:00:00+08:00', False), ('2026-10-25T21:59:59+08:00', False), ('2026-10-25T22:00:00+08:00', True), ('2026-10-25T00:00:00+08:00', True), ('2026-10-25T14:00:00+00:00', True)]:
            with self.subTest(value=value):
                self.assertEqual(m.maintenance_active(datetime.fromisoformat(value)), expected)

    def reconcile(self, hour, loaded, fail_action=False):
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            if command[1] == 'print':
                return SimpleNamespace(returncode=0 if loaded else 1)
            return SimpleNamespace(returncode=1 if fail_action and command[1] == 'bootstrap' else 0)
        with patch.object(Path, 'is_file', return_value=True):
            off, failures = m.reconcile(datetime.fromisoformat(f'2026-10-25T{hour}:00:00+08:00'), run)
        return calls, off, failures

    def test_night_unloads_and_disables_all_services(self):
        calls, off, failures = self.reconcile('22', True)
        self.assertTrue(off)
        self.assertFalse(failures)
        self.assertEqual(sum(c[1] == 'bootout' for c in calls), 4)
        self.assertEqual(sum(c[1] == 'disable' for c in calls), 4)
        self.assertFalse(any(c[1] == 'bootstrap' for c in calls))

    def test_morning_enables_and_starts_relay_first(self):
        calls, off, failures = self.reconcile('08', False)
        self.assertFalse(off)
        self.assertFalse(failures)
        starts = [c for c in calls if c[1] == 'bootstrap']
        self.assertEqual(len(starts), 4)
        self.assertTrue(starts[0][-1].endswith('qwen-relay.plist'))

    def test_running_daytime_services_are_not_restarted(self):
        calls, _, failures = self.reconcile('12', True)
        self.assertFalse(failures)
        self.assertFalse(any(c[1] in ('bootout', 'bootstrap') for c in calls))

    def test_start_failures_are_reported(self):
        _, _, failures = self.reconcile('08', False, True)
        self.assertEqual(len(failures), 4)


if __name__ == '__main__':
    unittest.main()
