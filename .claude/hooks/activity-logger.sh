#!/usr/bin/env bash
# Hook: PostToolUse — Activity Logger
# Logs all Claude tool calls in JSONL with 7-day rotation.
# Output: ~/.claude/logs/activity-YYYY-MM-DD.jsonl

set -euo pipefail

LOG_DIR="${HOME}/.claude/logs"
LOG_FILE="${LOG_DIR}/activity-$(date +%Y-%m-%d).jsonl"
MAX_DAYS=7

mkdir -p "$LOG_DIR"
find "$LOG_DIR" -name "activity-*.jsonl" -mtime +$MAX_DAYS -exec rm -f {} + 2>/dev/null || true

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

case "$TOOL_NAME" in
  Edit|Write)
    DETAIL=$(echo "$TOOL_INPUT" | jq -r '.file_path // "unknown"')
    CATEGORY="file"
    ;;
  Read)
    DETAIL=$(echo "$TOOL_INPUT" | jq -r '.file_path // "unknown"')
    CATEGORY="file"
    ;;
  Glob|Grep)
    DETAIL=$(echo "$TOOL_INPUT" | jq -r '.pattern // "unknown"')
    CATEGORY="search"
    ;;
  Bash)
    CMD=$(echo "$TOOL_INPUT" | jq -r '.command // "unknown"')
    DETAIL=$(echo "$CMD" | head -c 200)
    CATEGORY="bash"
    ;;
  mcp__grepai__search)
    DETAIL=$(echo "$TOOL_INPUT" | jq -r '.query // "unknown"')
    CATEGORY="semantic_search"
    ;;
  mcp__grepai__trace_callers|mcp__grepai__trace_callees|mcp__grepai__trace_graph)
    DETAIL=$(echo "$TOOL_INPUT" | jq -r '.symbol // "unknown"')
    CATEGORY="call_graph"
    ;;
  mcp__postgres-starmapper__query|mcp__postgres-starmapper-local__query)
    QUERY=$(echo "$TOOL_INPUT" | jq -r '.query // "unknown"' | head -c 100)
    DETAIL="$QUERY"
    CATEGORY="database"
    ;;
  Task)
    AGENT=$(echo "$TOOL_INPUT" | jq -r '.subagent_type // "unknown"')
    DESC=$(echo "$TOOL_INPUT" | jq -r '.description // ""' | head -c 50)
    DETAIL="${AGENT}: ${DESC}"
    CATEGORY="agent"
    ;;
  *)
    DETAIL=$(echo "$TOOL_INPUT" | jq -c '.' | head -c 100)
    CATEGORY="other"
    ;;
esac

LOG_ENTRY=$(jq -c -n \
  --arg ts "$TIMESTAMP" \
  --arg tool "$TOOL_NAME" \
  --arg cat "$CATEGORY" \
  --arg detail "$DETAIL" \
  --arg session "$SESSION_ID" \
  '{timestamp: $ts, tool: $tool, category: $cat, detail: $detail, session: $session}')

echo "$LOG_ENTRY" >> "$LOG_FILE"

exit 0
