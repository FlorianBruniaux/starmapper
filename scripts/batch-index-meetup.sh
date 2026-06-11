#!/usr/bin/env bash
# batch-index-meetup.sh
#
# Indexe tous les repos (avec étoiles) des participants du meetup StarMapper.
# Source de vérité : GitHub API directement (pas StarMapper /api/repo-info).
#
# Usage:
#   bash scripts/batch-index-meetup.sh --dry-run
#   bash scripts/batch-index-meetup.sh

PROD_API="https://starmapper.bruniaux.com"
DRY_RUN=false
[ "$1" = "--dry-run" ] && DRY_RUN=true

# Charger le token depuis .env.local
if [ -f "$(dirname "$0")/../.env.local" ]; then
  GITHUB_TOKEN=$(grep -E '^GITHUB_TOKEN=' "$(dirname "$0")/../.env.local" | head -1 | cut -d'=' -f2-)
  export GITHUB_TOKEN
fi
[ -z "$GITHUB_TOKEN" ] && echo "⚠ GITHUB_TOKEN manquant"

# Header auth GitHub (array pour éviter le word-splitting)
GH_AUTH=()
[ -n "$GITHUB_TOKEN" ] && GH_AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN")

# Fichiers temporaires
REPOS_FILE=$(mktemp /tmp/starmapper-repos-XXXXXX.txt)
COOKIE_JAR=$(mktemp /tmp/starmapper-cookies-XXXXXX.txt)
trap 'rm -f "$REPOS_FILE" "$COOKIE_JAR"' EXIT

# Obtenir le cookie HMAC de session (émis sur tout GET non-API)
echo "Obtention du cookie de session..."
curl -s -c "$COOKIE_JAR" -o /dev/null "https://starmapper.bruniaux.com/"
if ! grep -q "sm-token" "$COOKIE_JAR" 2>/dev/null; then
  echo "  ⚠ Cookie sm-token absent — les appels chunk peuvent être refusés si SM_TOKEN_SECRET est actif en prod"
else
  echo "  ✓ Cookie OK"
fi

# ---------- Profils GitHub ----------
PROFILES=(
  SaboniAmine j-abi DGouron StephenGodard remster85 Justinodjo
  andreas-roehler atrahay axelguilmin b-2-83 Brahimk C-Vellen
  Cyphle Ebed-meleck bashlor whispem erdprt ExploryKod
  izumiberat longplayer LuaGeo Mco-Design MaximilienMoreau bracketouverte
  goumix Nouhayousse patjoub-sc sharbatc SimonCollet90 tracy040401
  skyjiao yg0a1n dot-yaya
)

# ---------- Repos directs ----------
DIRECT_REPOS=(
  "cmnemoi/emush-rag"
  "cmnemoi/sightcall-qa-api"
  "DragosDreptate/the-playground"
  "dilolabs/nosia"
  "SamuelPrigent/Poplist"
  "IvandeMurard/aetherix-hospitality-ai"
)

# -------------------------------------------------------
resolve_user() {
  local user="$1" page=1
  while true; do
    local batch
    batch=$(curl -s "${GH_AUTH[@]}" \
      "https://api.github.com/users/$user/repos?per_page=100&sort=stars&page=$page")
    if echo "$batch" | jq -e '.message' > /dev/null 2>&1; then
      echo "  ⚠ $user: $(echo "$batch" | jq -r '.message')" >&2
      break
    fi
    local count
    count=$(echo "$batch" | jq 'length')
    [ "$count" -eq 0 ] && break
    # Écrire "owner/repo STARS" dans le fichier (stars > 0 uniquement)
    echo "$batch" | jq -r '.[] | select(.stargazers_count > 0) | "\(.full_name) \(.stargazers_count)"' >> "$REPOS_FILE"
    [ "$count" -lt 100 ] && break
    page=$((page + 1))
  done
}

