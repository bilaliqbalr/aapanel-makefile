"""Start and supervise `make -C <dir> <target>` on the host."""

from __future__ import annotations

import hashlib
import json
import os
import shlex
import shutil
import signal
import subprocess
import time
import uuid
from pathlib import Path

from parse_make import (
    MAKEFILE_NAMES,
    parse_makefile,
    public_target,
    validate_make_arg,
)

PLUGIN_DIR = Path(__file__).resolve().parent
RUNS_DIR = PLUGIN_DIR / "runs"
LOG_CAP = 2_000_000
_PATH_PREFIX = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"


def list_directory(dir_path: str) -> dict:
    directory, makefile = resolve_project(dir_path)
    text = makefile.read_text(encoding="utf-8", errors="replace")
    targets = [public_target(item) for item in parse_makefile(text)]
    docker_ok, docker_msg = docker_status()
    latest = _latest_run(directory)
    active_run = None
    if latest and _session_exists(latest.get("tmux_session") or ""):
        active_run = {
            "run_id": latest["run_id"],
            "target_name": latest.get("target_name") or "",
            "tmux_session": latest.get("tmux_session") or "",
            "running": latest.get("exit_code") is None and _pane_running(latest.get("tmux_session") or ""),
            "timeout_sec": int(latest.get("timeout_sec") or 0),
            "timeout_left_sec": _timeout_left(latest),
        }
    return {
        "status": True,
        "msg": "ok",
        "dir_path": str(directory),
        "makefile": makefile.name,
        "docker_ok": docker_ok,
        "docker_msg": docker_msg,
        "targets": targets,
        "active_run": active_run,
    }


def start(dir_path: str, target_name: str, make_arg: str = "") -> dict:
    directory, makefile = resolve_project(dir_path)
    text = makefile.read_text(encoding="utf-8", errors="replace")
    found = None
    for item in parse_makefile(text):
        if item["target"] == target_name:
            found = item
            break
    if found is None:
        return _fail("That target is not in the Makefile.")
    if not found["runnable"]:
        return _fail("This target opens an interactive shell. Use the panel Terminal.")

    arg_value = ""
    if found["needs_arg"]:
        try:
            arg_value = validate_make_arg(make_arg)
        except ValueError as exc:
            return _fail(str(exc))

    if "--env-file .env" in found["recipe"] and not (directory / ".env").is_file():
        return _fail("This target reads .env and that file is not in the project directory.")

    docker_ok, docker_msg = docker_status()
    if not docker_ok:
        return _fail(docker_msg)

    make_bin = find_bin("make")
    if not make_bin:
        return _fail("make is not installed on the host.")
    tmux_bin = find_bin("tmux")
    if not tmux_bin:
        return _fail("tmux is not installed on the host.")

    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    lock_path = RUNS_DIR / ("dir-" + _dir_key(directory) + ".lock")
    with open(lock_path, "a+", encoding="utf-8") as lock_file:
        _flock(lock_file)
        active = _active_run(directory)
        if active is not None:
            return {
                "status": False,
                "msg": "A target is already running in this directory.",
                "run_id": active["run_id"],
                "tmux_session": active.get("tmux_session") or "",
                "timeout_sec": int(active.get("timeout_sec") or 0),
                "timeout_left_sec": _timeout_left(active),
            }

        run_id = uuid.uuid4().hex
        session = "mk-" + run_id[:12]
        log_path = RUNS_DIR / (run_id + ".log")
        cmd = [make_bin, "-C", str(directory), found["target"]]
        if found["needs_arg"]:
            cmd.append("m=" + arg_value)
        path_env = _PATH_PREFIX + os.pathsep + os.environ.get("PATH", "")
        try:
            pid = _start_tmux(tmux_bin, session, directory, cmd, log_path, path_env)
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            _append_log({"log_path": str(log_path)}, "Failed to start tmux: %s\n" % exc)
            return _fail("Failed to start tmux: %s" % exc)

        state = {
            "run_id": run_id,
            "pid": pid,
            "tmux_session": session,
            "dir_path": str(directory),
            "target_name": found["target"],
            "kind": found["kind"],
            "timeout_sec": found["timeout_sec"],
            "started": time.time(),
            "log_path": str(log_path),
            "exit_code": None,
            "timed_out": False,
            "stopped": False,
            "kill_at": 0,
        }
        _write_state(state)
        return {
            "status": True,
            "msg": "started",
            "run_id": run_id,
            "tmux_session": session,
            "target_name": found["target"],
            "kind": found["kind"],
            "timeout_sec": found["timeout_sec"],
            "timeout_left_sec": found["timeout_sec"] or None,
        }


