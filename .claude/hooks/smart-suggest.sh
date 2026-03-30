#!/bin/bash
# Hook: UserPromptSubmit - Concierge: suggest relevant agents/commands
# Non-blocking, pure bash, max 1 suggestion per prompt
# Adapted from Aristote smart-suggest for StarMapper context

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // empty' 2>/dev/null || true)

# Exit early if prompt too short
if [[ -z "$PROMPT" || ${#PROMPT} -lt 8 ]]; then
    exit 0
fi

PROMPT_LC=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]')

# Skip if already a slash command
if [[ "$PROMPT_LC" =~ ^/ ]]; then
    exit 0
fi

LABEL_CMD="Commande"
LABEL_AGENT="Agent"

suggest() {
    local label="$1" name="$2" reason="$3"

    # Dedup: skip if command/agent name already in prompt
    local check
    check=$(echo "$name" | tr '[:upper:]' '[:lower:]' | sed 's|^/||' | awk '{print $1}')
    if echo "$PROMPT_LC" | grep -qF "$check"; then
        exit 0
    fi

    # ROI log (non-blocking)
    local logdir="${HOME}/.claude/logs"
    mkdir -p "$logdir" 2>/dev/null || true
    printf '{"ts":"%s","project":"starmapper","suggested":"%s","prompt_len":%d}\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$name" "${#PROMPT}" \
        >> "$logdir/smart-suggest.jsonl" 2>/dev/null || true

    cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "[Suggestion] $label : $name -- $reason"
  }
}
EOF
    exit 0
}

# ===========================================================================
# TIER 0: Enforcement — required workflow before implementation
# ===========================================================================

# Commit suggestion
if echo "$PROMPT_LC" | grep -qE '(fais.*commit|faire.*commit|je veux.*commit|git commit|commite.*(tout|[cç]a)|save and commit)'; then
    if ! echo "$PROMPT_LC" | grep -qE '(convention|format|comment|message|style|historique)'; then
        suggest "$LABEL_CMD" "/commit" "Commit Conventional StarMapper avec scopes (map/api/cache/geocoder...)"
    fi
fi

# PR creation
if echo "$PROMPT_LC" | grep -qE '(cr[eé][eé]?.*pr|ouvr.*pr|pull.request|fais.*pr|lance.*pr|push.*pr)'; then
    suggest "$LABEL_CMD" "/open-pr" "Ouvrir une PR GitHub avec description structurée"
fi

# ===========================================================================
# TIER 1: High-value discovery tools
# ===========================================================================

# ICM Memory — decision or convention to memorize
if echo "$PROMPT_LC" | grep -qE '(on (a |va |)d[eé]cid|la d[eé]cision c.est|on part sur|[àa] partir de maintenant|la r[eè]gle c.est|retiens|note que|souviens.toi|remember|m[eé]morise)'; then
    suggest "$LABEL_CMD" "/remember" "Stocker dans ICM (mémoire persistante cross-session)"
fi

# ICM Recall — previous session context
if echo "$PROMPT_LC" | grep -qE '(o[uù] on en [eé]tait|reprend(s|re)?|contexte.*(session|hier|avant)|hier (on|j)|la derni[eè]re fois|suite de|je reprends|on reprend)'; then
    suggest "$LABEL_CMD" "/recall" "Récupérer le contexte ICM de la session précédente"
fi

# Geocache operations
if echo "$PROMPT_LC" | grep -qE '(geocach|g[eé]ocach|g[eé]ocode|nominatim|jawg|geoapify)'; then
    if echo "$PROMPT_LC" | grep -qE '(lent|slow|performance|optimis|rate.limit|quota)'; then
        suggest "$LABEL_AGENT" "backend-architect" "Review geocoding cascade + cache strategy"
    fi
fi

# MapLibre changes
if echo "$PROMPT_LC" | grep -qE '(maplibre|carte|map.*layer|cluster|popup.*map|source.*stargazer)'; then
    if echo "$PROMPT_LC" | grep -qE '(bug|crash|slow|render|blink|flash|performance)'; then
        suggest "$LABEL_AGENT" "frontend-architect" "Debug MapLibre GL + patterns de rendu"
    fi
