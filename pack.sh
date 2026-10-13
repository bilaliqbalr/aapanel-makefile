#!/bin/bash
# Zip layout: info.json at the archive root, which is what aaPanel's importer copies
# into /www/server/panel/plugin/<name>/.
set -eu
ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/dist"
mkdir -p "$OUT"
rm -f "$OUT/makefile.zip"
(
  cd "$ROOT"
  zip -r "$OUT/makefile.zip" \
    info.json \
    makefile_main.py \
    parse_make.py \
    runner.py \
    index.html \
    icon.png \
    install.sh \
    uninstall.sh \
    static
)
echo "$OUT/makefile.zip"
