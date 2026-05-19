#!/usr/bin/env bash
# Hook: SessionEnd — Session Friction Reflector
# Analyzes the session JSONL to compute a friction score and generate a report.
# Output: .claude/tasks/reflections/{session_id}-{date}.md

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || pwd)}"
_PROJECT_SLUG=$(echo "$PROJECT_ROOT" | sed 's|/|-|g')
SESSIONS_DIR="$HOME/.claude/projects/$_PROJECT_SLUG"
REFLECTIONS_DIR="$PROJECT_ROOT/.claude/tasks/reflections"
DATE=$(date +%Y-%m-%d)

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('session_id',''))" 2>/dev/null || echo "")

[[ -z "$SESSION_ID" ]] && exit 0

JSONL_FILE="$SESSIONS_DIR/$SESSION_ID.jsonl"
[[ ! -f "$JSONL_FILE" ]] && exit 0

# Skip short sessions (< 10 tool calls = quick chat)
TOOL_COUNT=$(python3 -c "
import json
count = 0
with open('$JSONL_FILE') as f:
    for line in f:
        try:
            obj = json.loads(line)
            if obj.get('type') == 'assistant':
                for item in obj.get('message', {}).get('content', []):
                    if isinstance(item, dict) and item.get('type') == 'tool_use':
                        count += 1
        except: pass
print(count)
" 2>/dev/null || echo "0")

[[ "$TOOL_COUNT" -lt 10 ]] && exit 0

mkdir -p "$REFLECTIONS_DIR"
OUTPUT_FILE="$REFLECTIONS_DIR/${SESSION_ID:0:8}-$DATE.md"

[[ -f "$OUTPUT_FILE" ]] && exit 0

python3 - "$JSONL_FILE" "$SESSION_ID" "$DATE" << 'PYEOF' > "$OUTPUT_FILE"
import sys, json
from collections import Counter

jsonl_file, session_id, date = sys.argv[1], sys.argv[2], sys.argv[3]

tool_calls = Counter()
tool_errors = []
prev_tool = None
prev_count = 0
retries = []
user_turns = 0
slug = ""
git_branch = ""

with open(jsonl_file) as f:
    for line in f:
        try:
            obj = json.loads(line)
        except:
            continue

        t = obj.get("type", "")
        if not slug and obj.get("slug"):
            slug = obj["slug"]
        if not git_branch and obj.get("gitBranch"):
            git_branch = obj["gitBranch"]

        if t == "user":
            user_turns += 1
            content = obj.get("message", {}).get("content", [])
            if isinstance(content, list):
                for item in content:
                    if isinstance(item, dict) and item.get("type") == "tool_result" and item.get("is_error"):
                        raw = item.get("content", "")
                        if isinstance(raw, list):
                            raw = " ".join(str(x) for x in raw)
                        tool_errors.append(str(raw)[:150])

        if t == "assistant":
            for item in obj.get("message", {}).get("content", []):
                if isinstance(item, dict) and item.get("type") == "tool_use":
                    name = item.get("name", "")
                    tool_calls[name] += 1

                    if name == prev_tool:
                        prev_count += 1
                    else:
                        if prev_count > 2:
                            retries.append((prev_tool, prev_count))
                        prev_tool = name
                        prev_count = 1

if prev_count > 2:
    retries.append((prev_tool, prev_count))

total = sum(tool_calls.values())
error_rate = len(tool_errors) / max(total, 1) * 100
friction = len(tool_errors) * 3 + len(retries) * 2

if friction >= 20:
    severity = "🔴 HIGH"
elif friction >= 8:
    severity = "🟡 MEDIUM"
else:
    severity = "🟢 LOW"

pattern_labels = {
    "Write before Read": [e for e in tool_errors if "not been read" in e.lower()],
    "Permission/gitignore": [e for e in tool_errors if "permission" in e.lower() or "gitignore" in e.lower()],
    "Exit code 1": [e for e in tool_errors if "exit code 1" in e.lower()],
    "TypeScript": [e for e in tool_errors if "tsc" in e.lower() or "typescript" in e.lower()],
}

print(f"# Reflection — {session_id[:8]} ({date})")
print()
print(f"**Session**: `{slug}` | Branch: `{git_branch}`")
print(f"**Friction**: {friction} {severity}")
print()
print("## Stats")
print()
print(f"| Metric | Value |")
print(f"|--------|-------|")
print(f"| Turns | {user_turns} |")
print(f"| Tool calls | {total} |")
print(f"| Errors | {len(tool_errors)} ({error_rate:.0f}%) |")
print(f"| Retries | {len(retries)} |")
print(f"| Top tool | {tool_calls.most_common(1)[0][0] if tool_calls else 'n/a'} ({tool_calls.most_common(1)[0][1] if tool_calls else 0}x) |")
print()

if tool_errors or retries:
    print("## Friction")
    print()

    for label, matches in pattern_labels.items():
        if matches:
            print(f"### {label} ({len(matches)}x)")
            for m in matches[:2]:
                print(f"- `{m[:120]}`")

    other_errors = [e for e in tool_errors if not any(
        k in e.lower() for k in ["not been read", "permission", "gitignore", "exit code 1", "tsc", "typescript"]
    )]
    if other_errors:
        print(f"### Other errors ({len(other_errors)}x)")
        for e in other_errors[:2]:
            print(f"- `{e[:120]}`")

    if retries:
        print()
        print("### Retries (same tool 3x+)")
        for tool, count in retries[:5]:
            print(f"- `{tool}` × {count}")

    print()
    print("## Suggestions")
    print()

    suggestions = []
    if any("not been read" in e.lower() for e in tool_errors):
        suggestions.append("Rule candidate: Always Read file before Write/Edit")
    if retries:
        top_retry = max(retries, key=lambda x: x[1])
        suggestions.append(f"Pattern: `{top_retry[0]}` called {top_retry[1]}x — verify if retry logic is needed")

    if suggestions:
        for s in suggestions:
            print(f"- [ ] {s}")
    else:
        print("No automatic suggestions — low friction.")
else:
    print("## Friction")
    print()
    print("No significant friction detected. 🎯")

print()
print("---")
print(f"*Auto-generated by `session-reflector.sh` hook SessionEnd*")
PYEOF

echo ""
echo "🔍 Reflection: ${OUTPUT_FILE##*/}"
friction=$(grep "Friction:" "$OUTPUT_FILE" | head -1 | grep -o '[0-9]*' | head -1 || echo "0")
severity=$(grep "Friction:" "$OUTPUT_FILE" | grep -oE "🔴|🟡|🟢" || echo "⚪")
echo "   Score: $friction $severity"
errors=$(grep "| Errors |" "$OUTPUT_FILE" | grep -oE '[0-9]+' | head -1 || echo "0")
if [[ "$errors" -gt 0 ]]; then
  echo "   See: $OUTPUT_FILE"
fi
echo ""
