#!/usr/bin/env bash
# rtk-suggest.sh
# Hook: PreToolUse - Suggest RTK alternatives (non-blocking)

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
[[ "$TOOL_NAME" != "Bash" ]] && exit 0

COMMAND=$(echo "$INPUT" | jq -r '.tool_input' | jq -r '.command // empty')
[[ -z "$COMMAND" ]] && exit 0
[[ "$COMMAND" == rtk* ]] && exit 0

# Heredocs/redirections
echo "$COMMAND" | grep -qE 'cat\s+(>|>>|<<)' && exit 0

# Custom git formats
echo "$COMMAND" | grep -qE 'git log.*--(format|pretty)=' && exit 0

# Git diff complex flags
echo "$COMMAND" | grep -qE 'git diff.*(--cached|--staged|\.\.)' && exit 0

# First command in pipe
FIRST_CMD="$COMMAND"
if echo "$COMMAND" | grep -qF '|'; then
    FIRST_CMD=$(echo "$COMMAND" | cut -d'|' -f1)
    echo "$FIRST_CMD" | grep -qE '^\s*(git (status|diff|log|show)|ls\s|cat\s|pnpm (tsc|test|prettier))' || exit 0
fi

suggest() {
    echo "{\"systemMessage\": \"RTK: \`${1}\` — token savings 60-99%.\"}"
    exit 0
}

echo "$FIRST_CMD" | grep -qE '^\s*git\s+status'              && suggest "rtk git status"
echo "$FIRST_CMD" | grep -qE '^\s*git\s+diff\b'              && suggest "rtk git diff"
echo "$FIRST_CMD" | grep -qE '^\s*git\s+log\b'               && suggest "rtk git log"
echo "$FIRST_CMD" | grep -qE '^\s*git\s+show\b'              && suggest "rtk git show"
echo "$FIRST_CMD" | grep -qE '^\s*pnpm\s+(tsc|exec tsc)\b'   && suggest "rtk tsc"
echo "$FIRST_CMD" | grep -qE '^\s*pnpm\s+(vitest|test)\b'    && suggest "rtk vitest run"
echo "$FIRST_CMD" | grep -qE '^\s*pnpm\s+prettier\b'         && suggest "rtk prettier --check"
echo "$FIRST_CMD" | grep -qE '^\s*ls\s+-'                     && suggest "rtk ls ."
echo "$FIRST_CMD" | grep -qE '^\s*cat\s+[^>|<]'              && suggest "rtk read <file>"
echo "$FIRST_CMD" | grep -qE '^\s*(pnpm\s+)?prisma\b'        && suggest "rtk prisma"

exit 0
