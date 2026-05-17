---
name: tech-vercel-logs
description: Recherche et debug dans les logs Vercel (production/preview). Supporte la recherche par pattern, filtre par niveau d'erreur, par route API, par déploiement. Utiliser pour diagnostiquer des erreurs de production, tracer des requêtes ou analyser des crashs.
effort: low
allowed-tools: Bash, Read
---

# Vercel Logs — Search & Debug

Recherche et analyse les logs Vercel pour diagnostiquer des problèmes de production.

## Quand Utiliser Ce Skill

- Une erreur remonte en production mais pas en local
- Besoin de tracer une requête API spécifique
- Analyser les logs d'un déploiement récent
- Chercher un pattern d'erreur sur une période donnée

## Paramètres Attendus

L'utilisateur peut fournir (tout est optionnel) :

| Paramètre          | Exemple                                | Défaut               |
| ------------------ | -------------------------------------- | -------------------- |
| Pattern à chercher | "TypeError", "/api/sessions", "userId" | -                    |
| Niveau             | error, warning, info                   | error                |
| Déploiement        | URL ou ID                              | dernier prod         |
| Fenêtre temps      | "30m", "2h", "today"                   | 10 dernières minutes |
| Route / fonction   | "/api/trpc/session"                    | -                    |

## Workflow d'Exécution

### Étape 0 — Charger VERCEL_TOKEN

Avant toute commande, vérifier et charger le token :

```bash
# Si déjà dans le shell → OK
if [ -z "$VERCEL_TOKEN" ]; then
  # Chercher dans .env.local du projet courant
  ENV_FILE=".env.local"
  if [ -f "$ENV_FILE" ]; then
    export VERCEL_TOKEN=$(grep '^VERCEL_TOKEN=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")
    echo "VERCEL_TOKEN chargé depuis $ENV_FILE"
  else
    echo "⚠️  VERCEL_TOKEN introuvable. Ajouter dans .env.local ou ~/.zshrc"
    exit 1
  fi
fi
# Vérification rapide (sans exposer le token)
echo "Token OK : ${VERCEL_TOKEN:0:8}..."
```

### Étape 1 — Identifier le déploiement cible

```bash
# Lister les déploiements récents (prod)
vercel list --prod 2>/dev/null | head -20

# Ou via API REST (plus fiable)
curl -s "https://api.vercel.com/v6/deployments?limit=5&target=production" \
  -H "Authorization: Bearer $VERCEL_TOKEN" | jq '.deployments[] | {uid, url, state, createdAt}'
```

### Étape 2 — Récupérer les logs

**Méthode A — CLI (temps réel, 5 min max) :**

```bash
vercel logs <DEPLOYMENT_URL> --json 2>/dev/null | jq '.'
```

**Méthode B — API REST (historique, recommandée) :**

```bash
# Logs runtime d'un déploiement
DEPLOYMENT_ID="<id>"
curl -s "https://api.vercel.com/v2/deployments/$DEPLOYMENT_ID/events" \
  -H "Authorization: Bearer $VERCEL_TOKEN" | jq '.[]'

# Avec filtre temporel (timestamp Unix ms)
SINCE=$(date -v-1H +%s000)  # 1h ago, macOS
curl -s "https://api.vercel.com/v2/deployments/$DEPLOYMENT_ID/events?since=$SINCE" \
  -H "Authorization: Bearer $VERCEL_TOKEN" | jq '.[]'
```

### Étape 3 — Filtrer et analyser

```bash
# Filtrer par niveau d'erreur
vercel logs <URL> --json | jq 'select(.level == "error")'

# Filtrer par pattern texte
vercel logs <URL> --json | jq 'select(.text | test("TypeError|Cannot read"))'

# Filtrer par route API
vercel logs <URL> --json | jq 'select(.text | test("/api/sessions"))'

# Top erreurs groupées
vercel logs <URL> --json | jq -r '.text' | sort | uniq -c | sort -rn | head -20

# Erreurs avec timestamp lisible
vercel logs <URL> --json | jq 'select(.level == "error") | {time: (.date | todate), msg: .text}'
```

### Étape 4 — Résumé et diagnostic

Après analyse, produire :

```
Résultats pour : [pattern ou URL]
Déploiement   : [url] — [state] — [date]
Fenêtre       : [depuis → jusqu'à]

ERREURS TROUVÉES : N

[Pour chaque groupe d'erreurs]
---
Type   : [level]
Route  : [path si identifiable]
Count  : [occurrences]
Sample : [première occurrence complète]
Stack  : [si disponible]
---

HYPOTHÈSES :
1. [Cause probable + ligne de code suspecte]
2. [Alternative si ambiguë]

ACTIONS SUGGÉRÉES :
→ [Commande de fix ou fichier à inspecter]
```

## Variables d'Environnement Requises

```bash
# Dans ~/.zshrc ou via vercel env
VERCEL_TOKEN="..."   # vercel.com → Settings → Tokens
VERCEL_TEAM_ID="..." # optionnel, si scope team
```

Vérifier la présence :

```bash
echo $VERCEL_TOKEN | cut -c1-10  # Affiche les 10 premiers chars sans exposer le token
vercel whoami  # Vérifie l'auth CLI
```

## Commandes Utiles Rapides

```bash
# Dernier déploiement prod avec son URL
vercel list --prod 2>/dev/null | awk 'NR==2{print $2}'

# Logs erreurs en direct (10 min max avec watch)
watch -n 30 'vercel logs $(vercel list --prod 2>/dev/null | awk "NR==2{print \$2}") --json 2>/dev/null | jq "select(.level==\"error\") | .text"'

# Logs d'une fonction Edge / serverless spécifique
vercel logs <URL> --json | jq 'select(.text | test("api/trpc"))'
```

## Limites Connues

| Contrainte    | Détail                                                          |
| ------------- | --------------------------------------------------------------- |
| Rétention CLI | 5 minutes de streaming (temps réel uniquement)                  |
| Rétention API | 3 jours (plan Pro)                                              |
| Logs build    | Séparés des logs runtime (`?builds=1`)                          |
| Volume        | Pas de full-text search native — filtrer via `jq`               |
| Latence       | ~30s de délai entre l'événement et son apparition dans les logs |

## Alternative : Log Drain

Si les logs Vercel sont insuffisants (rétention trop courte, volume trop élevé) :

- **Axiom** : intégration native Vercel, free tier généreux, full-text search
- **Datadog** : plus complet, plus cher
- **Logtail** : simple, bonne UX

Configurer via : Vercel Dashboard → Project → Settings → Log Drains