index_repo() {
  local full_repo="$1" stars="$2"
  local OWNER="${full_repo%%/*}" REPO="${full_repo##*/}"
  local POINTS_FILE_REPO UNMAPPED_FILE_REPO CACHE_BODY_FILE RESP_FILE
  POINTS_FILE_REPO=$(mktemp /tmp/sm-points-XXXXXX.json)
  UNMAPPED_FILE_REPO=$(mktemp /tmp/sm-unmapped-XXXXXX.json)
  CACHE_BODY_FILE=$(mktemp /tmp/sm-cache-body-XXXXXX.json)
  RESP_FILE=$(mktemp /tmp/sm-resp-XXXXXX.json)

  if [ "$DRY_RUN" = true ]; then
    printf "  [dry-run] %-52s %4s stars\n" "$full_repo" "$stars"
    rm -f "$POINTS_FILE_REPO" "$UNMAPPED_FILE_REPO" "$CACHE_BODY_FILE" "$RESP_FILE"
    return
  fi

  echo "  → $full_repo ($stars stars)"
  local cursor="" mapped=0 unmapped=0 chunk=0

  while true; do
    chunk=$((chunk + 1))
    local body
    if [ -z "$cursor" ]; then
      body=$(printf '{"owner":"%s","repo":"%s"}' "$OWNER" "$REPO")
    else
      body=$(jq -nc --arg o "$OWNER" --arg r "$REPO" --arg c "$cursor" \
        '{"owner":$o,"repo":$r,"cursor":$c}')
    fi

    # Appel avec retry sur rate limit (30 req/min par IP)
    # Écriture dans un fichier pour éviter les bugs bash avec l'UTF-8 multi-octets dans les bios
    local attempt=0
    while true; do
      attempt=$((attempt + 1))
      curl -s --max-time 60 \
        -b "$COOKIE_JAR" \
        -H "Origin: $PROD_API" \
        -X POST "$PROD_API/api/chunk" \
        -H "Content-Type: application/json" -d "$body" \
        > "$RESP_FILE"

      local err
      err=$(jq -r '.error // empty' "$RESP_FILE" 2>/dev/null)

      # Rate limit → attendre et réessayer (max 5 tentatives)
      if [[ "$err" == *"Rate limit"* ]] || [[ "$err" == *"Server busy"* ]]; then
        if [ "$attempt" -ge 5 ]; then
          echo "    rate limit persistant après $attempt tentatives, abandon du chunk $chunk"
          rm -f "$POINTS_FILE_REPO" "$UNMAPPED_FILE_REPO" "$CACHE_BODY_FILE" "$RESP_FILE"
          return
        fi
        echo "    ⏳ rate limit — attente 65s (tentative $attempt/5)"
        sleep 65
        continue
      fi
      break
    done

    [ ! -s "$RESP_FILE" ] && { echo "    timeout chunk $chunk"; break; }

    if [ -n "$err" ]; then
      echo "    erreur: $err"; break
    fi

    local pts unm next total
    pts=$(jq '.points | length' "$RESP_FILE")
    unm=$(jq '.unmapped | length' "$RESP_FILE")
    next=$(jq -r '.nextCursor // empty' "$RESP_FILE")
    total=$(jq -r '.totalCount // "?"' "$RESP_FILE")
    mapped=$((mapped + pts)); unmapped=$((unmapped + unm))

    # Accumuler les données pour le stargazer-cache
    jq '.points' "$RESP_FILE" >> "$POINTS_FILE_REPO"
    jq '.unmapped' "$RESP_FILE" >> "$UNMAPPED_FILE_REPO"

    printf "    chunk %-3d | +%-3d mapped | +%-3d unmapped | %d/%s\n" \
      "$chunk" "$pts" "$unm" $((mapped + unmapped)) "$total"

    [ -z "$next" ] && break
    cursor="$next"
  done

  echo "    ✓ $mapped mapped, $unmapped unmapped | https://starmapper.bruniaux.com/$OWNER/$REPO"

  # --- Écriture directe en DB (contourne HTTP + rate limits) ---
  # Fusionne les arrays de chunks en un seul JSON plat, puis appelle le script TS.
  if [ "$((mapped + unmapped))" -gt 0 ]; then
    [ ! -s "$POINTS_FILE_REPO" ] && echo '[]' > "$POINTS_FILE_REPO"
    [ ! -s "$UNMAPPED_FILE_REPO" ] && echo '[]' > "$UNMAPPED_FILE_REPO"

    local MERGED_POINTS MERGED_UNMAPPED
    MERGED_POINTS=$(mktemp /tmp/sm-merged-pts-XXXXXX.json)
    MERGED_UNMAPPED=$(mktemp /tmp/sm-merged-unm-XXXXXX.json)

    # --slurp lit les N arrays de chunks → [$p[][]] les aplatit en un seul array
    jq -s '[.[][]]' "$POINTS_FILE_REPO"  > "$MERGED_POINTS"
    jq -s '[.[][]]' "$UNMAPPED_FILE_REPO" > "$MERGED_UNMAPPED"

    # Fetch forks + watchers pour l'organic score (l'appel GitHub reste nécessaire)
    local gh_meta forks_count=0 watchers_count=0 language=""
    gh_meta=$(curl -s --max-time 10 "${GH_AUTH[@]}" "https://api.github.com/repos/$OWNER/$REPO")
    forks_count=$(echo "$gh_meta" | jq -r '.forks_count // 0' 2>/dev/null || echo 0)
    watchers_count=$(echo "$gh_meta" | jq -r '.subscribers_count // 0' 2>/dev/null || echo 0)
    language=$(echo "$gh_meta" | jq -r '.language // empty' 2>/dev/null || echo "")

    pnpm tsx --env-file=.env.local scripts/save-repo-cache.ts \
      --owner "$OWNER" --repo "$REPO" \
      --points-file "$MERGED_POINTS" \
      --unmapped-file "$MERGED_UNMAPPED" \
      --total "$((mapped + unmapped))" \
      --forks "$forks_count" \
      --watchers "$watchers_count" \
      ${language:+--language "$language"}

    rm -f "$MERGED_POINTS" "$MERGED_UNMAPPED"
  fi

  rm -f "$POINTS_FILE_REPO" "$UNMAPPED_FILE_REPO" "$CACHE_BODY_FILE" "$RESP_FILE"
}

