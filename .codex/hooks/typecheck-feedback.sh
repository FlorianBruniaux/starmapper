#!/usr/bin/env bash
# typecheck-feedback.sh
# Run TypeScript check after editing .ts/.tsx files

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool // empty')
PARAMS=$(echo "$INPUT" | jq -r '.parameters // empty')

if [[ "$TOOL" == "Write" ]] || [[ "$TOOL" == "Edit" ]]; then
  FILE_PATH=$(echo "$PARAMS" | jq -r '.file_path // empty')
else
  exit 0
fi

[[ -z "$FILE_PATH" ]] || [[ ! -f "$FILE_PATH" ]] && exit 0

EXT="${FILE_PATH##*.}"
[[ "$EXT" != "ts" ]] && [[ "$EXT" != "tsx" ]] && exit 0

# Use rtk tsc if available (compressed output), fallback to pnpm typecheck
if command -v rtk >/dev/null 2>&1; then
  TYPECHECK_OUTPUT=$(timeout 30s rtk tsc 2>&1 || true)
elif command -v pnpm >/dev/null 2>&1; then
  TYPECHECK_OUTPUT=$(timeout 30s pnpm typecheck 2>&1 || true)
else
  exit 0
fi

if echo "$TYPECHECK_OUTPUT" | grep -q "error TS"; then
  ERROR_SUMMARY=$(echo "$TYPECHECK_OUTPUT" | grep "error TS" | head -10)
  echo "{\"systemMessage\": \"⚠️ TypeScript errors detected:\\n$ERROR_SUMMARY\\n\\nRun 'rtk tsc' for full output.\"}"
fi

exit 0
