#!/usr/bin/env bash
# Snapshot the live Vercel firewall configuration into the repo.
#
# WAF rules live in Vercel's dashboard, not in git: no diff, no blame, no revert if
# someone loosens a rule. vercel.json cannot close the gap either, because its
# routes[].mitigate form supports only deny and challenge, while the rules that keep
# GitHub camo reachable are bypass.
#
# So this writes the live config to docs/firewall-config.json on demand. It is a
# record, not a source of truth: re-running it after every publish is what makes the
# file worth keeping.
#
# Usage:
#   pnpm ops:firewall-snapshot           # write the snapshot
#   pnpm ops:firewall-snapshot --check   # exit 1 if stale (for CI)

set -euo pipefail

OUT="docs/firewall-config.json"
CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1

command -v vercel >/dev/null || { echo "vercel CLI not found: pnpm add -g vercel" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq not found: brew install jq" >&2; exit 1; }
[[ -d .vercel ]] || { echo "project not linked, run: vercel link" >&2; exit 1; }

# Temp file sits next to the output rather than in $TMPDIR, so the final mv stays on
# one filesystem and is therefore atomic: a killed run cannot leave a truncated file.
mkdir -p "$(dirname "$OUT")"
TMP="$OUT.tmp"
trap 'rm -f "$TMP"' EXIT

# One call carries everything: .active (live rules, IP blocks, managed rulesets, CRS),
# .bypass (system bypass), .attackMode, .draft (staged but not published).
RAW="$(vercel firewall overview --json 2>/dev/null)"
[[ -n "$RAW" ]] || { echo "vercel firewall overview returned nothing, are you logged in?" >&2; exit 1; }

# A snapshot taken with drafts pending would record a state that is not serving traffic.
if [[ "$(jq -r '.draft // empty | if . == {} then "" else "yes" end' <<<"$RAW")" == "yes" ]]; then
  echo "unpublished draft changes are pending, publish or discard them first" >&2
  echo "  vercel firewall diff" >&2
  exit 1
fi

# Dropped on purpose:
#   ownerId / projectKey  this repo is public, team and project ids do not belong in it
#   changes               an audit log carrying usernames and userIds, and pure churn
#   id / updatedAt        the git commit already records when and what changed
# jq -S sorts keys, so a reordering by the API does not surface as a diff.
jq -S '{
  firewallEnabled: .active.firewallEnabled,
  managedRules:    .active.managedRules,
  crs:             .active.crs,
  rules:           .active.rules,
  ipBlocks:        .active.ips,
  systemBypass:    .bypass,
  attackMode:      .attackMode,
}' <<<"$RAW" > "$TMP"

if [[ $CHECK -eq 1 ]]; then
  if ! diff -q "$TMP" "$OUT" >/dev/null 2>&1; then
    echo "$OUT is stale, run: pnpm ops:firewall-snapshot" >&2
    diff "$OUT" "$TMP" || true
    exit 1
  fi
  echo "$OUT matches the live configuration"
  exit 0
fi

mv "$TMP" "$OUT"
trap - EXIT
echo "wrote $OUT: $(jq '.rules | length' "$OUT") custom rules, $(jq '.ipBlocks | length' "$OUT") IP blocks, bot protection $(jq -r '.managedRules.bot_protection.action // "off"' "$OUT")"
