#!/usr/bin/env bash
# dangerous-actions-blocker.sh
# Security hook for StarMapper — blocks destructive operations and secret exposure

set -euo pipefail

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool // empty')
PARAMS=$(echo "$INPUT" | jq -r '.parameters // empty')

block_action() {
  local reason="$1"
  echo "{\"block\": true, \"reason\": \"🚨 BLOCKED: $reason\"}"
  exit 0
}

is_sensitive_path() {
  local path="$1"
  case "$path" in
    *.env*|*secret*|*credential*|*password*|*.pem|*.key|*.cert|*/.ssh/*|*/.aws/*)
      return 0 ;;
    *)
      return 1 ;;
  esac
}

check_staged_secrets() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    return 0
  fi

  local patterns=(
    'DATABASE_URL'
    'GITHUB_TOKEN'
    'NEON_DATABASE_URL'
    'NEXT_PUBLIC_.*KEY'
    'ANTHROPIC_API_KEY'
    'AWS_.*KEY'
    '-----BEGIN.*PRIVATE KEY-----'
  )

  for pattern in "${patterns[@]}"; do
    if git diff --cached | grep -qE "$pattern"; then
      block_action "Secret pattern detected in staged files: $pattern"
    fi
  done
}

# BASH BLOCKING
if [[ "$TOOL" == "Bash" ]]; then
  COMMAND=$(echo "$PARAMS" | jq -r '.command // empty')

  if [[ "$COMMAND" =~ "rm -rf /" ]] || [[ "$COMMAND" =~ ":(){" ]]; then
    block_action "Destructive operation: $COMMAND"
  fi

  if [[ "$COMMAND" =~ DROP\ DATABASE|DROP\ SCHEMA ]]; then
    block_action "Database drop blocked"
  fi

  if [[ "$COMMAND" =~ git\ push.*--force.*main ]]; then
    block_action "Force push to main blocked"
  fi

  # Block prisma migrate reset without explicit consent
  if [[ "$COMMAND" =~ npx\ prisma\ migrate\ reset ]] && [[ ! "$COMMAND" =~ STARMAPPER_RESET_CONSENT ]]; then
    block_action "prisma migrate reset requires STARMAPPER_RESET_CONSENT flag"
  fi

  if [[ "$COMMAND" =~ git\ commit ]]; then
    check_staged_secrets
  fi

  if [[ "$COMMAND" =~ cat.*\\.env|head.*\\.env|tail.*\\.env ]]; then
    block_action "Attempted to read .env file via Bash"
  fi
fi

# EDIT/WRITE BLOCKING
if [[ "$TOOL" == "Edit" ]] || [[ "$TOOL" == "Write" ]]; then
  FILE_PATH=$(echo "$PARAMS" | jq -r '.file_path // .path // empty')

  if is_sensitive_path "$FILE_PATH"; then
    block_action "Editing sensitive file blocked: $FILE_PATH"
  fi

  PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
  RESOLVED_PATH=$(realpath "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")
  if [[ ! "$RESOLVED_PATH" =~ ^"$PROJECT_DIR" ]]; then
    block_action "File outside project directory: $FILE_PATH"
  fi
fi

echo "{\"block\": false}"
exit 0
