#!/usr/bin/env bash
# Show whether the OnePane launchd service is registered and responding.
set -euo pipefail

LABEL="com.onepane.server"
PORT=6969
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/onepane.log"

if [ ! -f "$PLIST" ]; then
  echo "Service not installed (run: npm run service:install)."
  exit 0
fi

echo "Service:  $LABEL"
if launchctl list | grep -q "$LABEL"; then
  line="$(launchctl list | grep "$LABEL")"
  echo "Loaded:   yes   ($line)"
else
  echo "Loaded:   no"
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT: listening"
else
  echo "Port $PORT: not listening (it may still be building — check the log)"
fi

echo "URL:      http://localhost:${PORT}"
echo "Log:      $LOG"
if [ -f "$LOG" ]; then
  echo "--- last 10 log lines ---"
  tail -n 10 "$LOG"
fi
