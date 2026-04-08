# Planning Ménage — Studios Airbnb

**Version : 4.2.0** — Avril 2026

Application web de planning des interventions ménage pour plusieurs organisations (studios Airbnb), avec authentification par rôle, données isolées par organisation sous Firebase, synchronisation iCal, notifications Telegram, **comptes rendus terrain** (heures, commentaire et commande partagés), **export Excel** enrichi et **procédures & préparation studio** (étapes par studio avec photos légères, côté admin).

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
    /adminConfig     → comptes, auth, defaultOrgId, telegramEnabled, …
    /lastSync        → dernière sync iCal
    /activityLog     → journal d’activité
    /cleaningReports → comptes rendus par uid réservation (détail § v4.1 ci-dessous)
    /procedures      → procédures ménage par studio (détail § v4.2 ci-dessous)
  /nade
    (même structure ; remplie selon sync iCal et utilisation)
```

### Champ optionnel `sharedWith` (comptes)

Dans **`adminConfig.accounts[]`**, chaque compte peut inclure :

```json
"sharedWith": ["tesson", "nade"]
```

Signification prévue : l’intervenante intervient dans **plusieurs** organisations. **Non utilisé par l’interface actuelle** ; les nouveaux comptes créés depuis l’admin ont `sharedWith: []`. Réservé à une évolution future (pas de bouton « voir mes autres orgs » dans cette version).

### `/cleaningReports` — comptes rendus terrain (v4.1)

Sous **`/orgs/{orgId}/cleaningReports/{uidRéservation}`** (même `uid` que dans les réservations / assignations) :

| Champ | Rôle |
|--------|------|
| `comment` | Texte **commun** au départ (commentaire) ; visible et modifiable par toutes les intervenantes assignées ; dernière sauvegarde gagne. |
| `order` | Texte **commun** (commande produits / matériel), mêmes règles. |
| `assignSig` | Empreinte JSON de la paire `[intervenante1, intervenante2]` pour invalider les données si l’assignation ne correspond plus. |
| `hours/{Prénom}` | `{ h, m }` — **durée personnelle** ; seule la personne concernée voit et modifie ses heures dans l’app. |

**Comportement** : si une **deuxième** intervenante est ajoutée sur le même départ, les champs communs et les heures des personnes **toujours** assignées sont **conservés** ; seules les heures des personnes **retirées** du départ sont supprimées. Si la réservation disparaît (sync iCal), l’entrée correspondante est purgée côté client. Les **règles Realtime Database** doivent autoriser la lecture/écriture sur ce chemin (comme pour `assignments` / `reservations` selon votre config).

### `/procedures` — préparation studio (v4.2, admin uniquement)

Sous **`/orgs/{orgId}/procedures/{studioIndex}/`** (`studioIndex` : `0`, `1`, … aligné sur les noms de studios dans `config`) :

| Emplacement | Rôle |
|-------------|------|
| `steps/{stepId}` | Objet étape : `id`, `order`, `shortDesc`, `longDesc`, `photoUrl` (URL Firebase Storage après upload). |

**Firebase Storage** (SDK modulaire v10 dans `admin.html`) : fichiers JPEG **`orgs/{orgId}/procedures/{studioIndex}/{stepId}.jpg`**. Compression navigateur avant envoi (largeur max **640 px**, qualité **~0,48**).

**Interface admin** : la zone procédures s’ouvre via le menu latéral (burger), entrée **Procédure** (libellé court ; le titre de page reste « Procédures & préparation studio »). Pas d’onglets en tête de page. Hashes d’URL possibles : **`#procedures`**, **`#procedures-section`** (ancien lien). À la fermeture du menu, le focus repasse sur le burger (accessibilité). Voir § **admin.html** ci-dessous pour le détail des cinq vues.

**Affichage côté calendrier** (`index.html`) : non prévu dans cette version ; réservé à une évolution ultérieure.

