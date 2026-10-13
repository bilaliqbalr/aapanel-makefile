#!/bin/bash
# Panel uninstall also runs install.sh uninstall. This entry does the same hook removal.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$DIR/install.sh" uninstall
