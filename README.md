# Planning Ménage — Studios Airbnb

**Version : 4.0.0** — Avril 2026

Application web de planning des interventions ménage pour plusieurs organisations (studios Airbnb), avec authentification par rôle, données isolées par organisation sous Firebase, synchronisation iCal, notifications Telegram et export Excel.

---

## Liens

| Lien | Description |
|------|-------------|
| [Calendrier](https://jonathantesson.github.io/planning-menage/) | Interface principale |
| [Administration](https://jonathantesson.github.io/planning-menage/admin.html) | Back-office (session + rôle admin + org choisie sur le calendrier) |
| [GitHub Actions](https://github.com/JonathanTesson/planning-menage/actions) | Sync automatique + notifications |

---

## Organisations (orgId → libellé)

| orgId   | Libellé affiché   |
|---------|-------------------|
| `tesson` | Studio Tesson    |
| `nade`   | Studio Nade      |

Ces paires sont définies **en dur** dans `index.html`, `admin.html`, `sync-ical.js` et `notify-departs.js`. L’**organisation par défaut** sur l’écran de connexion / premier choix est **`tesson`** ; l’admin peut fixer une autre valeur via **`defaultOrgId`** dans `adminConfig` (liste « Org. par défaut » dans l’admin).

---

## Architecture du projet

```
planning-menage/
├── index.html           → Calendrier principal
├── admin.html           → Back-office administration
├── sync-ical.js         → Sync iCal → Firebase par organisation (cron)
├── notify-departs.js    → Notifications Telegram départs du jour (cron)
├── migrate.js           → Script one-shot : copie racine → /orgs/tesson/ (manuel)
├── .github/workflows/
│   ├── sync-ical.yml
│   └── notify-departs.yml
└── README.md
```

---

## Firebase multi-organisations

Toutes les données « métier » vivent sous **`/orgs/{orgId}/`**. Ancienne racine (`/config`, `/reservations`, …) : **ne pas supprimer** tant que la migration n’est pas validée ; utiliser **`migrate.js`** pour copier vers **`/orgs/tesson/`**.

```
/orgs
  /tesson
    /config        → studioNames, cleaners
    /reservations  → réservations Airbnb
    /assignments   → assignations
    /adminConfig   → comptes, auth, defaultOrgId, …
    /lastSync      → dernière sync iCal
    /activityLog   → journal d’activité
  /nade
    (même structure ; vide au départ si pas encore remplie)
```

### Champ optionnel `sharedWith` (comptes)

Dans **`adminConfig.accounts[]`**, chaque compte peut inclure :

```json
"sharedWith": ["tesson", "nade"]
```

Signification prévue : l’intervenante intervient dans **plusieurs** organisations. **Non utilisé par l’interface actuelle** ; les nouveaux comptes créés depuis l’admin ont `sharedWith: []`. Réservé à une évolution future (pas de bouton « voir mes autres orgs » dans cette version).

---

## Migration depuis la racine

1. Sauvegarder / exporter Firebase si besoin.
2. Avec la variable d’environnement **`FIREBASE_SERVICE_ACCOUNT`** (JSON du compte de service, comme pour les Actions) :
   ```bash
   node migrate.js
   ```
3. Lire le **résumé console** (chaque clé : copié / absent / erreur).
4. Tester l’app en choisissant l’org **tesson** sur le calendrier.
5. **Ne supprimer la racine** (`/config`, `/reservations`, …) qu’après validation manuelle.

---

## Ajouter une nouvelle organisation

1. **Firebase** : créer les nœuds vides ou initiaux sous `/orgs/{nouvelOrgId}/` (même schéma que `tesson`).
2. **Code** : ajouter `{ id: 'nouvelOrgId', label: '…' }` dans **`ORGANIZATIONS`** / listes équivalentes dans :
   - `index.html`
   - `admin.html`
   - `notify-departs.js` (tableau `ORGS`)
   - `sync-ical.js` (tableau `ORG_SYNC` + URLs iCal par flux `studio`)
3. **Admin** : l’option « Org. par défaut » proposera automatiquement le nouvel id si `defaultOrgId` est synchronisé avec la liste.
4. **Comptes** : créer les comptes et mots de passe dans l’admin **de cette org** (données séparées par organisation).

---

## Fonctionnalités

### index.html — Calendrier

**Organisation**
- Premier accès (pas de `menage_org_v1` dans `localStorage`) : écran **Organisation** puis **Continuer**.
- Connexion : liste déroulante **Organisation** en tête, puis prénom / mot de passe.
- Clé locale : **`menage_org_v1`** (id technique : `tesson`, `nade`, …).
- Toutes les lectures / écritures Firebase sont préfixées par **`/orgs/{orgId}/`**.
- Si l’utilisateur change d’organisation sur l’écran de connexion alors que Firebase était déjà initialisé pour une autre org, la page **se recharge** pour rebrancher les bons chemins.

**Authentification** (inchangé par org)
- Toggle dans l’admin de **l’org concernée** ; session **`menage_session_v1`** globale (prénom), combinée à **`menage_org_v1`** pour savoir quelle base lire.
- Badge prénom → lien **admin** uniquement si rôle 👑 (voir section admin : même org en localStorage).

**Calendrier**
- Affichage **S1 / S2** inchangé (noms de studios viennent de `/orgs/{orgId}/config`).

### admin.html — Back-office

- **Sans** `menage_org_v1` valide : **redirection vers `index.html`**.
- Toutes les opérations Firebase sous **`/orgs/{orgId}/`** pour l’org choisie sur le calendrier.
- **Topbar** : nom de l’organisation affiché.
- **Org. par défaut** : enregistré dans **`adminConfig.defaultOrgId`** (pré-sélection sur le login / référence UX).

### sync-ical.js

- Enchaîne les organisations définies dans **`ORG_SYNC`**.
- **tesson** : URLs iCal existantes (2 studios).
- **nade** : tableau **`feeds`** vide avec commentaire **« À compléter »** ; tant qu’il n’y a **aucune** URL, la sync pour cette org est **ignorée** (aucune écriture réservations / lastSync).
- Écrit sous **`/orgs/{orgId}/reservations`** et **`/orgs/{orgId}/lastSync`**.
- Notifications Telegram : préfixe avec le **libellé** de l’organisation.

### notify-departs.js

- Parcourt **`tesson`** puis **`nade`** (liste **`ORGS`**).
- Lit **`/orgs/{orgId}/reservations`**, **`assignments`**, **`config`**.
- Un message Telegram par départ du jour, avec le **libellé org** dans le titre.

---

## Infrastructure technique

### GitHub Actions — Secrets requis

- `FIREBASE_SERVICE_ACCOUNT` : clé JSON compte de service Firebase  
- `TELEGRAM_BOT_TOKEN` : token du bot @TessonLocationbot  

### Telegram

- Bot : @TessonLocationbot  
- Groupe : chat_id `-1002590523626`  

### Sécurité

- Accès restreint au domaine de production (Google Cloud Console) quand configuré.  
- Données sensibles : secrets uniquement côté GitHub Actions ; **`migrate.js`** en local avec la même variable `FIREBASE_SERVICE_ACCOUNT`.

---

## Studios (affichage calendrier)

| | Studio 1 | Studio 2 |
|--|----------|----------|
| Couleur calendrier | Bleu | Vert |

---

## Intervenantes (comptes)

Gérées dans **admin.html** de **chaque organisation**. Structure compte : `name`, `pwdHash`, `menage`, `admin`, et optionnellement **`sharedWith`** (voir plus haut).

---

## Améliorations prévues

1. **Studio 3** / troisième flux iCal par org  
2. **Code d'accès simple** sur index.html  
3. **Sécurisation Firebase** — règles RTDB plus strictes  
4. **Exploitation de `sharedWith`** — UI et agrégation multi-org  
5. **Hub multi-plannings** (enfants, crèche, etc.)  
6. **Application mobile native** — notifications push  

---

## Comment reprendre le développement avec Claude

```
Projet : Planning Ménage Airbnb
Version : 4.0.0
GitHub : https://github.com/JonathanTesson/planning-menage
App : https://jonathantesson.github.io/planning-menage/
Admin : https://jonathantesson.github.io/planning-menage/admin.html
Fichiers : index.html, admin.html, sync-ical.js, notify-departs.js, migrate.js
README : https://github.com/JonathanTesson/planning-menage/blob/main/README.md
```

---

## Historique des versions

### v4.0.0 — Avril 2026
- **Multi-organisations** : données sous `/orgs/{orgId}/` ; orgs `tesson` (défaut) et `nade`
- **localStorage** `menage_org_v1` ; écran organisation + liste org sur la connexion
- **admin.html** : org obligatoire, topbar, `defaultOrgId` pour l’org affichée par défaut à la connexion
- **sync-ical.js** / **notify-departs.js** : boucle par org ; nade sans URL iCal = sync départs ignorée côté iCal
- **migrate.js** : copie one-shot racine → `/orgs/tesson/` sans suppression racine
- Comptes : champ optionnel **`sharedWith`** (non utilisé en UI, documenté)

### v3.2.0 — Avril 2026
- Accès admin via session + rôle 👑 ; lien admin sur le badge prénom

### v3.1.1 — Avril 2026
- Journal d’activité : rotation automatique (450 entrées max)

### v3.1.0 — Avril 2026
- Journal d’activité Firebase

### v3.0.0 — Avril 2026
- Authentification par rôle, admin.html, etc.

### v2.4.0 — Avril 2026
- Export Excel, sync iCal v3, notify départs

### v2.3.0 — Avril 2026
- sync-ical mode fusion 24 mois

### v2.2.0 — Avril 2026
- KPIs, filtres arrivées/départs

### v2.0.0 — Mars 2026
- Firebase + GitHub Actions

### v1.0.0 — Mars 2026
- Calendrier + localStorage + GitHub Pages

---

*Développé avec Claude (Anthropic) — Mars/Avril 2026*