**Règles** : l’app utilise une auth « maison » (pas Firebase Auth côté client) ; les règles RTDB / Storage doivent rester cohérentes avec ce modèle (voir commentaire en tête du script dans `admin.html`).

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
- Badge en-tête : **lien** vers **`admin.html`** si rôle 👑 ou mode sans auth (**Admin**) ; **bouton** « Mon compte » (modale mot de passe) si compte ménage sans rôle admin. Pour tester **`admin.html`** en local, le serveur statique doit rester actif (ex. `python -m http.server 5173`) : le calendrier peut sembler vivant via Firebase alors qu’une navigation vers une autre page locale échoue si le serveur est arrêté.

**Calendrier**
- Affichage **S1 / S2** inchangé (noms de studios viennent de `/orgs/{orgId}/config`).
- **Comptes rendus (rôle ménage, départ où l’on est assignée)** : modale **Mon intervention** — durée personnelle (heures + minutes), champs **communs** commande / commentaire (libellés et placeholders dans l’UI), enregistrement dans **`cleaningReports`** ; croix de fermeture en haut à droite ; fermeture automatique après **Enregistrer**.
- **Badge** du prénom sous le départ : **contour noir** si des heures ont été enregistrées pour cette personne sur ce départ.

### admin.html — Back-office

- **Sans** `menage_org_v1` valide : **redirection vers `index.html`**.
- Toutes les opérations Firebase sous **`/orgs/{orgId}/`** pour l’org choisie sur le calendrier.
- **Topbar** : titre **Administration** et **nom de l’organisation** uniquement (sans suffixe « Planning Ménage ») ; **menu burger** à gauche ; retour **focus** sur le burger à la fermeture du tiroir (accessibilité).
- **Navigation latérale** (ordre du haut vers le bas) — une **vue pleine page** par entrée, sans sous-menus :
  1. **Dashboard** — statistiques du mois, **export Excel** (aperçu optionnel), **historique des interventions**, bouton **Se déconnecter**.
  2. **Procédure** — **Procédures & préparation studio** (étapes par studio, photos Storage + texte RTDB), voir § `/procedures` ci-dessus.
  3. **Comptes** — authentification, **Org. par défaut**, Telegram, liste des comptes, **journal d’activité**.
  4. **Organisation** — **Studios** (noms affichés S1 / S2 sur le calendrier).
  5. **Légende** — **Légende & synchronisation** (points du calendrier, rôles 🧹 / 👑, sync, version affichée en bas).
- **Hashes d’URL** (optionnels) : **`#dashboard`** (équivalent page d’accueil admin), **`#procedures`**, **`#comptes`**, **`#organisation`**, **`#legend`** ; **`#general`** est encore accepté et équivalent à **`#dashboard`** ; sans hash, la vue par défaut est le **Dashboard**.
- Rubrique **Comptes** : une ligne par réglage — **authentification** et **Notifications Telegram** sont des **cases à cocher** (même style), avec texte d’aide ; **Org. par défaut** avec liste déroulante dessous. **`telegramEnabled`** dans **`adminConfig`** : si désactivé pour une org, **`sync-ical.js`** et **`notify-departs.js`** n’envoient **pas** de messages Telegram pour cette org (Firebase reste mis à jour pour la sync iCal).
- La signification des icônes **🧹** (ménage) et **👑** (admin) est rappelée dans la vue **Légende** (texte du type « Comptes (rubrique Comptes du menu) » pour renvoyer vers la bonne vue).
- **Org. par défaut** : enregistré dans **`adminConfig.defaultOrgId`** (pré-sélection sur le login).
- **Historique des interventions** : tableau avec date courte **jj/mm/aa**, studio **S1** / **S2**, intervenantes, et colonne **Heures** (somme des durées saisies pour la ligne, vide si aucune) ; mise à jour si **`cleaningReports`** change.
- **Export Excel** — feuille **Détail interventions** : colonnes dans l’ordre **Date départ**, **Studio**, **Intervenante 1**, **Intervenante 2**, **Intervenante 1 durée**, **Intervenante 2 durée**, **Commande**, **Commentaire** (durées au format Excel `[h]:mm`). Feuille **Récap par intervenante** : colonne **Total heures** (somme sur la période exportée, même format).

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
- Penser à inclure **`/orgs/{orgId}/cleaningReports`** dans les **règles Realtime Database** si elles ne sont pas déjà couvertes par une règle large (sinon les comptes rendus ne s’enregistrent pas).
- **Firebase Storage** : activer le bucket et autoriser le chemin **`orgs/{orgId}/procedures/...`** si vous utilisez les photos de procédures (voir commentaire dans `admin.html`).

