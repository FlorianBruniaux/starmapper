#!/usr/bin/env bash
# Hook: PostToolUse(Edit|Write) — TDD Test-on-Write
#
# Fires when a test file is written. Provides RED/GREEN feedback in-turn.
# Exit 0: tests pass or informational only
# Exit 2: tests fail — feeds status back to Claude with phase guidance
#
# Kill switch: CLAUDE_TDD_SKIP=1

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

case "$TOOL_NAME" in
  Write|Edit|MultiEdit) ;;
  *) exit 0 ;;
esac

if [[ "${CLAUDE_TDD_SKIP:-0}" == "1" ]]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)
[ -z "$FILE_PATH" ] && exit 0

# Only trigger on test/spec files
case "$FILE_PATH" in
  *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx) ;;
  *) exit 0 ;;
esac

# Exclude worktrees and generated paths
case "$FILE_PATH" in
  */.worktrees/*|.worktrees/*|*/node_modules/*|*/.next/*) exit 0 ;;
esac

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  exit 0
fi

cd "$PROJECT_DIR" || exit 0

TEST_OUTPUT=$(pnpm vitest run "$FILE_PATH" 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "" >&2
  echo "🔴 TDD RED — $(basename "$FILE_PATH")" >&2
  echo "$TEST_OUTPUT" | grep -E "FAIL|×|Error:|expect\(|AssertionError|✗|failed" | head -15 >&2
  echo "" >&2
  echo "→ Tests RED. If expected: write minimal implementation. If unexpected: review test logic first." >&2
  exit 2
fi

echo "🟢 TDD GREEN — $(basename "$FILE_PATH") (all pass)" >&2
exit 0
