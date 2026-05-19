#!/usr/bin/env bash
# Hook: SessionStart — Session Context Loader
# Injects the most recent session reflection into Claude's context.
# Skips if no reflection exists or if older than 7 days.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REFLECTIONS_DIR="$PROJECT_ROOT/.claude/tasks/reflections"

[[ -d "$REFLECTIONS_DIR" ]] || exit 0

LATEST=$(ls -t "$REFLECTIONS_DIR"/*.md 2>/dev/null | head -1)
[[ -f "$LATEST" ]] || exit 0

# Only surface if recent enough (last 7 days)
MTIME=$(stat -f %m "$LATEST" 2>/dev/null || stat -c %Y "$LATEST" 2>/dev/null || echo 0)
NOW=$(date +%s)
AGE=$(( NOW - MTIME ))
[[ $AGE -gt 604800 ]] && exit 0

FRICTION=$(grep "^Friction:" "$LATEST" 2>/dev/null | head -1 || echo "")
NEXT_STEPS=$(sed -n '/^## Suggestions/,/^## /p' "$LATEST" 2>/dev/null | grep "^- " | head -5 || echo "")
FILENAME=$(basename "$LATEST")

if [[ -z "$FRICTION" && -z "$NEXT_STEPS" ]]; then exit 0; fi

cat << JSON
{
  "systemMessage": "📋 Last session recap (${FILENAME%.md}):\n${FRICTION:+${FRICTION}\n}${NEXT_STEPS:+Suggestions:\n${NEXT_STEPS}}"
}
JSON
