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
├── .gitignore           → Ignore les JSON de compte de service dans Firebase/ (local)
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
    /adminConfig   → comptes, auth, defaultOrgId, telegramEnabled, …
    /lastSync      → dernière sync iCal
    /activityLog   → journal d’activité
  /nade
    (même structure ; remplie selon sync iCal et utilisation)
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
- Si l’utilisateur change d’organisation sur l’écran de connexion, la page **se recharge** après mise à jour du stockage, pour rebrancher Firebase sur la bonne org (évite liste de prénoms / données d’une autre org). Pendant ce reload, un écran plein **« Changement d’organisation »** (sessionStorage `menage_org_change_gate`) évite l’éclair du calendrier ; **`#main-app`** reste masqué dans le HTML jusqu’à **`showApp()`**.
- Écran login : libellé **Nom** au-dessus du menu déroulant des prénoms ; première option affichée **`-`** (`value` vide).
- **Aucun compte** dans `adminConfig` pour cette org : écran **Organisation non configurée** avec liens vers **`admin.html`** et bouton **Changer d’organisation** (efface `menage_org_v1` + recharge). Le chargement attend aussi **`adminConfig`** avant de décider auth / écran.
- **Auth désactivée** (`authEnabled: false`) : badge **Admin** (lien **`admin.html`**) et bouton **Accueil** (efface `menage_org_v1` + `menage_session_v1` + recharge) pour revenir au choix d’organisation ; le bouton **Déco.** reste masqué en mode ouvert.

**Authentification** (par org)
- Case à cocher **« Activer l’authentification »** dans l’admin de **l’org concernée** ; session **`menage_session_v1`** globale (prénom), combinée à **`menage_org_v1`** pour savoir quelle base lire.
- Badge prénom → lien **admin** si rôle 👑 ; en mode sans auth, le badge affiche **Admin** avec le même lien (même org en localStorage).

**Calendrier**
- Affichage **S1 / S2** inchangé (noms de studios viennent de `/orgs/{orgId}/config`).

### admin.html — Back-office

- **Sans** `menage_org_v1` valide : **redirection vers `index.html`**.
- Toutes les opérations Firebase sous **`/orgs/{orgId}/`** pour l’org choisie sur le calendrier.
- **Topbar** : nom de l’organisation affiché.
- Section **Comptes** : une ligne par réglage — **authentification** et **Notifications Telegram** sont des **cases à cocher** (même style), avec texte d’aide ; **Org. par défaut** avec liste déroulante dessous. **`telegramEnabled`** dans **`adminConfig`** : si désactivé pour une org, **`sync-ical.js`** et **`notify-departs.js`** n’envoient **pas** de messages Telegram pour cette org (Firebase reste mis à jour pour la sync iCal).
- La signification des icônes **🧹** (ménage) et **👑** (admin) sur chaque ligne de compte est rappelée dans la section **Légende & synchronisation** (plus sous la liste des comptes).
- **Org. par défaut** : enregistré dans **`adminConfig.defaultOrgId`** (pré-sélection sur le login).

### sync-ical.js

- Enchaîne les organisations définies dans **`ORG_SYNC`**.
- **tesson** et **nade** : deux flux iCal (studio 0 et 1) chacun lorsque les URLs sont renseignées dans **`feeds`**.
- Si une org n’a **aucune** URL dans **`feeds`**, la sync pour cette org est **ignorée** (aucune écriture réservations / lastSync pour elle).
- Écrit sous **`/orgs/{orgId}/reservations`** et **`/orgs/{orgId}/lastSync`**.
- Notifications Telegram : préfixe avec le **libellé** de l’organisation ; **désactivables par org** via **`adminConfig.telegramEnabled`** (défaut : activé si absent).

### notify-departs.js

- Parcourt **`tesson`** puis **`nade`** (liste **`ORGS`**).
- Lit **`/orgs/{orgId}/reservations`**, **`assignments`**, **`config`**, **`adminConfig`** (pour **`telegramEnabled`**).
- Un message Telegram par départ du jour, avec le **libellé org** dans le titre (sauf si Telegram est désactivé pour cette org).

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
Fichiers : index.html, admin.html, sync-ical.js, notify-departs.js, migrate.js, .gitignore
README : https://github.com/JonathanTesson/planning-menage/blob/main/README.md
```

---

## Historique des versions

### v4.0.0 — Avril 2026
- **Multi-organisations** : données sous `/orgs/{orgId}/` ; orgs `tesson` (défaut) et `nade`
- **localStorage** `menage_org_v1` ; écran organisation + liste org sur la connexion ; rechargement si changement d’org au login
- **Org sans comptes** : écran dédié + accès admin pour configuration ; attente **`adminConfig`** avant routage
- **Mode sans auth** : badge **Admin** (lien admin), bouton **Accueil** (retour choix d’organisation)
- **Changement d’org au login** : écran **Changement d’organisation** + calendrier masqué par défaut jusqu’à affichage
- **admin.html** : org obligatoire, topbar ; cases à cocher auth + Telegram, **`telegramEnabled`** ; légende 🧹/👑 dans **Légende & synchronisation**
- **sync-ical.js** / **notify-departs.js** : boucle par org ; org sans URL iCal = sync iCal ignorée pour cette org ; respect de **`telegramEnabled`**
- **migrate.js** : copie one-shot racine → `/orgs/tesson/` sans suppression racine
- **.gitignore** : ne pas versionner les JSON de compte de service dans `Firebase/`
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
