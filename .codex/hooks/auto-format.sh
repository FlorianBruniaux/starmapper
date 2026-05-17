#!/usr/bin/env bash
# auto-format.sh
# Format files after Write/Edit operations

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool // empty')
PARAMS=$(echo "$INPUT" | jq -r '.parameters // empty')

if [[ "$TOOL" == "Write" ]] || [[ "$TOOL" == "Edit" ]]; then
  FILE_PATH=$(echo "$PARAMS" | jq -r '.file_path // empty')
else
  exit 0
fi

[[ -z "$FILE_PATH" ]] && exit 0
[[ ! -f "$FILE_PATH" ]] && exit 0

EXT="${FILE_PATH##*.}"

case "$EXT" in
  ts|tsx|js|jsx|json|css|md)
    if command -v npx >/dev/null 2>&1; then
      npx prettier --write "$FILE_PATH" >/dev/null 2>&1 || true
    fi
    ;;
esac

if [[ "$FILE_PATH" == *"schema.prisma" ]]; then
  if command -v npx >/dev/null 2>&1; then
    npx prisma format >/dev/null 2>&1 || true
  fi
fi

exit 0