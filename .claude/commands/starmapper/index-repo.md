---
name: index-repo
description: Scan and warm the geocache for a GitHub repo via the StarMapper production API. Drives the chunk loop (100 users/call) and reports live progress. Does NOT save the full stargazer_cache (browser visit required for that).
tools: Bash
---

# StarMapper: Index Repo

Drive the StarMapper chunk loop against production to warm the geocache for a given repo.

**Why it matters**: First visit to `starmapper.bruniaux.com/owner/repo` cold-indexes the repo live, which takes 1-2s/user via Nominatim. Running this command pre-warms the geocache so the browser visit is fast.

## Usage

```
/starmapper:index-repo owner/repo
```

Examples:
- `/starmapper:index-repo systemdesign42/system-design-academy`
- `/starmapper:index-repo facebook/react`

## Instructions

### Step 1: Parse the argument

Extract `OWNER` and `REPO` from `$ARGUMENTS`:
- If format is `owner/repo`: `OWNER=$(echo "$ARGUMENTS" | cut -d'/' -f1)`, `REPO=$(echo "$ARGUMENTS" | cut -d'/' -f2-)`
- If missing `/`: ask "Format attendu: owner/repo (ex: systemdesign42/system-design-academy)"

### Step 2: Get star count + estimate

```bash
REPO_INFO=$(curl -s "https://starmapper.bruniaux.com/api/repo-info?owner=$OWNER&repo=$REPO")
STARS=$(echo "$REPO_INFO" | jq -r '.stars // 0')
REPO_NAME=$(echo "$REPO_INFO" | jq -r '.name // "unknown"')
echo "Repo: $REPO_NAME | $STARS stars"
```

Compute estimate:
- Chunks = `ceil(STARS / 100)`
- Worst case (cold geocache, Nominatim 1100ms/user): `STARS x 1.1s`
- Best case (warm geocache): `chunks x 3s`
- Display: "~X min worst case (cold) / ~Y min best case (warm cache)"

If stars > 5000, warn: "This repo has $STARS stars, could take up to $(($STARS / 60))+ min cold. Continue? (y/n)"
Wait for user confirmation before proceeding.

### Step 3: Run the chunk loop

```bash
cursor=""
mapped=0
unmapped=0
chunk=0

while true; do
  chunk=$((chunk + 1))

  if [ -z "$cursor" ]; then
    body=$(printf '{"owner":"%s","repo":"%s"}' "$OWNER" "$REPO")
  else
    body=$(jq -nc --arg owner "$OWNER" --arg repo "$REPO" --arg cursor "$cursor" \
      '{"owner":$owner,"repo":$repo,"cursor":$cursor}')
  fi

  resp=$(curl -s --max-time 30 -X POST "https://starmapper.bruniaux.com/api/chunk" \
    -H "Content-Type: application/json" \
    -d "$body")

  if echo "$resp" | jq -e '.error' > /dev/null 2>&1; then
    ERR=$(echo "$resp" | jq -r '.error')
    echo "Error on chunk $chunk: $ERR"
    break
  fi

  pts=$(echo "$resp" | jq '.points | length')
  unm=$(echo "$resp" | jq '.unmapped | length')
  next=$(echo "$resp" | jq -r '.nextCursor // empty')
  total=$(echo "$resp" | jq -r '.totalCount // "?"')

  mapped=$((mapped + pts))
  unmapped=$((unmapped + unm))
  processed=$((mapped + unmapped))

  printf "  Chunk %-4d | +%-3d mapped | +%-3d unmapped | %d/%s processed\n" \
    $chunk $pts $unm $processed $total

  [ -z "$next" ] && break
  cursor="$next"
done
```

### Step 4: Final report

```
Done: $OWNER/$REPO indexed
   Stars total  : $total
   Mapped       : $mapped ($((mapped * 100 / (mapped + unmapped > 0 ? mapped + unmapped : 1)))%)
   Unmapped     : $unmapped (no location or geocoding failed)
   Chunks run   : $chunk
   URL          : https://starmapper.bruniaux.com/$OWNER/$REPO
```

Then add: "Geocache is now warm. Browser visit will load faster. To save the full stargazer_cache (instant reload for all users), visit the URL above and let it complete in the browser."

### Error handling

| Error | Action |
|-------|--------|
| `curl: connection refused` | "StarMapper production unreachable, check starmapper.bruniaux.com" |
| `.error: "rate_limit"` | "GitHub rate limit hit, wait ~1h then retry" |
| `.error: "not_found"` | "Repo $OWNER/$REPO not found or private" |
| Empty response | Retry once with `sleep 3`, then abort and report chunk number |
| `--max-time` reached | Report timeout, suggest retry (Nominatim may be slow) |

### Caveats

- **No stargazer_cache save**: the full compressed cache (`stargazer_cache` table) requires a browser visit. This command only warms the per-location `geocache` table.
- **Nominatim rate limit**: 1 req/s server-side on large repos takes real time. The server enforces this; the command just waits.
- **Partial run value**: even if interrupted, geocache entries written so far persist. Rerunning resumes from where it stopped (cache hits are instant).