---

## Studios (affichage calendrier)

Les **libellés** Studio 1 / Studio 2 sont modifiables dans **admin.html** → vue **Organisation** (enregistrés dans **`/orgs/{orgId}/config`**).

| | Studio 1 | Studio 2 |
|--|----------|----------|
| Couleur calendrier | Bleu | Vert |

---

## Intervenantes (comptes)

Gérées dans **admin.html** → vue **Comptes** de **chaque organisation**. Structure compte : `name`, `pwdHash`, `menage`, `admin`, et optionnellement **`sharedWith`** (voir plus haut).

---

## Améliorations prévues

1. **Studio 3** / troisième flux iCal par org  
2. **Code d'accès simple** sur index.html  
3. **Sécurisation Firebase** — règles RTDB plus strictes  
4. **Exploitation de `sharedWith`** — UI et agrégation multi-org  
5. **Consultation des procédures** depuis le calendrier (`index.html`)  
6. **Hub multi-plannings** (enfants, crèche, etc.)  
7. **Application mobile native** — notifications push  

---

## Comment reprendre le développement avec Claude

```
Projet : Planning Ménage Airbnb
Version : 4.2.0
GitHub : https://github.com/JonathanTesson/planning-menage
App : https://jonathantesson.github.io/planning-menage/
Admin : https://jonathantesson.github.io/planning-menage/admin.html
Fichiers : index.html, admin.html, sync-ical.js, notify-departs.js, migrate.js, .gitignore
README : https://github.com/JonathanTesson/planning-menage/blob/main/README.md
```

---

## Historique des versions

### v4.2.0 — Avril 2026
- **Admin — Procédures & préparation studio** : étapes par studio (`/orgs/{orgId}/procedures/...`), photos JPEG dans Storage (`orgs/{orgId}/procedures/{studioIndex}/{stepId}.jpg`), compression côté navigateur (max 640 px, qualité ~0,48) ; réordonnancement (glisser-déposer desktop ≥768px, flèches mobile) ; enregistrement au blur / après upload
- **Admin — Navigation** : menu burger avec **cinq vues** — **Dashboard** (stats, exports, historique, déconnexion), **Procédure**, **Comptes** (réglages + journal d’activité), **Organisation** (noms des studios), **Légende** (aide + sync + version) ; ordre des entrées du haut vers le bas comme ci-dessus ; libellé court **Procédure** dans le menu ; topbar sans « Planning Ménage » ; hashes **`#dashboard`**, **`#procedures`**, **`#comptes`**, **`#organisation`**, **`#legend`** (et **`#general`** → dashboard) ; focus renvoyé sur le burger à la fermeture du tiroir
- **Index** : badge admin = lien `admin.html` ; compte non-admin = bouton ouvrant la modale « Mon compte »
- **Versions affichées** : `APP_VERSION` **4.2.0** dans `index.html` et `admin.html` (aligner avec ce README à chaque release)

### v4.1.0 — Avril 2026
- **Comptes rendus terrain** (`cleaningReports`) : durées par intervenante, commentaire et commande **communs** ; conservation des données lors de l’ajout d’une 2ᵉ intervenante ; purge si plus aucune assignation ou si la réservation disparaît
- **Calendrier** : contour sur le badge prénom lorsque des heures sont renseignées ; modale ménage (ordre des sections, croix fermeture, fermeture après enregistrement) ; correctif `onclick` + JSON pour **M’assigner** / sauvegarde
- **Admin** : historique avec date **jj/mm/aa**, studio **S1/S2**, colonne **Heures** (total ligne) ; export Excel détail réordonné et sans colonnes Arrivée / Note ; récap avec **Total heures** par intervenante
- **Version affichée** : `APP_VERSION` **4.1.0** dans `index.html` et `admin.html` (aligner avec ce README à chaque release)

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
