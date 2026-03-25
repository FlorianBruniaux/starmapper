#!/usr/bin/env bash
# git-context.sh
# Hook: UserPromptSubmit - Inject Git context into every prompt

set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}"

BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
LAST_COMMIT=$(git log -1 --oneline 2>/dev/null || echo "no commits")
UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
STAGED=$(git diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')

CONTEXT="[Git] Branch: $BRANCH | Last: $LAST_COMMIT"
[[ "$UNCOMMITTED" -gt 0 ]] && CONTEXT="$CONTEXT | Uncommitted: $UNCOMMITTED files"
[[ "$STAGED" -gt 0 ]] && CONTEXT="$CONTEXT | Staged: $STAGED files"

cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "$CONTEXT"
  }
}
EOF
exit 0
