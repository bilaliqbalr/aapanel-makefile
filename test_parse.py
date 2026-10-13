import os
import time
import unittest

from parse_make import parse_makefile, validate_make_arg
from runner import _timeout_left, make_shell_command, resolve_project, start

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Makefile"))


class ParseMakefileTest(unittest.TestCase):
    def setUp(self):
        with open(ROOT, encoding="utf-8") as handle:
            self.targets = {item["target"]: item for item in parse_makefile(handle.read())}

    def test_lists_rules_and_skips_variables(self):
        self.assertNotIn("COMPOSE", self.targets)
        self.assertNotIn("PHONY", self.targets)
        self.assertEqual(len(self.targets), 27)

    def test_up_is_a_detached_compose_target(self):
        up = self.targets["up"]
        self.assertEqual(up["comment"], "start full dev stack")
        self.assertEqual(up["kind"], "docker")
        self.assertTrue(up["runnable"])
        self.assertFalse(up["danger"])
        self.assertEqual(up["timeout_sec"], 1800)

    def test_follow_logs_have_no_timeout(self):
        for name in ("logs", "logs-prod"):
            item = self.targets[name]
            self.assertEqual(item["kind"], "stream")
            self.assertEqual(item["timeout_sec"], 0)
            self.assertTrue(item["runnable"])

    def test_shells_are_shown_and_not_runnable(self):
        for name in ("api-shell", "db-shell"):
            item = self.targets[name]
            self.assertEqual(item["kind"], "interactive")
            self.assertFalse(item["runnable"])

    def test_makemigration_needs_text(self):
        item = self.targets["makemigration"]
        self.assertTrue(item["needs_arg"])
        self.assertEqual(item["arg_name"], "m")
        self.assertTrue(item["runnable"])

    def test_reset_warns_about_volumes(self):
        item = self.targets["reset"]
        self.assertTrue(item["danger"])
        self.assertEqual(item["kind"], "docker")

    def test_make_arg_charset(self):
        self.assertEqual(validate_make_arg("add patient notes"), "add patient notes")
        with self.assertRaises(ValueError):
            validate_make_arg("drop; table")
        with self.assertRaises(ValueError):
            validate_make_arg("")


class ResolveProjectTest(unittest.TestCase):
    def test_repo_root(self):
        directory, makefile = resolve_project(os.path.dirname(ROOT))
        self.assertEqual(str(directory), os.path.realpath(os.path.dirname(ROOT)))
        self.assertEqual(makefile.name, "Makefile")

    def test_rejects_missing_makefile(self):
        with self.assertRaises(ValueError):
            resolve_project(os.path.dirname(__file__))

    def test_timeout_left_counts_down_the_command_limit(self):
        self.assertIsNone(_timeout_left({"timeout_sec": 0, "started": time.time()}))
        left = _timeout_left({"timeout_sec": 600, "started": time.time() - 90})
        self.assertGreaterEqual(left, 500)
        self.assertLessEqual(left, 510)
        self.assertEqual(_timeout_left({"timeout_sec": 10, "started": time.time() - 50}), 0)

    def test_shell_command_quotes_the_path(self):
        line = make_shell_command(["/usr/bin/make", "-C", "/www/my project", "up"])
        self.assertEqual(line, "exec /usr/bin/make -C '/www/my project' up")

    def test_refuses_unknown_and_interactive_targets(self):
        root = os.path.dirname(ROOT)
        unknown = start(root, "not-a-target")
        self.assertFalse(unknown["status"])
        shell = start(root, "api-shell")
        self.assertFalse(shell["status"])
        self.assertIn("Terminal", shell["msg"])


if __name__ == "__main__":
    unittest.main()
