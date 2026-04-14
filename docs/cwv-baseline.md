# Core Web Vitals — Baseline & Suivi

**Date de création** : 2026-04-14  
**Objectif** : INP p75 < 200ms sur scan 10k stars, LCP p75 < 2.5s landing, CLS p75 < 0.1 toutes pages.

---

## Tableau de suivi

| Scénario | LCP | FCP | CLS | TBT | TTFB | Score LH | Date |
|---|---|---|---|---|---|---|---|
| Landing desktop | — | — | — | — | — | — | à mesurer |
| Landing mobile | — | — | — | — | — | — | à mesurer |
| Map page `/facebook/react` (mobile) | 36,873ms ⚠️ | 1,962ms | 0.000 ✅ | 82ms ✅ | 1,088ms | 72 | 2026-04-14 |
| Scan 10k stars — INP réel | — | — | — | — | — | — | à mesurer |

> ⚠️ **LCP 36.8s — artefact Lighthouse, pas un bug de rendering.**
> L'élément LCP est le bouton "Set my username" (15px hauteur) visible seulement après le scan complet.
> Lighthouse attend la fin du scan sur réseau throttlé mobile (~36s pour facebook/react).
> Le vrai LCP perçu par l'utilisateur = FCP 1.9s (shell + progress bar).
>
> **Ce qui compte vraiment** :
> - FCP 1.9s — shell rapide ✅
> - TBT 82ms — pas de blocking au load initial ✅
> - CLS 0.000 — zéro layout shift ✅
> - TTFB 1.1s — inflé par dev server, à re-mesurer en prod
>
> **Le vrai problème** = INP pendant le scan (non capturé par Lighthouse).
> Mesurer avec PerformanceObserver (voir section 2 ci-dessous).

**Prochaine étape** : mesurer INP réel pendant scan avec PerformanceObserver (section 2 ci-dessous).

---

## Instructions de mesure

### 1. Lighthouse (lab)

```bash
# Démarrer le serveur dev ou pointer vers prod
pnpm dev

# Landing desktop (--preset=desktop = no throttling, desktop viewport)
npx lighthouse http://localhost:3000 --preset=desktop \
  --output=json --output-path=./docs/cwv-baseline-landing-desktop.json

# Landing mobile (default = mobile throttled + mobile viewport)
npx lighthouse http://localhost:3000 \
  --output=json --output-path=./docs/cwv-baseline-landing-mobile.json

# Map page — repo ~10k stars (mobile throttled)
npx lighthouse http://localhost:3000/facebook/react \
  --output=json --output-path=./docs/cwv-baseline-react-mobile.json
```

Extraire les valeurs du JSON :
```bash
# LCP
node -e "const r=require('./docs/cwv-baseline-react-mobile.json'); console.log('LCP:', r.audits['largest-contentful-paint']?.numericValue)"
# CLS
node -e "const r=require('./docs/cwv-baseline-react-mobile.json'); console.log('CLS:', r.audits['cumulative-layout-shift']?.numericValue)"
# INP (lab = TBT proxy)
node -e "const r=require('./docs/cwv-baseline-react-mobile.json'); console.log('TBT:', r.audits['total-blocking-time']?.numericValue)"
```

### 2. PerformanceObserver — INP réel pendant scan

Ouvrir la DevTools Console sur la map page et coller :
```js
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (e.duration > 200) console.warn("[INP>200ms]", e.name, Math.round(e.duration) + "ms", e);
  }
}).observe({ type: "event", buffered: true, durationThreshold: 16 });
```

Puis lancer un scan sur `facebook/react` (ou tout repo ~10k stars). Relever :
- Nombre de warnings `[INP>200ms]`
- Durée max observée
- Source des events (nom, target)

### 3. Long-tasks

```js
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    console.warn("[LongTask]", Math.round(e.duration) + "ms", e.attribution);
  }
}).observe({ type: "longtask", buffered: true });
```

### 4. web-vitals (terrain)

Après déploiement, vérifier les logs Vercel (Functions > Logs) :
```
# Filtrer les entrées web_vital
grep '"type":"web_vital"' vercel.log | jq '.'
```

---

## Résultats — Avant Phase 1

*À remplir après mesures.*

### Long-tasks identifiées (scan 10k stars)

| Long-task | Durée (ms) | Source probable |
|---|---|---|
| — | — | — |

### Top INP interactions (> 200ms)

| Interaction | Durée (ms) | Phase |
|---|---|---|
| — | — | — |

---

## Résultats — Après Phase 1

*À remplir après F2 + F3 + F4 + F5.*

| Scénario | LCP p75 | INP p75 | CLS p75 | TTFB | Long-tasks > 50ms | Delta |
|---|---|---|---|---|---|---|
| Landing mobile | — | — | — | — | — | — |
| Scan 10k stars | — | — | — | — | — | **-X%** |

---

## Decision gate Phase 2

Phase 2 (LCP/CLS) **uniquement si** après Phase 1 :
- LCP p75 mobile > 2.5s sur landing OU map page, OU
- CLS p75 > 0.1 sur landing

---

## Résultats — Après Phase 2

*À remplir si Phase 2 exécutée.*

| Scénario | LCP p75 | INP p75 | CLS p75 | Bundle initial (landing) | Date |
|---|---|---|---|---|---|
| Landing mobile | — | — | — | — | — |
| Map page mobile | — | — | — | — | — |

---

## Notes

- INP mesuré en lab via Lighthouse = TBT (proxy, pas identique au vrai INP)
- INP réel = mesurer via PerformanceObserver en prod ou DevTools
- web-vitals installé et actif : `src/components/vitals-reporter.tsx` → `POST /api/vitals`
- Sampling prod : 10% des sessions (configurable dans `vitals-reporter.tsx:17`)