def status(run_id: str, log_offset: int = 0) -> dict:
    state = _load_state(run_id)
    if state is None:
        return _fail("Unknown run.")
    _reap(state)
    state = _load_state(run_id) or state
    chunk, next_offset, size = _read_log(state["log_path"], log_offset)
    running = state.get("exit_code") is None and _run_is_live(state)
    if running:
        phase = "running"
    elif state.get("timed_out"):
        phase = "timeout"
    elif state.get("stopped"):
        phase = "stopped"
    else:
        phase = "finished"
    return {
        "status": True,
        "msg": phase,
        "run_id": state["run_id"],
        "phase": phase,
        "exit_code": state.get("exit_code"),
        "target_name": state.get("target_name", ""),
        "kind": state.get("kind", ""),
        "tmux_session": state.get("tmux_session") or "",
        "timeout_sec": int(state.get("timeout_sec") or 0),
        "timeout_left_sec": _timeout_left(state) if running else None,
        "chunk": chunk,
        "next_offset": next_offset,
        "log_size": size,
    }


def _timeout_left(state: dict):
    timeout = int(state.get("timeout_sec") or 0)
    if timeout <= 0:
        return None
    elapsed = time.time() - float(state.get("started") or 0)
    left = int(timeout - elapsed)
    return left if left > 0 else 0


def stop(run_id: str) -> dict:
    state = _load_state(run_id)
    if state is None:
        return _fail("Unknown run.")
    state["stopped"] = True
    _interrupt(state, signal.SIGTERM)
    state["kill_at"] = time.time()
    _write_state(state)
    deadline = time.time() + 2
    while time.time() < deadline and _run_is_live(state):
        time.sleep(0.2)
        fresh_pane = _tmux_pane(state.get("tmux_session") or "")
        if fresh_pane and fresh_pane["dead"]:
            break
    if _run_is_live(state):
        _interrupt(state, signal.SIGKILL)
        time.sleep(0.2)
    session = state.get("tmux_session") or ""
    tmux_bin = find_bin("tmux")
    if session and tmux_bin and _session_exists(session):
        subprocess.run([tmux_bin, "kill-session", "-t", session], capture_output=True, timeout=10, check=False)
    _reap(_load_state(run_id) or state)
    fresh = status(run_id, 0)
    fresh["msg"] = "stopped"
    fresh["tmux_closed"] = True
    return fresh


def resolve_project(dir_path: str) -> tuple[Path, Path]:
    raw = (dir_path or "").strip()
    if not raw or not raw.startswith("/"):
        raise ValueError("Enter an absolute directory path.")
    if "\x00" in raw:
        raise ValueError("Invalid directory path.")
    directory = Path(raw).resolve()
    if not directory.is_dir():
        raise ValueError("That path is not a directory.")
    makefile = _find_makefile(directory)
    if makefile is None:
        raise ValueError("No Makefile, makefile, or GNUmakefile in that directory.")
    if makefile.resolve().parent != directory:
        raise ValueError("The Makefile resolves outside the selected directory.")
    return directory, makefile


_docker_cache = {"at": 0.0, "ok": False, "msg": ""}


def docker_status() -> tuple[bool, str]:
    now = time.time()
    if now - float(_docker_cache["at"]) < 30:
        return bool(_docker_cache["ok"]), str(_docker_cache["msg"])
    ok, msg = _docker_probe()
    _docker_cache["at"] = now
    _docker_cache["ok"] = ok
    _docker_cache["msg"] = msg
    return ok, msg


def _docker_probe() -> tuple[bool, str]:
    make_bin = find_bin("make")
    docker_bin = find_bin("docker")
    if not make_bin:
        return False, "make is not installed on the host."
    if not docker_bin:
        return False, "docker is not installed on the host."
    try:
        result = subprocess.run(
            [docker_bin, "info"],
            capture_output=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, "docker info failed: %s" % exc
    if result.returncode != 0:
        err = (result.stderr or result.stdout or b"").decode("utf-8", "replace").strip()
        tail = err[-400:] if err else "docker info exited %s" % result.returncode
        return False, tail
    return True, ""


def find_bin(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    for prefix in _PATH_PREFIX.split(":"):
        candidate = os.path.join(prefix, name)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    return ""


def _find_makefile(directory: Path) -> Path | None:
    for name in MAKEFILE_NAMES:
        candidate = directory / name
        if candidate.is_file():
            return candidate
    return None


def _dir_key(directory: Path) -> str:
    return hashlib.sha256(str(directory).encode()).hexdigest()[:16]


def _state_path(run_id: str) -> Path:
    return RUNS_DIR / (run_id + ".json")


def _write_state(state: dict) -> None:
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    path = _state_path(state["run_id"])
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state), encoding="utf-8")
    os.replace(tmp, path)


