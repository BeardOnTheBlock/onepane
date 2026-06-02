#!/usr/bin/env bash
# Install OnePane as a persistent macOS launchd service.
#   - builds a production bundle
#   - writes ~/Library/LaunchAgents/com.onepane.server.plist
#   - loads it so OnePane runs at http://localhost:6969 and restarts at login
#
# Re-run any time to rebuild + reload. Uninstall with scripts/service-uninstall.sh.
set -euo pipefail

LABEL="com.onepane.server"
PORT=6969

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if [ "$(uname)" != "Darwin" ]; then
  echo "This installer uses macOS launchd. On Linux/Windows see docs/PERSISTENCE.md." >&2
  exit 1
fi

if [ ! -f "$PROJECT_DIR/.env" ]; then
  echo "Missing .env — copy .env.example to .env and set ONEPANE_ENCRYPTION_KEY first." >&2
  exit 1
fi

# Warn (don't fail) if something else already holds the port — e.g. `npm run dev`.
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "⚠️  Port $PORT is already in use (a 'npm run dev' you're running?)."
  echo "    Stop it first so the service can bind $PORT, then re-run this script."
fi

NODE_BIN="$(dirname "$(command -v node)")"
WRAPPER="$PROJECT_DIR/scripts/onepane-run.sh"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
LOG="$LOG_DIR/onepane.log"

echo "→ Installing dependencies…"
npm install
echo "→ Preparing database…"
npm run setup
echo "→ Building production bundle…"
npm run build

mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
chmod +x "$WRAPPER"

echo "→ Writing $PLIST"
sed \
  -e "s#__LABEL__#${LABEL}#g" \
  -e "s#__WRAPPER__#${WRAPPER}#g" \
  -e "s#__PROJECT_DIR__#${PROJECT_DIR}#g" \
  -e "s#__NODE_BIN__#${NODE_BIN}#g" \
  -e "s#__LOG__#${LOG}#g" \
  "$PROJECT_DIR/scripts/onepane.plist.template" > "$PLIST"

# Reload cleanly (unload first if already present).
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo ""
echo "✅ OnePane is installed as a login service."
echo "   URL:   http://localhost:${PORT}"
echo "   Logs:  $LOG   (npm run service:logs)"
echo "   Status: npm run service:status   ·   Remove: npm run service:uninstall"
