#!/usr/bin/env bash
# Hook: PostToolUse(Bash) — Release Doc Update Reminder
# After "git pull origin main", suggests updating CHANGELOG.md.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

[[ "$TOOL_NAME" != "Bash" ]] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if ! echo "$COMMAND" | grep -qE "git (pull|merge).*(main|origin/main)|git checkout main"; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")

[[ "$CURRENT_BRANCH" != "main" ]] && exit 0

LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "no tag")
LAST_COMMIT=$(git log -1 --oneline 2>/dev/null || echo "unknown")
COMMITS_SINCE=$(git rev-list --count HEAD ^$(git describe --tags --abbrev=0 2>/dev/null || echo HEAD~10) 2>/dev/null || echo "?")

cat << EOF
{
  "systemMessage": "🚀 RELEASE on main (${LATEST_TAG}). Check if CHANGELOG.md needs an update. Last ${COMMITS_SINCE} commits since previous tag. Last commit: ${LAST_COMMIT}"
}
EOF

exit 0
