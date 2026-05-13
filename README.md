# VINOM — Tarif Professionnel · Page web interactive

Version V1 — Mockup déployable sur GitHub Pages.

---

## Ce que c'est

Une page web interactive qui affiche les 503 références du tarif VINOM, avec :
- **Recherche en direct** (cuvée, domaine, appellation, région)
- **Filtres cumulables** : couleur, label, format, mise en avant, prix, région
- **Tri** par région, prix, domaine, nouveautés
- **Bouton "Imprimer / PDF"** qui sort le catalogue au même format que le PDF V1 — y compris en respectant les filtres actifs (un commercial peut imprimer une mini-sélection thématique pour un client)
- **Lien partageable avec filtres** : l'URL contient les filtres actifs, on peut envoyer un lien direct vers "Bourgogne BIO sous 20€"
- **Lien vers la page promotions** dans le header
- **Mot de passe partagé** sur page de garde (par défaut : `vinom2026`, à changer dans `app.js`)

---

## Architecture (cible AAA × VINOM)

```
STOCKAGE       : SharePoint VINOM (/Documents partagés/Catalogue/)
DÉPÔT          : Yasmina manuel (V1) → Power Automate (V1.5) → portail (V3)
MOTEUR         : Python AAA local (V1) — script generate_tarif_json.py
SORTIE DATA    : tarif.json (généré depuis TarifVinom_Master.xlsx)
SORTIE PAGE    : GitHub Pages (mockup V1) → SharePoint Pages (cible V2)
```

Cohérent avec l'architecture cadrée pour la page Promotions.

---

## Fichiers livrés

- `index.html` — structure de la page
- `style.css` — styles écran
- `print.css` — styles d'impression (reproduit le PDF V1)
- `app.js` — logique (filtres, recherche, tri, impression, gate)
- `tarif.json` — données (503 références)
- `README.md` — ce fichier

Taille totale : ~370 KB (chargement instantané).

---

## Déploiement sur GitHub Pages

### Première fois (V1 mockup)

1. Créer un repo GitHub : `vinom-tarif`
2. Copier les 5 fichiers (`index.html`, `style.css`, `print.css`, `app.js`, `tarif.json`) à la racine
3. Settings → Pages → Source : Deploy from branch `main` → save
4. URL d'accès : `https://nobullshitdrinks.github.io/vinom-tarif/`
5. Partager le lien avec mot de passe : `https://nobullshitdrinks.github.io/vinom-tarif/?code=vinom2026`

### Mise à jour hebdomadaire

Yasmina met à jour `TarifVinom_Master.xlsx` sur SharePoint.
AAA exécute `generate_tarif_json.py` (à venir, à câbler avec le Master) → produit `tarif.json`.
Push du nouveau `tarif.json` sur GitHub → site mis à jour en 30 secondes.

### Phase V1.5 — Automatisation

Un Power Automate déclenché à chaque modification de `TarifVinom_Master.xlsx` sur SharePoint pourra :
1. Lire le master
2. Appeler un Cloudflare Worker qui régénère `tarif.json`
3. Commit automatique sur GitHub

---

## Mot de passe

Le mot de passe est codé dans `app.js` ligne 7 : `const ACCESS_CODE = 'vinom2026';`
- À changer **annuellement** (`vinom2027` en janvier 2027)
- À communiquer aux vendeurs par email interne
- Les vendeurs peuvent transmettre l'URL `?code=vinom2026` à leurs clients (un seul clic, pas de saisie)

---

## Comment imprimer en PDF

L'utilisateur clique sur "Imprimer / PDF" en haut à droite :
1. Si filtres actifs : seule la sélection filtrée est imprimée, avec mention "Sélection imprimée" sur la couverture
2. Si aucun filtre : impression du catalogue complet (32 pages, identique au PDF V1)
3. Le dialogue d'impression du navigateur s'ouvre : choisir "Enregistrer au format PDF" (option native Chrome/Edge/Firefox)
4. Le PDF est généré en local par le navigateur (aucun appel serveur, aucune attente)

---

## Compatibilité

Testé sur Chromium 130. Fonctionne sur tous les navigateurs modernes (Chrome, Edge, Firefox, Safari).
Responsive : adapté mobile pour consultation en cave ou en service.

---

## Compteurs en temps réel

À côté de chaque chip de filtre, un petit compteur indique combien de références correspondraient à ce filtre, en tenant compte des autres filtres déjà actifs. Quand le compteur passe à 0, le chip reste cliquable mais sans effet.

---

## Évolutions prévues (phase 2+)

- QR Code automatique sur la couverture du PDF imprimé (lien direct vers la promo du mois)
- Bouton "Stock disponible uniquement" (basé sur les 463 références appariées à Vinistoria)
- Migration SharePoint Pages avec authentification M365 native
- Connecteur SharePoint → GitHub Pages via Power Automate
- Page dédiée par référence (avec fiche technique, accord mets-vins, descriptif vigneron)

---

*AAA × VINOM · Mai 2026*