def _load_state(run_id: str) -> dict | None:
    if not run_id or len(run_id) != 32 or any(c not in "0123456789abcdef" for c in run_id):
        return None
    path = _state_path(run_id)
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _active_run(directory: Path) -> dict | None:
    if not RUNS_DIR.is_dir():
        return None
    real = str(directory)
    for path in RUNS_DIR.glob("*.json"):
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if state.get("dir_path") != real:
            continue
        if state.get("exit_code") is not None:
            continue
        if _run_is_live(state):
            return state
    return None


def _latest_run(directory: Path) -> dict | None:
    if not RUNS_DIR.is_dir():
        return None
    real = str(directory)
    newest = None
    for path in RUNS_DIR.glob("*.json"):
        try:
            state = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if state.get("dir_path") != real or not state.get("run_id"):
            continue
        if newest is None or float(state.get("started") or 0) > float(newest.get("started") or 0):
            newest = state
    return newest


def make_shell_command(cmd: list[str]) -> str:
    return "exec " + " ".join(shlex.quote(part) for part in cmd)


def _start_tmux(tmux_bin: str, session: str, directory: Path, cmd: list[str], log_path: Path, path_env: str) -> int:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(
        "tmux attach -t %s\n$ %s\n" % (session, " ".join(cmd)),
        encoding="utf-8",
    )
    bash_bin = find_bin("bash")
    if not bash_bin:
        raise OSError("bash is not installed on the host.")
    created = False
    try:
        # A login shell can block in profile hooks before it reads a command.
        _tmux(tmux_bin, ["new-session", "-d", "-s", session, "-c", str(directory), bash_bin, "--noprofile", "--norc"])
        created = True
        _tmux(tmux_bin, ["set-option", "-w", "-t", session, "remain-on-exit", "on"])
        _tmux(tmux_bin, ["set-option", "-w", "-t", session, "history-limit", "50000"])
        _tmux(tmux_bin, ["pipe-pane", "-t", session, "-o", "cat >> " + shlex.quote(str(log_path))])
        time.sleep(0.15)
        line = "exec env PATH=%s %s" % (shlex.quote(path_env), " ".join(shlex.quote(part) for part in cmd))
        _tmux(tmux_bin, ["send-keys", "-t", session, "-l", "--", line])
        _tmux(tmux_bin, ["send-keys", "-t", session, "Enter"])
        pane = _tmux_pane(session)
        return int(pane["pid"]) if pane else 0
    except (OSError, subprocess.TimeoutExpired):
        if created:
            subprocess.run([tmux_bin, "kill-session", "-t", session], capture_output=True, timeout=10, check=False)
        raise


def _tmux(tmux_bin: str, args: list[str]) -> subprocess.CompletedProcess:
    result = subprocess.run([tmux_bin, *args], capture_output=True, timeout=20, check=False)
    if result.returncode != 0:
        err = (result.stderr or result.stdout or b"").decode("utf-8", "replace").strip()
        raise OSError(err or "tmux exited %s" % result.returncode)
    return result


def _session_exists(session: str) -> bool:
    tmux_bin = find_bin("tmux")
    if not tmux_bin or not session:
        return False
    result = subprocess.run([tmux_bin, "has-session", "-t", session], capture_output=True, timeout=10, check=False)
    return result.returncode == 0


def _tmux_pane(session: str):
    tmux_bin = find_bin("tmux")
    if not tmux_bin or not session:
        return None
    result = subprocess.run(
        [tmux_bin, "list-panes", "-t", session, "-F", "#{pane_pid} #{pane_dead} #{pane_dead_status}"],
        capture_output=True,
        timeout=10,
        check=False,
    )
    if result.returncode != 0:
        return None
    line = (result.stdout or b"").decode("utf-8", "replace").strip().splitlines()
    if not line:
        return None
    parts = line[0].split()
    pid = int(parts[0]) if parts and parts[0].isdigit() else 0
    dead = len(parts) > 1 and parts[1] == "1"
    status = None
    if len(parts) > 2 and parts[2].lstrip("-").isdigit():
        status = int(parts[2])
    return {"pid": pid, "dead": dead, "status": status}


def _pane_running(session: str) -> bool:
    pane = _tmux_pane(session)
    return bool(pane) and not pane["dead"]


