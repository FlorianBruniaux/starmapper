---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
argument-hint: <file-or-pattern>
metadata:
  author: vercel
  version: "1.0.0"
version: 1.0.0
effort: medium
allowed-tools: [Read, Grep, Glob, WebFetch]
tags: [ui, accessibility, wcag, design-guidelines, review]
---

# Web Interface Guidelines

Review files for compliance with Web Interface Guidelines.

## How It Works

1. Fetch the latest guidelines from the source URL below
2. Read the specified files (or prompt user for files/pattern)
3. Check against all rules in the fetched guidelines
4. Output findings in the terse `file:line` format

## Guidelines Source

Fetch fresh guidelines before each review:

```
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
```

Use WebFetch to retrieve the latest rules. The fetched content contains all the rules and output format instructions.

## StarMapper Patterns (Priority)

**Before applying external guidelines**, check against StarMapper internal patterns:

### Priority Rules (apply systematically)

1. **Icon buttons** : `aria-label` obligatoire sur tout bouton icon-only
   - ✅ `<button aria-label="Close panel"><XIcon aria-hidden="true" /></button>`
   - ❌ `<button><XIcon /></button>`

2. **Icônes décoratives** : toujours `aria-hidden="true"`
   - ✅ `<StarIcon aria-hidden="true" />`

3. **Focus visible** : ne JAMAIS supprimer l'outline Tailwind `focus-visible:ring-*`
   - ❌ `focus:outline-none` interdit sauf si remplacé par focus-visible ring

4. **MapLibre popups** : utiliser `textContent` pour les données user (location, login), jamais `innerHTML` avec des données non sanitisées

5. **Tokens CSS** : toujours utiliser les tokens `@theme` de `globals.css` (voir `design-system.md`)
   - ❌ `bg-[#0d1117]`, `text-[#8b949e]`
   - ✅ `bg-background`, `text-muted`

6. **Touch targets** : minimum 44px sur mobile pour tout élément interactif

### Review Process

1. Apply StarMapper priority rules first (above)
2. Then fetch and apply external guidelines (web-interface-guidelines)
3. Output findings with rule reference when applicable

## Usage

When a user provides a file or pattern argument:
1. Fetch guidelines from the source URL above
2. Read the specified files
3. Apply all rules from the fetched guidelines + StarMapper patterns
4. Output findings using the format specified in the guidelines

If no files specified, ask the user which files to review.
