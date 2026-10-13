#!/usr/bin/python
# coding: utf-8
"""aaPanel plugin entry. Class name matches the file name."""

from __future__ import annotations

import os
import sys

_PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
if _PLUGIN_DIR not in sys.path:
    sys.path.insert(0, _PLUGIN_DIR)

import runner


class makefile_main:
    def list_targets(self, args):
        try:
            return runner.list_directory(_field(args, "dir_path"))
        except ValueError as exc:
            return {"status": False, "msg": str(exc)}
        except Exception as exc:
            return {"status": False, "msg": "Could not read the Makefile: %s" % exc}

    def start_run(self, args):
        try:
            return runner.start(
                _field(args, "dir_path"),
                _field(args, "target_name"),
                _field(args, "make_arg"),
            )
        except ValueError as exc:
            return {"status": False, "msg": str(exc)}
        except Exception as exc:
            return {"status": False, "msg": "Could not start make: %s" % exc}

    def run_status(self, args):
        try:
            offset = _field(args, "log_offset") or "0"
            return runner.status(_field(args, "run_id"), int(offset))
        except (TypeError, ValueError):
            return {"status": False, "msg": "Invalid log offset."}
        except Exception as exc:
            return {"status": False, "msg": "Could not read the run: %s" % exc}

    def stop_run(self, args):
        try:
            return runner.stop(_field(args, "run_id"))
        except Exception as exc:
            return {"status": False, "msg": "Could not stop the run: %s" % exc}


def _field(args, key: str) -> str:
    if args is None:
        return ""
    if isinstance(args, dict):
        value = args.get(key, "")
    else:
        value = getattr(args, key, "")
    if value is None:
        return ""
    return str(value)
