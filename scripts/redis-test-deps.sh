#!/usr/bin/env bash
set -euo pipefail
task_apt=/workspace/.cache/apt
if [[ ! -f "$task_apt/bootstrap.conf" ]]; then
  echo 'Run bash scripts/browser-deps.sh first, or install redis-server and redis-cli using your system package manager.' >&2
  exit 1
fi
task_debs=/workspace/.cache/redis-debs
mkdir -p "$task_debs" /workspace/.cache/redis
export APT_CONFIG="$task_apt/bootstrap.conf"
apt-get update
cd "$task_debs"
apt-get download redis-server redis-tools liblzf1 libjemalloc2
for package in ./*.deb; do dpkg-deb -x "$package" /workspace/.cache/redis; done
