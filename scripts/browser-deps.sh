#!/usr/bin/env bash
# Install WebKit and verified Debian libraries in user-owned directories.
# No root, sudo, system package changes, or disabled signature checks.
set -euo pipefail
cd "$(dirname "$0")/.."
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/workspace/.cache/ms-playwright}"
task_apt=/workspace/.cache/apt
task_debs=/workspace/.cache/webkit-debs
task_libs=/workspace/.cache/webkit-libs
mkdir -p "$task_apt/etc/apt" "$task_apt/etc/apt/preferences.d" "$task_apt/var/lib/apt/lists/partial" "$task_apt/var/cache/apt/archives/partial" "$task_debs" "$task_libs"
printf '%s\n' 'deb [signed-by=/usr/share/keyrings/debian-archive-keyring.gpg] https://deb.debian.org/debian trixie main' > "$task_apt/etc/apt/sources.list"
printf '%s\n' "Dir \"$task_apt\";" 'Dir::Etc::parts "-";' 'Dir::Etc::main "-";' 'Dir::State::status "/var/lib/dpkg/status";' > "$task_apt/bootstrap.conf"
export APT_CONFIG="$task_apt/bootstrap.conf"
apt-get update
(
  cd "$task_debs"
  apt-get download libgtk-4-1 libgraphene-1.0-0 libharfbuzz-icu0 libmanette-0.2-0 libhyphen0 libwoff1 libgles2 libcairo-script-interpreter2 libhidapi-hidraw0 libglvnd0 liblzo2-2
  for package in ./*.deb; do dpkg-deb -x "$package" "$task_libs"; done
)
export LD_LIBRARY_PATH="$task_libs/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
# Validate actual dynamic loading; Playwright's ldconfig-only GLES probe cannot
# see a library extracted outside the system package database.
python3 - <<'PY'
import ctypes
for name in ['libgtk-4.so.1', 'libgraphene-1.0.so.0', 'libharfbuzz-icu.so.0', 'libmanette-0.2.so.0', 'libhyphen.so.0', 'libwoff2dec.so.1.0.2', 'libGLESv2.so.2', 'libcairo-script-interpreter.so.2', 'libhidapi-hidraw.so.0']:
    ctypes.CDLL(name)
print('WebKit libraries load successfully.')
PY
export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1
./node_modules/.bin/playwright install webkit
