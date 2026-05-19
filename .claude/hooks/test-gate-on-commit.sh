#!/usr/bin/env bash
# Hook: PreToolUse(Bash) — Test Gate on Commit
# Reminds Claude to run tests before committing.
# Non-blocking: warns but does not prevent the commit.

set -euo pipefail

TOOL_INPUT=$(cat)
TOOL_NAME=$(echo "$TOOL_INPUT" | jq -r '.tool_name // empty')
[[ "$TOOL_NAME" != "Bash" ]] && exit 0

COMMAND=$(echo "$TOOL_INPUT" | jq -r '.tool_input.command // empty')

echo "$COMMAND" | grep -qE '\bgit\s+commit\b' || exit 0

# Skip test/docs/chore commits — no tests needed
echo "$COMMAND" | grep -qiE '\-m\s+["\x27]*(test|docs|chore|style|ci)' && exit 0

cat << 'ENDJSON'
{"decision":"warn","message":"⚠️  BEFORE COMMITTING: Have you run tests for modified files?\n\nUse: pnpm test\nOr targeted: pnpm vitest run src/lib/[modified-file].test.ts\n\nrtk tsc must also return 0 errors before committing."}
ENDJSON
