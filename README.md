# Planning Ménage — Studios Airbnb

**Version : 2.4.0** — Avril 2026

Application web de planning des interventions ménage pour 2 studios Airbnb, avec synchronisation temps réel Firebase et export Excel.

---

## Architecture du projet

```
planning-menage/
├── index.html          → Calendrier principal (femmes de ménage + admin)
├── admin.html          → Back-office (exports Excel, stats, mot de passe)
├── sync-ical.js        → Script Node.js : fetch iCal Airbnb → Firebase
├── .github/
│   └── workflows/
│       └── sync-ical.yml   → GitHub Actions : sync toutes les heures
└── README.md           → Ce fichier
```

---

## Fonctionnalités

### index.html — Calendrier
- Vue mensuelle avec navigation ← Mois →
- **4 KPIs** en haut : départs assignés/total, non assignés restants, prochain départ sans intervenante (toujours calculé depuis aujourd'hui), filtres Arrivées/Départs
- **Filtre par intervenante** avec couleur individuelle
- **Assignation** de 1 ou 2 intervenantes par réservation + note
- **Points de statut** sur les jours de départ : rouge = non assigné, orange = partiel
- Bouton 🔒 → admin.html
- Bouton ⚙ → Paramètres (noms studios, liste intervenantes)
- Synchronisation temps réel Firebase

### admin.html — Back-office
- Accès protégé par mot de passe (optionnel, toggle on/off)
- **Statistiques** du mois sélectionné (← Mois →) : total départs, assignés, non assignés, détail par intervenante
- **Export Excel (.xlsx)** du mois sélectionné avec 2 onglets :
  - Onglet 1 : Détail interventions (date, studio, arrivée, intervenante 1, intervenante 2, note)
  - Onglet 2 : Récap par intervenante (nombre d'interventions, total, période)
- **Historique complet** : export de toutes les réservations passées
- Historique des interventions passées par mois
- Gestion mot de passe admin

---

## Infrastructure technique

### Firebase Realtime Database
Base de données temps réel pour les réservations, assignations et configuration.

Structure des données :
```
/config        → noms studios, liste intervenantes
/reservations  → réservations Airbnb (conservées 24 mois)
/assignments   → assignations intervenantes par réservation
/adminConfig   → configuration back-office
/lastSync      → date et stats de la dernière synchronisation
```

### GitHub Actions
- **Déclencheur** : toutes les heures (cron `0 * * * *`) + manuel
- **Script** : `sync-ical.js` (Node.js 20)
- **Secret requis** : `FIREBASE_SERVICE_ACCOUNT` (clé JSON compte de service Firebase)
- **Mode** : fusion (merge) — les réservations passées sont conservées 24 mois

### URLs iCal Airbnb
- Stockées dans `sync-ical.js` — à ne pas partager publiquement

### Sécurité
- Accès restreint au domaine de production
- Authentification admin gérée côté Firebase
- Aucune donnée sensible dans le code source

---

## Studios

| | Studio 1 | Studio 2 |
|--|----------|----------|
| Couleur calendrier | Bleu | Vert |

*(Studio 3 en perspective — prévoir ajout URL iCal dans sync-ical.js et index.html)*

---

## Intervenantes

| Prénom | Couleur |
|--------|---------|
| Steffie | Bleu #378ADD |
| Emmy | Vert #1D9E75 |
| Valérie | Orange #D85A30 |
| Myrtille | Violet #9F3DBF |
| Pikpik | Ambre #C8860A |

---

## Historique des versions

### v2.4.0 — Avril 2026
- Bouton cadenas 🔒 vers admin.html dans l'en-tête
- Suppression onglet Historique de index.html (déplacé dans admin.html)
- KPI "Prochain départ sans intervenante" figé sur aujourd'hui (indépendant du mois affiché)
- admin.html : sélecteur de mois avec flèches pour stats et export
- Export Excel avec 2 onglets (détail + récap par intervenante)

### v2.3.0 — Avril 2026
- sync-ical.js v2 : mode fusion, conservation 24 mois d'historique
- admin.html : back-office avec stats, export, historique, mot de passe
- Suppression section email (inutile)

### v2.2.0 — Avril 2026
- KPIs : 3 cartes métriques + carte filtre Arrivées/Départs
- Emoji 👥 remplace "Intervenante" dans les filtres
- Filtres indépendants (type et intervenante ne s'interfèrent plus)
- Affichage par défaut : Départs uniquement

### v2.1.0 — Avril 2026
- Points de statut par jour (rouge/orange) sur les jours de départ
- Suppression vues Liste et boutons Mois/Liste
- Roue ⚙ = toggle paramètres
- Légende déplacée en bas du calendrier

### v2.0.0 — Mars 2026
- Réservations stockées dans Firebase (plus de fetch iCal côté client)
- GitHub Actions : sync automatique toutes les heures
- Synchronisation temps réel Firebase pour tous les appareils
- 2 intervenantes par réservation
- Filtres Arrivées/Départs + filtre par intervenante

### v1.0.0 — Mars 2026
- Calendrier mensuel avec réservations Airbnb (2 studios)
- Assignation d'une intervenante par réservation
- Stockage local (localStorage) — non partagé
- Hébergement GitHub Pages

---

## Comment reprendre le développement

### Contexte à donner à Claude dans une nouvelle conversation
```
Projet : Planning Ménage Airbnb
Version actuelle : 2.4.0
GitHub : https://github.com/JonathanTesson/planning-menage
App : https://jonathantesson.github.io/planning-menage/
Fichiers principaux : index.html, admin.html, sync-ical.js
README : https://github.com/JonathanTesson/planning-menage/blob/main/README.md
```

### Pour modifier index.html ou admin.html
1. Modifier sur GitHub (crayon ✏️) ou télécharger, modifier, uploader
2. GitHub Pages se met à jour automatiquement en 1-2 minutes
3. Vider le cache navigateur si nécessaire (Ctrl+Shift+R)

### Pour modifier sync-ical.js
1. Modifier sur GitHub
2. Aller dans Actions → Sync iCal → Run workflow pour tester immédiatement

### Pour ajouter Studio 3
1. `sync-ical.js` : ajouter l'URL iCal dans le tableau `ICAL_URLS`
2. `index.html` : ajouter Studio 3 dans `studioNames`, adapter les couleurs et la légende
3. `admin.html` : rien à modifier (dynamique)

---

## Dépendances externes

| Service | Usage | Gratuit |
|---------|-------|---------|
| GitHub Pages | Hébergement HTML statique | ✅ |
| GitHub Actions | Sync iCal toutes les heures | ✅ (2000 min/mois) |
| Firebase Realtime Database | Stockage temps réel | ✅ (1 Go) |
| allorigins.win | Proxy CORS pour iCal (ancien, plus utilisé) | ✅ |
| SheetJS (xlsx@0.18.5) | Génération fichiers Excel | ✅ |
| Firebase JS SDK 10.12.0 | Client Firebase | ✅ |

---

*Développé avec Claude (Anthropic) — Conversation initiale : mars/avril 2026*
