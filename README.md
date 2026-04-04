# Planning Ménage — Studios Airbnb

**Version : 3.1.0** — Avril 2026

Application web de planning des interventions ménage pour 2 studios Airbnb, avec authentification par rôle, synchronisation temps réel Firebase, notifications Telegram et export Excel.

---

## Liens

| Lien | Description |
|------|-------------|
| [Calendrier](https://jonathantesson.github.io/planning-menage/) | Interface principale |
| [Administration](https://jonathantesson.github.io/planning-menage/admin.html) | Back-office (accès protégé) |
| [GitHub Actions](https://github.com/JonathanTesson/planning-menage/actions) | Sync automatique + notifications |

---

## Architecture du projet

```
planning-menage/
├── index.html           → Calendrier principal
├── admin.html           → Back-office administration
├── sync-ical.js         → Sync iCal Airbnb → Firebase (toutes les heures)
├── notify-departs.js    → Notifications Telegram départs du jour (10h00)
├── .github/workflows/
│   ├── sync-ical.yml        → Cron toutes les heures
│   └── notify-departs.yml   → Cron tous les jours à 10h (8h UTC)
└── README.md
```

---

## Fonctionnalités

### index.html — Calendrier

**Authentification**
- Toggle global dans admin.html : activée ou désactivée
- Si désactivée : accès direct, tout le monde est admin
- Si activée : écran de connexion (nom + mot de passe)
- Session stockée en localStorage (pas besoin de se reconnecter)
- Bouton "Déco." visible quand connecté
- Si l’auth est activée : chaque **connexion** et **déconnexion** est enregistrée dans le journal Firebase (visible dans l’admin)

**Rôles**
- 🧹 Ménage : voit le calendrier, voit tous les noms assignés, peut s'assigner/se retirer sur les départs uniquement (pas sur les arrivées)
- 👑 Admin : voit tout, assigne n'importe qui, accès au 🔒 back-office
- Les deux rôles sont cumulables

**Calendrier**
- Vue mensuelle navigation ← Auj. →
- Filtre 👥 par intervenante (visible par tous les rôles)
- Blocs bleu = arrivée Studio 1, vert = arrivée Studio 2, orange = départ
- Points de statut sur les jours de départ : 🔴 non assigné, 🟠 partiel, rien = tout assigné
- Arrivées cliquables uniquement pour les admins

**4 KPIs en haut**
- Départs assignés/total du mois affiché
- Non assignés restants
- Prochain départ sans intervenante (toujours calculé depuis aujourd'hui, tous mois confondus)
- Filtre Arrivées/Départs (par défaut : Départs uniquement)

**Assignation**
- Admin : 2 intervenantes par réservation + note
- Ménage : bouton "+" pour s'assigner, "✕ Me retirer" pour se retirer
- Chaque changement d’assignation est **journalisé** (qui, studio, date de départ, avant/après pour l’admin)

### admin.html — Back-office

Accès protégé par mot de passe admin (indépendant de l'auth utilisateurs).

**Statistiques**
- Sélecteur de mois ← Avril →
- Total départs, assignés, non assignés
- Détail par intervenante avec couleur

**Export Excel**
- Sélection du mois → fichier .xlsx avec 2 onglets :
  - Détail interventions (date, studio, arrivée, intervenante 1, intervenante 2, note)
  - Récap par intervenante (nombre d'interventions, total, période)
- Historique complet (tous les mois passés)

**Gestion des comptes**
- Toggle "Activer authentification" global
- Chaque compte : prénom + mot de passe + rôle 🧹 et/ou 👑
- Ajout/suppression/modification des comptes
- Les comptes 🧹 apparaissent automatiquement dans les listes du calendrier

**Studios**
- Renommer Studio 1 et Studio 2

**Sécurité admin**
- Mot de passe séparé pour accéder à admin.html
- Toggle pour activer/désactiver la protection

**Historique**
- Liste des interventions passées par mois
- Conservé 24 mois dans Firebase

**Journal d’activité**
- Tableau en bas de page : date, type d’événement, auteur, détail lisible
- Événements enregistrés : connexions / déconnexions au planning (auth activée), assignations et retraits (ménage), modifications d’assignation par un admin, ouverture de l’admin avec mot de passe, ajout/suppression de compte, changement du mot de passe admin
- Affichage des **200 derniers** événements ; bouton **Vider le journal** pour tout effacer dans Firebase
- **Pas d’historique rétroactif** : seules les actions faites après la mise en place de cette fonction apparaissent
- En mode **sans authentification** sur le calendrier, les lignes d’assignation admin indiquent « Mode ouvert » ; les connexions ne sont pas journalisées (pas de compte identifiable)

**Légende & Sync**
- Explication des points de couleur
- Date de dernière synchronisation Airbnb

### sync-ical.js — Synchronisation iCal

- Tourne toutes les heures via GitHub Actions
- Récupère les iCal Airbnb des 2 studios
- **Mode fusion** : conserve les réservations passées 24 mois (ne les écrase pas)
- Détecte les **nouvelles réservations** → notification Telegram
- Détecte les **annulations** → notification Telegram avec nom(s) de l'intervenante prévue

### notify-departs.js — Notifications départs

- Tourne tous les jours à 10h (8h UTC = 10h heure française été)
- Vérifie s'il y a des départs aujourd'hui dans Firebase
- Envoie un message Telegram par départ :
  - Studio concerné
  - Prochaine arrivée (dans X jours)
  - Intervenante(s) assignée(s)
  - Note éventuelle
  - ⚠️ Si aucune intervenante assignée

---

## Infrastructure technique

### Firebase Realtime Database
Structure des données :
```
/config
  studioNames: ["Studio 1", "Studio 2"]
  cleaners: ["Steffie", "Emmy", ...]   ← sync auto depuis adminConfig

/reservations
  {uid}: { uid, summary, start, end, studio }

/assignments
  {uid}: { c1, c2, note }

/adminConfig
  authEnabled: false
  accounts: [{ name, pwdHash, menage, admin }]
  pwdEnabled: false
  pwdHash: "..."

/lastSync
  ts: "2026-04-03T..."
  count: 116
  notifications: 0

/activityLog
  {pushId}: { ts, type, actor, text, uid? }   ← journal append-only (push), affiché dans admin.html
```

### GitHub Actions — Secrets requis
- `FIREBASE_SERVICE_ACCOUNT` : clé JSON compte de service Firebase
- `TELEGRAM_BOT_TOKEN` : token du bot @TessonLocationbot

### Telegram
- Bot : @TessonLocationbot
- Groupe : chat_id `-1002590523626`
- 2 types de notifications : nouvelles réservations/annulations (sync-ical.js) + départs du jour (notify-departs.js)

### Sécurité
- Accès restreint au domaine de production (Google Cloud Console)
- Authentification admin gérée dans Firebase
- Tokens et clés dans GitHub Secrets uniquement

---

## Studios

| | Studio 1 | Studio 2 |
|--|----------|----------|
| Couleur calendrier | Bleu | Vert |

*(Studio 3 en perspective — ajouter URL iCal dans sync-ical.js + adapter index.html)*

---

## Intervenantes (comptes)

Gérés dans admin.html → section Comptes. Les rôles et mots de passe sont stockés dans Firebase.

---

## Améliorations prévues

1. **Studio 3** — quand l'URL iCal sera disponible (10 min)
2. **Code d'accès simple** sur index.html pour sécuriser même sans auth complète
3. **Sécurisation Firebase** — règles plus strictes (actuellement ouvert, protégé par restriction de domaine)
4. **Multi-onglets** — page d'accueil avec navigation vers d'autres modules (planning enfants, crèche, périscolaire...)
5. **Application mobile native** — pour notifications push (chantier important)

---

## Comment reprendre le développement avec Claude

Colle ce bloc au début d'une nouvelle conversation :

```
Projet : Planning Ménage Airbnb
Version : 3.1.0
GitHub : https://github.com/JonathanTesson/planning-menage
App : https://jonathantesson.github.io/planning-menage/
Admin : https://jonathantesson.github.io/planning-menage/admin.html
Fichiers : index.html, admin.html, sync-ical.js, notify-departs.js
README : https://github.com/JonathanTesson/planning-menage/blob/main/README.md
```

Claude peut lire le README directement depuis GitHub pour reprendre le contexte complet.

---

## Historique des versions

### v3.1.0 — Avril 2026
- Journal d’activité Firebase (`/activityLog`) : connexions, assignations, accès admin, gestion des comptes
- Section **Journal d’activité** dans admin.html (200 derniers événements, vider le journal)

### v3.0.0 — Avril 2026
- Authentification par rôle (🧹 ménage / 👑 admin)
- Session localStorage (pas de reconnexion à chaque page)
- Vue ménage : voit tous les noms, s'assigne uniquement sur les départs
- Gestion des comptes dans admin.html (remplace les paramètres de index.html)
- Studios déplacés dans admin.html
- Bouton ⚙ supprimé de index.html, légende/sync dans admin.html
- Filtre intervenantes visible par tous les rôles

### v2.4.0 — Avril 2026
- Bouton 🔒 vers admin.html dans l'en-tête
- KPI "Prochain départ" figé sur aujourd'hui
- Export Excel avec 2 onglets (détail + récap)
- Sélecteur de mois avec flèches dans admin.html
- sync-ical.js v3 : notifications Telegram nouvelles réservations et annulations
- notify-departs.js : notifications Telegram départs du jour à 10h

### v2.3.0 — Avril 2026
- sync-ical.js v2 : mode fusion, conservation 24 mois
- admin.html : back-office avec stats, export, historique, mot de passe

### v2.2.0 — Avril 2026
- KPIs : 3 cartes métriques + carte filtre Arrivées/Départs
- Points de statut rouge/orange sur les jours de départ
- Filtre par défaut : Départs uniquement

### v2.0.0 — Mars 2026
- Réservations stockées dans Firebase
- GitHub Actions : sync automatique toutes les heures
- Synchronisation temps réel Firebase
- 2 intervenantes par réservation

### v1.0.0 — Mars 2026
- Calendrier mensuel avec réservations Airbnb
- Stockage local (localStorage)
- Hébergement GitHub Pages

---

*Développé avec Claude (Anthropic) — Mars/Avril 2026*
