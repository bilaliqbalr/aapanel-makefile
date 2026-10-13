#!/bin/bash
# aaPanel calls this as: bash install.sh install|uninstall
set -eu

ACTION="${1:-install}"
PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"

if command -v python3 >/dev/null 2>&1; then
    PY=python3
else
    PY=/www/server/panel/pyenv/bin/python3
fi
"$PY" - "$ACTION" << 'PY'
import pathlib, re, sys

action = sys.argv[1]
begin = "<!-- makefile-plugin -->"
end = "<!-- /makefile-plugin -->"
block = (
    begin
    + '\n<script src="/makefile/static/js/files-hook.js?v=6"></script>\n'
    + end
    + "\n"
)
pattern = re.compile(re.escape(begin) + r".*?" + re.escape(end) + r"\n?", re.S)
files = [
    "/www/server/panel/BTPanel/templates/default/index_new.html",
    "/www/server/panel/BTPanel/templates/default/layout.html",
]
for name in files:
    path = pathlib.Path(name)
    if not path.is_file():
        print("skip missing", name)
        continue
    text = path.read_text(encoding="utf-8", errors="replace")
    cleaned = pattern.sub("", text)
    if action == "uninstall":
        path.write_text(cleaned, encoding="utf-8")
        print("removed hook from", name)
        continue
    if "</body>" in cleaned:
        cleaned = cleaned.replace("</body>", block + "</body>", 1)
    else:
        cleaned = cleaned.rstrip() + "\n" + block
    path.write_text(cleaned, encoding="utf-8")
    print("added hook to", name)
PY

if [ "$ACTION" = "install" ]; then
    mkdir -p "$PLUGIN_DIR/runs"
    chmod 755 "$PLUGIN_DIR" "$PLUGIN_DIR/static" "$PLUGIN_DIR/static/js" "$PLUGIN_DIR/runs" || true
    chmod 644 "$PLUGIN_DIR/static/js/"*.js "$PLUGIN_DIR/index.html" "$PLUGIN_DIR/info.json" || true
    echo "Makefile plugin installed. Reload the panel page. If a panel update removes the Files button, run: bash $PLUGIN_DIR/install.sh install"
else
    echo "Makefile plugin hook removed."
fi
