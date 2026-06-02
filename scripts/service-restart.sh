#!/usr/bin/env bash
# Restart the OnePane launchd service. Pass --rebuild to recompile first
# (use after pulling code changes): scripts/service-restart.sh --rebuild
set -euo pipefail

LABEL="com.onepane.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$PLIST" ]; then
  echo "Service not installed (run: npm run service:install)." >&2
  exit 1
fi

if [ "${1:-}" = "--rebuild" ]; then
  echo "→ Rebuilding…"
  (cd "$PROJECT_DIR" && npm run build)
fi

# kickstart -k restarts the running service; fall back to unload/load.
if launchctl kickstart -k "gui/$(id -u)/$LABEL" 2>/dev/null; then
  echo "✅ Restarted $LABEL."
else
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST"
  echo "✅ Reloaded $LABEL."
fi