def _run_is_live(state: dict) -> bool:
    session = state.get("tmux_session") or ""
    if session:
        return _pane_running(session)
    return _is_our_make(int(state.get("pid") or 0))


def _reap(state: dict) -> None:
    if state.get("exit_code") is not None:
        return

    timeout = int(state.get("timeout_sec") or 0)
    elapsed = time.time() - float(state.get("started") or 0)
    log_size = _log_size(state.get("log_path") or "")
    should_stop = False
    if timeout and elapsed > timeout:
        state["timed_out"] = True
        should_stop = True
    if log_size > LOG_CAP:
        should_stop = True
    if should_stop or state.get("stopped"):
        if not state.get("kill_at"):
            _interrupt(state, signal.SIGTERM)
            state["kill_at"] = time.time()
        elif time.time() - float(state["kill_at"]) > 3 and _run_is_live(state):
            _interrupt(state, signal.SIGKILL)

    session = state.get("tmux_session") or ""
    if session:
        pane = _tmux_pane(session)
        if pane:
            state["pid"] = pane["pid"]
        if pane and pane["dead"]:
            if state.get("timed_out"):
                code = 124
            elif state.get("stopped"):
                code = 143
            else:
                code = pane["status"] if pane["status"] is not None else 0
            state["exit_code"] = code
        elif pane is None and not _session_exists(session):
            if state.get("timed_out"):
                state["exit_code"] = 124
            elif state.get("stopped"):
                state["exit_code"] = 143
            else:
                state["exit_code"] = 0
    else:
        pid = int(state.get("pid") or 0)
        code = _wait_exit(pid)
        if code is None and not _pid_alive(pid):
            if state.get("timed_out"):
                code = 124
            elif state.get("stopped"):
                code = 143
            else:
                code = 0
        if code is not None:
            state["exit_code"] = code

    if state.get("exit_code") is not None:
        if state.get("timed_out"):
            _append_log(state, "\nStopped: the time limit for this target was reached.\n")
        elif log_size > LOG_CAP:
            _append_log(state, "\nStopped: the log reached its size limit.\n")
    _write_state(state)


def _interrupt(state: dict, sig: int) -> None:
    session = state.get("tmux_session") or ""
    tmux_bin = find_bin("tmux")
    if session and tmux_bin and _session_exists(session):
        if sig != signal.SIGKILL:
            subprocess.run([tmux_bin, "send-keys", "-t", session, "C-c"], capture_output=True, timeout=10, check=False)
            return
        subprocess.run([tmux_bin, "send-keys", "-t", session, "C-c"], capture_output=True, timeout=10, check=False)
        pane = _tmux_pane(session)
        if pane and pane["pid"] and not pane["dead"]:
            try:
                os.kill(pane["pid"], signal.SIGKILL)
            except ProcessLookupError:
                pass
        subprocess.run([tmux_bin, "kill-session", "-t", session], capture_output=True, timeout=10, check=False)
        return
    _signal_group(state, sig)


def _wait_exit(pid: int):
    if pid <= 0:
        return None
    try:
        waited, status = os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        return None
    if waited == 0:
        return None
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


def _is_our_make(pid: int) -> bool:
    if pid <= 0 or not _pid_alive(pid):
        return False
    try:
        raw = open("/proc/%s/cmdline" % pid, "rb").read()
    except OSError:
        return True
    first = raw.split(b"\x00", 1)[0].decode("utf-8", "replace")
    return os.path.basename(first) == "make"


def _signal_group(state: dict, sig: int) -> None:
    pid = int(state.get("pid") or 0)
    if not _is_our_make(pid):
        return
    try:
        os.killpg(pid, sig)
    except ProcessLookupError:
        return
    except PermissionError:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            return


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _log_size(path: str) -> int:
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def _append_log(state: dict, text: str) -> None:
    path = state.get("log_path")
    if not path:
        return
    try:
        with open(path, "ab") as handle:
            handle.write(text.encode())
    except OSError:
        return


def _read_log(path: str, offset: int) -> tuple[str, int, int]:
    try:
        size = os.path.getsize(path)
    except OSError:
        return "", 0, 0
    offset = max(0, min(int(offset or 0), size))
    with open(path, "rb") as handle:
        handle.seek(offset)
        blob = handle.read(65536)
    return blob.decode("utf-8", "replace"), offset + len(blob), size


def _flock(handle) -> None:
    import fcntl

    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)


def _fail(msg: str) -> dict:
    return {"status": False, "msg": msg}
