#!/usr/bin/env bash
# Remove the OnePane launchd service. Your data (SQLite DB) is left untouched.
set -euo pipefail

LABEL="com.onepane.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [ "$(uname)" != "Darwin" ]; then
  echo "macOS only. See docs/PERSISTENCE.md for other platforms." >&2
  exit 1
fi

if [ -f "$PLIST" ]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✅ Removed $LABEL. OnePane will no longer start at login."
  echo "   (Your accounts and data in prisma/onepane.db are unchanged.)"
else
  echo "Nothing to remove — $PLIST not found."
fi
