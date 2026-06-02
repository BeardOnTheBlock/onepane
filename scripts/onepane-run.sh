#!/usr/bin/env bash
# Launcher used by the launchd agent. Starts the OnePane production server.
# Resolves the project directory relative to this script so it works no matter
# where it is invoked from, and builds once if a production build is missing.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

# Pick up an nvm-managed node if present (launchd has a minimal environment).
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

# Safety net: if there is no production build yet, create one before starting.
if [ ! -d "$PROJECT_DIR/.next" ]; then
  echo "[onepane] No production build found — running 'npm run build'…"
  npm run build
fi

echo "[onepane] Starting server ($(date))"
exec npm run start
