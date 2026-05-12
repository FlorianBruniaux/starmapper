# Chrome Extension — Publication et maintenance

## Compte développeur Chrome Web Store

Prérequis unique : créer un compte développeur sur [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole) ($5 one-time fee).

---

## Première publication

### 1. Build + zip

```bash
cd extension
npm install
npm run zip
# → .output/starmapper-extension-1.0.0-chrome.zip
```

### 2. Assets requis pour la fiche Store

Le Store demande au minimum :

- 1 screenshot (1280×800 ou 640×400) — la popup en action sur une page GitHub suffit
- Une icône promotionnelle 440×280 (optionnelle mais recommandée)
- Description courte (≤132 chars) + description longue

Suggestion de description courte :
> Map the stargazers of any GitHub repository without leaving GitHub.

### 3. Upload

1. Developer Dashboard → "New item"
2. Upload le `.zip`
3. Remplir : nom, description, catégorie "Developer Tools", screenshots
4. Privacy disclosure : cocher "This extension does not collect user data" (seul `chrome.storage.local` est utilisé, localement)
5. Soumettre

Délai de review Google : 1–3 jours pour la première soumission.

---

## Mise à jour

### Procédure

1. Bumper `version` dans `extension/wxt.config.ts` :
   ```ts
   version: "1.0.1",   // suivre semver : patch pour bugfixes, minor pour nouvelles features
   ```
2. Builder :
   ```bash
   cd extension
   npm run zip
   ```
3. Dashboard → sélectionner l'extension → "Upload new package" → upload le nouveau `.zip` → soumettre

Délai : quelques heures après la première approval (les updates passent plus vite).

### Quand bumper

| Changement | Version |
|---|---|
| Bugfix mineur (injection, bfcache, popup) | `1.0.x` |
| Nouveau bouton, nouvelle page supportée | `1.x.0` |
| Changement de permissions manifest | `1.x.0` — déclenche re-review |

---

## Permissions actuelles (manifest)

```
tabs            — lire l'URL de l'onglet actif (popup : détecter le repo courant)
contextMenus    — menu clic droit sur les liens GitHub
storage         — stocker les repos récents (chrome.storage.local, local uniquement)
host_permissions: https://github.com/*
```

Toute nouvelle permission (ex: `notifications`) déclenche une re-review et demande à l'utilisateur d'accepter.

---

## Roadmap extension

### Prochain : bouton "View profile on StarMapper"

Sur les pages profil GitHub (`github.com/[login]`), injecter un bouton "★ Profile" à côté du bouton "Follow" qui ouvre `starmapper.bruniaux.com/profile/[login]`.

**Changements nécessaires :**
- `wxt.config.ts` : ajouter `"https://github.com/*"` aux `host_permissions` (déjà présent) et élargir le `matches` du content script
- `content.ts` : détecter profil (1 segment de path) vs repo (2 segments), injecter le bon bouton selon le contexte
- Bumper en `1.1.0`

**Sélecteur cible** pour le bouton Follow sur GitHub :

```ts
// Container du bouton Follow sur github.com/[login]
const profileActions = document.querySelector(".js-profile-editable-area")
  ?? document.querySelector('[data-view-component="true"].Layout-sidebar');
```