fi

# Rate limit concerns
if echo "$PROMPT_LC" | grep -qE '(rate.limit|429|quota|throttl|nominatim.*delay|github.*limit)'; then
    suggest "$LABEL_AGENT" "backend-architect" "Revue des patterns rate-limit + circuit breakers"
fi

# Cache operations (stargazer, geocache, badge)
if echo "$PROMPT_LC" | grep -qE '(cache.*corrupt|cache.*invalid|rescan|rescann|vider.*cache|clear.*cache)'; then
    suggest "$LABEL_AGENT" "system-architect" "Stratégie de cache invalidation StarMapper"
fi

# Security / OWASP
if echo "$PROMPT_LC" | grep -qE '(xss|injection.*(sql|code)|vulnerab|owasp|faille|securit.*audit)'; then
    suggest "$LABEL_AGENT" "security-guardian" "Audit sécurité OWASP StarMapper"
fi

# Code duplication
if echo "$PROMPT_LC" | grep -qE '(duplic.*(detect|find|check)|lancer.*dupes|voir.*(duplication|dupes)|jscpd)'; then
    suggest "$LABEL_CMD" "/tech:dupes" "Détecte la duplication de code"
fi

# Codebase audit
if echo "$PROMPT_LC" | grep -qE '(audit.*(codebase|code|projet)|health.check|quality.*(code|check))'; then
    suggest "$LABEL_CMD" "/tech:audit-codebase" "Audit santé codebase StarMapper (7 catégories)"
fi

# Challenge plan submitted by user
if echo "$PROMPT_LC" | grep -qE '(voici (mon|le|un) plan|regarde (ce|mon) plan|challenge (ce|mon|le) plan|j.ai un plan)'; then
    suggest "$LABEL_CMD" "/critique-plan" "Challenge le plan en 6 dimensions avant implémentation"
fi

# Broken env / diagnosis
if echo "$PROMPT_LC" | grep -qE '(env.*(cass|broken|marche pas)|neon.*(fail|down)|prisma.*(error|fail)|db.*(down|unavailable))'; then
    suggest "$LABEL_AGENT" "backend-architect" "Diagnostic DB + Prisma + connexion Neon"
fi

# ===========================================================================
# TIER 2: Contextual suggestions
# ===========================================================================

# Code review
if echo "$PROMPT_LC" | grep -qE '(review.*(code|pr|fichier)|code.review|revue de code|avant.*(pr|merge))'; then
    suggest "$LABEL_AGENT" "code-reviewer" "Review qualité + sécurité + performance StarMapper"
fi

# Debug
if echo "$PROMPT_LC" | grep -qE '(debug.*(erreur|error|bug|issue)|fix.*(bug|crash)|stack.trace|ne (marche|fonctionne) pas)'; then
    suggest "$LABEL_AGENT" "debugger" "Debug méthodique avec root cause analysis"
fi

# Architecture review
if echo "$PROMPT_LC" | grep -qE '(archit.*(decision|review|valide)|system.design|refactor.*(large|majeur|global))'; then
    suggest "$LABEL_AGENT" "architect-review" "Validation décisions architecturales StarMapper"
fi

# Prisma / DB schema
if echo "$PROMPT_LC" | grep -qE '(migration.*prisma|schema.*(change|modif)|nouvelle.*(table|entite|model)|prisma.db.push)'; then
    suggest "$LABEL_AGENT" "backend-architect" "Design schema DB + migration Neon"
fi

# Performance MapLibre bundle
if echo "$PROMPT_LC" | grep -qE '(bundle.*trop (gros|lourd)|taille.*bundle|lighthouse|core.web.vitals|lcp|fid|cls)'; then
    suggest "$LABEL_AGENT" "frontend-architect" "Optimisation bundle + Core Web Vitals"
fi

# GitHub Issue creation
if echo "$PROMPT_LC" | grep -qE '(cr.*(github issue|une issue|ticket github)|ouvr.*(issue|ticket)|tracker.*(besoin|ca|ce|dette))'; then
    suggest "$LABEL_CMD" "gh issue create" "Créer une GitHub Issue pour tracker ce besoin"
fi

# No match — silent exit
exit 0
