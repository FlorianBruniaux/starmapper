#!/usr/bin/env bash
# Hook: PreToolUse(Edit|Write) — Config Protection
# Blocks modifications to toolchain config files.
# Forces fixing source code instead of weakening linter/compiler config.
# Exit: 0 = allow, 2 = block

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

BASENAME=$(basename "$FILE_PATH")

PROTECTED_PATTERNS=(
  "tsconfig.json"
  "tsconfig.*.json"
  "eslint.config.js"
  "eslint.config.mjs"
  "eslint.config.ts"
  "prettier.config.js"
  "prettier.config.mjs"
  "prettier.config.ts"
  "vitest.config.ts"
  "vitest.config.mts"
  "next.config.js"
  "next.config.mjs"
  "next.config.ts"
  ".editorconfig"
)

for PATTERN in "${PROTECTED_PATTERNS[@]}"; do
  # shellcheck disable=SC2053
  if [[ "$BASENAME" == $PATTERN ]]; then
    echo "🛡️ BLOCKED: Editing '$BASENAME' is not allowed." >&2
    echo "   Fix the source code to comply with the toolchain config, don't weaken it." >&2
    echo "   If you genuinely need to change this file, ask the user for explicit permission first." >&2
    exit 2
  fi
done

exit 0
