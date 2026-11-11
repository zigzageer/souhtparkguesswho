#!/usr/bin/env bash
# The upstream MiniBrowser shell wrapper replaces LD_LIBRARY_PATH. Launch the
# same, unmodified browser binary with our verified user-local libraries added.
set -euo pipefail
task_browser="${PLAYWRIGHT_BROWSERS_PATH:-/workspace/.cache/ms-playwright}/webkit-2248/minibrowser-wpe"
export WEBKIT_EXEC_PATH="$task_browser/bin"
export WEBKIT_INJECTED_BUNDLE_PATH="$task_browser/lib"
export WEBKIT_INSPECTOR_RESOURCES_PATH="$task_browser/share"
export LD_LIBRARY_PATH="$task_browser/lib:$task_browser/sys/lib:/workspace/.cache/webkit-libs/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export WEBKIT_FORCE_COMPLEX_TEXT=1
exec "$task_browser/bin/MiniBrowser" "$@"
