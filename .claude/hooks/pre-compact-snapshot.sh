#!/usr/bin/env bash
# Hook: PreCompact — Snapshot context before compaction
# Saves branch, recent commits, and in-flight changes to a temp file
# so the next session can recover context after compaction.

set -euo pipefail

PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
SNAPSHOT_FILE="$PROJECT_ROOT/.claude/tasks/.pre-compact-snapshot.md"

mkdir -p "$PROJECT_ROOT/.claude/tasks"
cd "$PROJECT_ROOT"

BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
RECENT=$(git log --oneline -5 2>/dev/null || echo "no git history")
MODIFIED=$(git diff --name-only HEAD 2>/dev/null | head -10 || echo "")
STAGED=$(git diff --cached --name-only 2>/dev/null | head -10 || echo "")
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$SNAPSHOT_FILE" << MD
# Pre-Compact Snapshot — ${NOW}

**Branch:** ${BRANCH}

## Recent Commits
\`\`\`
${RECENT}
\`\`\`

## In-Flight Changes
Staged: ${STAGED:-none}
Modified: ${MODIFIED:-none}
MD

echo "Snapshot saved to ${SNAPSHOT_FILE##*/}" >&2
exit 0