# -------------------------------------------------------
echo "=============================="
echo " StarMapper — Batch Indexer"
echo " Mode: $([ "$DRY_RUN" = true ] && echo 'DRY-RUN' || echo 'LIVE')"
echo " $(date)"
echo "=============================="

echo ""
echo "--- Phase 1 : résolution des profils ---"
for user in "${PROFILES[@]}"; do
  resolve_user "$user"
done

echo ""
echo "--- Ajout des repos directs ---"
for repo in "${DIRECT_REPOS[@]}"; do
  stars=$(curl -s "${GH_AUTH[@]}" "https://api.github.com/repos/$repo" | jq -r '.stargazers_count // 0')
  if [ "$stars" -gt 0 ]; then
    # Vérifier le doublon avant d'ajouter
    if ! grep -q "^$repo " "$REPOS_FILE" 2>/dev/null; then
      echo "$repo $stars" >> "$REPOS_FILE"
    fi
    echo "  $repo: $stars stars"
  else
    echo "  ⤹ $repo: 0 stars, ignoré"
  fi
done

# Déduplication + tri par stars décroissant
SORTED=$(sort -k2 -rn "$REPOS_FILE" | awk '!seen[$1]++')
TOTAL=$(echo "$SORTED" | grep -c . || true)
TOTAL_STARS=$(echo "$SORTED" | awk '{sum+=$2} END{print sum+0}')

echo ""
echo "Total repos: $TOTAL | Total stars: $TOTAL_STARS"
echo ""

echo "--- Phase 2 : indexation ---"
echo ""

indexed=0
while IFS=' ' read -r repo stars; do
  [ -z "$repo" ] && continue
  index_repo "$repo" "$stars"
  [ "$DRY_RUN" = false ] && { indexed=$((indexed + 1)); sleep 5; }
done <<< "$SORTED"

echo ""
echo "=============================="
if [ "$DRY_RUN" = true ]; then
  echo " Dry-run terminé : $TOTAL repos, ~$TOTAL_STARS stars."
  echo " Lancer sans --dry-run pour indexer."
else
  echo " Terminé. $indexed repos indexés."
fi
echo "=============================="
