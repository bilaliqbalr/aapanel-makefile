# Makefile (aaPanel plugin)

Run Makefile targets from aaPanel Files, including Docker Compose–style targets, without killing long jobs when the panel session times out.

**Author:** Phalcosoft  
**Plugin name:** `makefile`  
**Version:** 1.0

## Features

- Lists targets from a directory’s `Makefile` (with `##` help comments when present)
- Runs targets in a **tmux** session so you can leave and reattach
- Shows tmux session name and remaining command timeout in the UI
- Streaming output popup (sticks to bottom), dark-mode aware
- Docker-related targets get a longer timeout; log-only targets can run with no timeout
- Files-page hook: open the runner for the current folder

## Requirements

- aaPanel (Linux)
- `make` and `tmux` on the server
- Docker / Docker Compose only if your Makefile uses them

## Install

1. Build the import zip (optional if you already have `dist/makefile.zip`):

   ```bash
   bash pack.sh
   ```

2. In aaPanel: **App Store** → **Third-party apps / Import** → upload `dist/makefile.zip`
3. Open **Makefile** from the plugin list, or use the button in **Files** when a Makefile is present

Install path: `/www/server/panel/plugin/makefile/`

## Usage

1. Open the plugin, or from Files open a folder that contains a `Makefile`
2. Click **Load** to list targets
3. Click **Run** on a target
4. Watch the output popup; note the **tmux** session name if you need to reattach later from SSH

Stop a run from the UI when available; the plugin interrupts the pane and does not blindly kill unrelated sessions.

## Uninstall

Use aaPanel’s plugin uninstall, or:

```bash
bash /www/server/panel/plugin/makefile/uninstall.sh
```

## Develop

| File | Role |
|------|------|
| `makefile_main.py` | aaPanel entry (`makefile_main`) |
| `parse_make.py` | Target parsing |
| `runner.py` | tmux run / status / stop |
| `static/js/main.js` | Plugin UI |
| `static/js/files-hook.js` | Files page integration |
| `pack.sh` | Builds `dist/makefile.zip` |

```bash
python3 test_parse.py
bash pack.sh
```

## Notes

- Zip contents must sit at the archive root (`info.json` at top level)
- Do not put `PATH=` assignments in `install.sh` (aaPanel rewrites those lines)
- CSRF uses the panel `x-http-token` header
