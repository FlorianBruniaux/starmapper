#!/usr/bin/env bash
# notification.sh
# macOS notifications for Claude Code events

set -euo pipefail

INPUT=$(cat)
TYPE=$(echo "$INPUT" | jq -r '.type // "info"')
MESSAGE=$(echo "$INPUT" | jq -r '.message // "StarMapper — Claude Code"')

case "$TYPE" in
  success|completed) SOUND="Hero" ;;
  error|failed)      SOUND="Basso" ;;
  *)                 SOUND="Submarine" ;;
esac

if command -v osascript >/dev/null 2>&1; then
  osascript -e "display notification \"$MESSAGE\" with title \"StarMapper\" sound name \"$SOUND\"" 2>/dev/null || true
fi

exit 0
