#!/usr/bin/env bash
# security-gate.sh
# Detects vulnerable code patterns before writing to source files.
# Complements dangerous-actions-blocker.sh (system-level ops).
# This hook focuses on APPLICATION security anti-patterns in code.
# Exit 0 = allow, Exit 2 = block (stderr message shown to Claude)

set -e

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')

if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
    exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.file_path // empty')

EXTENSION="${FILE_PATH##*.}"
SOURCE_EXTENSIONS="js ts jsx tsx py go"
is_source=false
for ext in $SOURCE_EXTENSIONS; do
    [[ "$EXTENSION" == "$ext" ]] && is_source=true && break
done
[[ "$is_source" == "false" ]] && exit 0

if [[ "$TOOL_NAME" == "Write" ]]; then
    CONTENT=$(echo "$INPUT" | jq -r '.content // empty')
else
    CONTENT=$(echo "$INPUT" | jq -r '.new_string // empty')
fi

# Hardcoded secrets
if echo "$CONTENT" | grep -qiE '(api[_-]?key|password|secret|token|bearer)\s*=\s*["'"'"'][^"'"'"'$\{][^"'"'"']{8,}["'"'"']'; then
    echo "SECURITY-GATE: Potential hardcoded secret in $FILE_PATH — use process.env" >&2; exit 2
fi
if echo "$CONTENT" | grep -qE '(sk-[a-zA-Z0-9]{20,}|sk-ant-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|AKIA[A-Z0-9]{16})'; then
    echo "SECURITY-GATE: Provider API key pattern in $FILE_PATH — move to .env.local" >&2; exit 2
fi

# SQL injection
if echo "$CONTENT" | grep -qiE '(SELECT|INSERT|UPDATE|DELETE|DROP).{0,60}(\$\{|'"'"'\s*\+\s*|"\s*\+\s*)'; then
    echo "SECURITY-GATE: Potential SQL injection in $FILE_PATH — use Prisma parameterized queries" >&2; exit 2
fi

# XSS
if echo "$CONTENT" | grep -qE '\.innerHTML\s*=\s*[^"'"'"'`]|document\.write\s*\('; then
    echo "SECURITY-GATE: Potential XSS in $FILE_PATH — use textContent or DOMPurify" >&2; exit 2
fi

# eval()
if echo "$CONTENT" | grep -qE 'eval\s*\(\s*[^"'"'"'`]|new\s+Function\s*\(\s*[^"'"'"'`]'; then
    echo "SECURITY-GATE: eval() with dynamic content in $FILE_PATH" >&2; exit 2
fi

# Path traversal
if echo "$CONTENT" | grep -qE '(readFile|open|path\.join)\s*\([^)]*req\.(params|query|body)'; then
    echo "SECURITY-GATE: Potential path traversal in $FILE_PATH — validate user input before file ops" >&2; exit 2
fi

# Sensitive keys in localStorage (regression guard for C2 fix)
# GitHub PAT and any key containing "token" must use sessionStorage with TTL, not localStorage.
if echo "$CONTENT" | grep -qE 'localStorage\.(setItem|getItem)\s*\(\s*["'"'"'][^"'"'"']*(token|secret|key)[^"'"'"']*["'"'"']'; then
    echo "SECURITY-GATE: Sensitive key in localStorage in $FILE_PATH — use sessionStorage with TTL (see token-modal.tsx)" >&2; exit 2
fi

exit 0
