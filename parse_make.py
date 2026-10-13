"""Parse a Makefile into runnable targets. Does not execute anything."""

from __future__ import annotations

import re

MAKEFILE_NAMES = ("Makefile", "makefile", "GNUmakefile")

# First token, then a rule separator. Rejects assignments such as `VAR :=`.
_TARGET_LINE = re.compile(r"^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]*:(?![ \t]*=)(.*)$")
_ARG_VALUE = re.compile(r"^[A-Za-z0-9 _.\-]{1,120}$")


def parse_makefile(text: str) -> list[dict]:
    """Return targets in file order.

    Each item has target, comment, recipe, kind, runnable, needs_arg,
    arg_name, danger, and timeout_sec. timeout_sec is 0 when the target
    streams until it is stopped.
    """
    targets: list[dict] = []
    current: dict | None = None
    pending_cont = False

    for raw in text.splitlines():
        line = raw.rstrip("\r")
        if pending_cont and current is not None:
            current["recipe_lines"].append(line)
            pending_cont = line.rstrip().endswith("\\")
            continue

        if line.startswith("\t"):
            if current is None:
                continue
            current["recipe_lines"].append(line)
            pending_cont = line.rstrip().endswith("\\")
            continue

        pending_cont = False
        match = _TARGET_LINE.match(line)
        if not match:
            current = None
            continue
        name = match.group(1)
        if name.startswith("."):
            current = None
            continue
        comment = ""
        rest = match.group(2)
        if "##" in rest:
            comment = rest.split("##", 1)[1].strip()
        current = {"target": name, "comment": comment, "recipe_lines": []}
        targets.append(current)

    parsed = []
    for item in targets:
        recipe = "\n".join(item["recipe_lines"])
        parsed.append(_describe(item["target"], item["comment"], recipe))
    return parsed


def _describe(target: str, comment: str, recipe: str) -> dict:
    interactive = _is_interactive(recipe)
    stream = "logs -f" in recipe
    uses_docker = any(
        token in recipe for token in ("$(COMPOSE", "${COMPOSE", "docker", "--build")
    )
    if interactive:
        kind = "interactive"
        timeout = 0
    elif stream:
        kind = "stream"
        timeout = 0
    elif uses_docker:
        kind = "docker"
        timeout = 1800
    else:
        kind = "run"
        timeout = 600

    needs_arg = "$(m)" in recipe or "${m}" in recipe
    danger = "down -v" in recipe or "DANGER" in comment.upper()
    return {
        "target": target,
        "comment": comment,
        "recipe": recipe,
        "kind": kind,
        "runnable": not interactive,
        "needs_arg": needs_arg,
        "arg_name": "m" if needs_arg else "",
        "danger": danger,
        "timeout_sec": timeout,
    }


def _is_interactive(recipe: str) -> bool:
    if re.search(r"\b(bash|sh)\b", recipe) and re.search(r"\bexec\b", recipe):
        return True
    if re.search(r"\bpsql\b", recipe) and "-c" not in recipe:
        return True
    return False


def public_target(item: dict) -> dict:
    """Fields sent to the browser. The recipe stays on the server."""
    return {
        "target": item["target"],
        "comment": item["comment"],
        "kind": item["kind"],
        "runnable": item["runnable"],
        "needs_arg": item["needs_arg"],
        "arg_name": item["arg_name"],
        "danger": item["danger"],
        "timeout_sec": item["timeout_sec"],
    }


def validate_make_arg(value: str) -> str:
    text = (value or "").strip()
    if not _ARG_VALUE.match(text):
        raise ValueError(
            "Migration text may only contain letters, numbers, spaces, and . _ -"
        )
    return text
