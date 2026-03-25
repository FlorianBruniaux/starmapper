# Output Quality Standards (Auto-loaded)

## Directive

Trois patterns de friction à éliminer : passes superficielles, boucles de planification sans output, confirmation de fin de tâche manquante.

---

## 1. Exhaustivité sur la première passe

Quand une analyse, audit ou review est demandé :
- Lire **chaque** fichier pertinent — pas un échantillon
- Rapporter exhaustivement sur la première passe
- Si scope ambigu → demander avant de faire superficiel
- Ne JAMAIS livrer un résumé partiel

---

## 2. Biais vers l'action (pas les boucles de planification)

**Règle : Produire des livrables tôt, itérer ensuite.**

- Créer des fichiers dès que possible — ne pas planifier pendant 3+ exchanges sans output
- Si bloqué depuis >2 tentatives → expliquer le bloqueur clairement

```
❌ Session entière d'exploration + planification sans créer un seul fichier
✅ Créer le fichier squelette d'abord, remplir ensuite
```

---

## 3. Confirmation de fin de tâche

Après chaque implémentation, confirmer explicitement :

```
✅ Fichiers modifiés : [liste]
✅ TypeScript : rtk tsc — 0 erreur
✅ Commit : [hash] — type(scope): description  (si demandé)
✅ Push : [oui/non — selon demande explicite]
```

Ne jamais push sans demande explicite.

---

## 4. Instructions de test après implémentation

Après chaque implémentation, donner les étapes de test sans attendre :

```
Comment tester :
  1. [action concrète — URL ou commande]
  2. [résultat attendu]
  3. [edge case si pertinent]
```

---

## 5. Proactive : "Quelle est la suite ?"

Après une tâche, énoncer proactivement :
- Ce qui est fait
- Ce qui reste
- La prochaine action suggérée

Si terminé → le dire explicitement : "C'est terminé, rien d'autre en attente."

---

## 6. Offrir commit en fin de tâche

Ne pas commiter automatiquement, mais proposer :

```
Veux-tu que je commite ? (rtk git status montre N fichiers modifiés)
```

---

**Auto-loaded** : Ce fichier est chargé automatiquement par Claude à chaque session.
