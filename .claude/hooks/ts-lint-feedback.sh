#!/bin/bash
# Hook: PostToolUse — Fast ESLint feedback on edited TypeScript files
# Non-blocking: outputs warnings but never fails the tool call
# Added: 2026-03-30 | Reason: Catch lint errors immediately after edit, not at pre-commit

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only TypeScript files
if [[ -z "$FILE_PATH" || ! "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then
  exit 0
fi

# Skip generated, test, and declaration files
if [[ "$FILE_PATH" =~ (generated|\.d\.ts|node_modules|\.test\.|\.spec\.) ]]; then
  exit 0
fi

# Verify file still exists (may have been renamed)
if [[ ! -f "$FILE_PATH" ]]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Run ESLint with cache for speed (~1-2s vs ~10s without)
RESULT=$(pnpm eslint --quiet --cache --cache-location .eslintcache --no-warn-ignored --max-warnings 0 "$FILE_PATH" 2>&1 || true)

if [[ -n "$RESULT" ]]; then
  echo ""
  echo "⚡ ESLint feedback on $(basename "$FILE_PATH"):"
  echo "$RESULT" | head -30
  echo ""
fi

# Always exit 0 — feedback only, not blocking
exit 0
