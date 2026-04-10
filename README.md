# Planning Ménage — Studios Airbnb

**Version : 4.5.0** — Avril 2026

Application web de planning des interventions ménage pour plusieurs organisations (studios Airbnb), avec authentification par rôle, données isolées par organisation sous Firebase, synchronisation iCal, notifications Telegram, **comptes rendus terrain** (heures, commentaire et commande partagés), **export Excel** enrichi, **procédures & préparation studio** (étapes par studio avec photos légères), **consultation procédure côté calendrier** pour les intervenantes assignées (onglet dédié, coches par départ, notes persistantes, suggestions) et **validation des suggestions** dans l’admin. **Note d’assignation** côté calendrier (**`note`** + traçage **`noteBy`**, indicateur **📝** sur les départs, lecture seule pour les ménagères) — détail § **`/assignments`** et § **index.html** ci-dessous. **v4.5.0** : **indisponibilités** — saisie sur **`compte.html`**, pastilles + filtre **Indispo** sur **`index.html`**, clés **`YYYY-MM-DD` en date locale** ; la **purge automatique** compare les mêmes clés au **seuil UTC** (voir § **`/unavailability`**).

---

## Liens

| Lien | Description |
|------|-------------|
| [Calendrier](https://jonathantesson.github.io/planning-menage/) | Interface principale |
| [Administration](https://jonathantesson.github.io/planning-menage/admin.html) | Back-office (session + rôle admin + org choisie sur le calendrier) |
| [Mon compte](https://jonathantesson.github.io/planning-menage/compte.html) | Espace intervenante (session ménagère, hors admin) — lien depuis le prénom sur le calendrier |
| [GitHub Actions](https://github.com/JonathanTesson/planning-menage/actions) | Sync iCal, notifications, purge indisponibilités |

---

## Organisations (orgId → libellé)

| orgId   | Libellé affiché   |
|---------|-------------------|
| `tesson` | Studio Tesson    |
| `nade`   | Studio Nade      |

Ces paires sont définies **en dur** dans `index.html`, `admin.html`, `compte.html`, `sync-ical.js`, `notify-departs.js` et `purge-unavailability.js`. L’**organisation par défaut** sur l’écran de connexion / premier choix est **`tesson`** ; l’admin peut fixer une autre valeur via **`defaultOrgId`** dans `adminConfig` (liste « Org. par défaut » dans l’admin).

---

## Architecture du projet

```
planning-menage/
├── index.html           → Calendrier principal
├── admin.html           → Back-office administration
├── compte.html          → Tableau de bord + compte (intervenantes, hors admin)
├── storage-cors.example.json → Exemple CORS bucket Storage (optionnel, si uploads / SDK bloqués en local)
├── sync-ical.js         → Sync iCal → Firebase par organisation (cron)
├── notify-departs.js    → Notifications Telegram départs du jour (cron)
├── purge-unavailability.js → Supprime indisponibilités > 3 ans (UTC) sous /unavailability/ (cron mensuel)
├── migrate.js           → Script one-shot : copie racine → /orgs/tesson/ (manuel)
├── .gitignore           → Ignore les JSON de compte de service dans Firebase/ (local)
├── .github/workflows/
│   ├── sync-ical.yml
│   ├── notify-departs.yml
│   └── purge-unavailability.yml
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
    /cleaningReports → comptes rendus par uid réservation (détail § v4.1 + v4.3 ci-dessous)
    /procedures      → procédures ménage par studio (détail § v4.2 + v4.3 ci-dessous)
    /procedureSuggestions → suggestions d’étapes en attente de validation (v4.3)
    /unavailability     → indisponibilités par prénom (v4.5.0 — UI calendrier + compte)
  /nade
    (même structure ; remplie selon sync iCal et utilisation)
```

### `/unavailability` — indisponibilités (**v4.5.0**)

```
/orgs/{orgId}/unavailability/{prenom}/dates/{YYYY-MM-DD} → true
```

- **Absent** = disponible : pas de valeur **`false`** en base ; pour annuler une indispo, le nœud date est **supprimé** (`remove`).
- **Saisie (app)** : les clés **`YYYY-MM-DD`** sont celles du **calendrier local** du navigateur (même convention que le reste du planning : jour civil local). **`compte.html`** limite la navigation mois à **± 3 ans** autour du mois courant (local) ; les **jours passés** sont en lecture seule sur le mini-calendrier.
- **Affichage (`index.html`)** : listener sur **`/orgs/{orgId}/unavailability/`** ; les données sont **normalisées** en mémoire en montant d’un niveau **`dates`** :  
  `S.unavailability = { 'Emmy': { '2026-05-03': true }, … }`.  
  Les pastilles ne concernent que les comptes **`adminConfig.accounts.filter(a => a.menage)`** (pas les clés orphelines Firebase).
- **Purge (`purge-unavailability.js`)** : compare chaque clé **`YYYY-MM-DD`** au seuil **aujourd’hui UTC − 3 ans** (chaînes **`YYYY-MM-DD`** comparées lexicographiquement). C’est **volontairement UTC** côté cron, alors que la **saisie** est **locale** : en pratique les écarts de fuseau n’affectent que les entrées proches de la frontière des 3 ans ; documenté ici pour éviter toute confusion.
- Si le nœud **`unavailability`** est **absent** pour une org, le script de purge **ignore** silencieusement cette org ; l’UI fonctionne avec un objet vide.

### `/assignments` — note d’assignation (**v4.3.4**)

Sous **`/orgs/{orgId}/assignments/{uidRéservation}`**, l’objet d’assignation comporte en pratique **`c1`**, **`c2`** (ou format historique : valeur chaîne unique pour une seule intervenante), **`note`** (texte libre, ex. consigne clé) et, depuis la v4.3.4, **`noteBy`** :

| Champ | Rôle |
|--------|------|
| `note` | Saisie dans la modale **Assigner les intervenantes** sur **`index.html`** (comptes admin ou mode sans auth). |
| `noteBy` | Renseigné **uniquement** si `note` est non vide après trim : prénom ou libellé d’acteur au moment de l’enregistrement (**`assignActorLabel()`** — admin connecté, ou **« Mode ouvert »** sans auth). Si la note est vide : **`noteBy: null`** (efface un ancien auteur). **Données existantes** sans `noteBy` : l’UI affiche **« l’administration »** comme source de la note. Lors d’un **M’assigner** / **Me retirer**, **`noteBy`** est **conservé** si présent (la note n’est pas modifiée par les ménagères). |

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
| `stepFeedback/{stepId}/checked` | **v4.3** — booléen ; coches **« Fait »** sur la procédure pour ce départ, **partagées** entre les deux intervenantes assignées (temps réel). Conservé lors des changements d’assignation (comme les heures restent filtrées par prénom). |

**Comportement** : si une **deuxième** intervenante est ajoutée sur le même départ, les champs communs, les **stepFeedback** et les heures des personnes **toujours** assignées sont **conservés** ; seules les heures des personnes **retirées** du départ sont supprimées. Si la réservation disparaît (sync iCal), l’entrée correspondante est purgée côté client (**stepFeedback** inclus). Les **règles Realtime Database** doivent autoriser la lecture/écriture sur ce chemin (comme pour `assignments` / `reservations` selon votre config).

### `/procedures` — préparation studio (v4.2, édition admin ; consultation & notes v4.3)

Sous **`/orgs/{orgId}/procedures/{studioIndex}/`** (`studioIndex` : `0`, `1`, … aligné sur les noms de studios dans `config`) :

| Emplacement | Rôle |
|-------------|------|
| `steps/{stepId}` | Objet étape : `id`, `order`, `shortDesc`, `longDesc`, `photoUrl` (URL Firebase Storage après upload). |
| `steps/{stepId}/ratings/{Prénom}` | **v4.3** — entier **1**, **2** ou **3** : note personnelle et **persistante** par intervenante (survit à la fin de la réservation). Moyenne affichée dans l’admin (demi-étoiles, arrondi `Math.round(avg*2)/2`). |

**Firebase Storage** (SDK modulaire v10 dans `admin.html` et **index.html** pour les suggestions) : fichiers JPEG **`orgs/{orgId}/procedures/{studioIndex}/{stepId}.jpg`**. Compression navigateur avant envoi (largeur max **640 px**, qualité **~0,48**).

**Interface admin** : la zone procédures s’ouvre via le menu latéral (burger), entrée **Procédure** (libellé court ; le titre de page reste « Procédures & préparation studio »). Pas d’onglets en tête de page. Hashes d’URL possibles : **`#procedures`**, **`#procedures-section`** (ancien lien). À la fermeture du menu, le focus repasse sur le burger (accessibilité). Voir § **admin.html** ci-dessous pour le détail des cinq vues.

**Comportement UI (procédures)** :
- **Nouvelle étape** (`+ Ajouter une étape`) : insérée **en haut** de la liste du studio (les plus récentes en premier dans l’affichage).
- **Ordre** : boutons **▲ / ▼** sur **tous** les écrans (pas de glisser-déposer).
- **Photo** : une seule zone cliquable (aperçu ou icône dans le cadre) ; remplacement avec **modale intégrée** (pas de `window.confirm` du navigateur).
- **Copier** : duplique **description courte et détails** vers un autre studio ; **pas de photo** (`photoUrl` vide) — la modale l’indique et le toast de succès le rappelle (**v4.3.2**) ; ajouter une image sur la nouvelle étape au besoin. Le menu **Studio** reste sur le studio en cours d’édition.
- **Remplacer la photo** : enregistrement sur le chemin `…/procedures/{studio}/{stepId}.jpg` de l’étape concernée.
- **Suppression** : modale intégrée ; retrait de l’étape en base (y compris les **ratings** de l’étape), suppression du fichier image procédure, et **nettoyage multi-chemin** de tous les `cleaningReports/*/stepFeedback/{stepId}` pour cette étape.
- **Suggestions (v4.3)** : en tête de liste par studio, cartes **orange**. Métadonnées dans **`procedureSuggestions/`** ; **même fichier Storage que les étapes** : **`orgs/{orgId}/procedures/{studio}/{suggestionId}.jpg`**. **Valider** : l’étape est créée avec **`id` = `suggestionId`** (pas de nouveau `push`) pour garder le même chemin JPEG ; **`photoUrl`** repris depuis la suggestion ; suppression du nœud **`procedureSuggestions`**. **Supprimer** : RTDB + `deleteObject` sur ce même chemin si besoin. **Héritage** : **`stepId`** → **`update`** puis suppression suggestion ; refus → **`procedureRemoveStepCompletely`** + suggestion.
- **Moyenne des notes** : sous le bouton corbeille, trois étoiles non cliquables (demi-étoiles, gris si aucune note).
- **Liste des étapes** : lorsque le studio affiché ne change pas, le rendu des lignes d’étapes reste **incrémental** (mise à jour des champs sans recréer les vignettes photo) pour éviter de **recharger** les images à chaque enregistrement des descriptions. Les **suggestions** (encadré orange) sont dans un bloc **à part** : leur **HTML** n’est régénéré que lorsque les données des suggestions affichées changent (signature), pas à chaque mise à jour des étapes officielles.

**Affichage côté calendrier** (`index.html`, **v4.3+**) : **uniquement** pour une **intervenante connectée** (compte ménage, auth activée) **déjà assignée** au départ. La modale **Mon intervention** comporte un second onglet **Procédure** : liste des étapes du studio, case **Fait** (temps réel via un seul `onValue` sur `stepFeedback`), étoiles 1–3 (persistantes, clic sur la note active la retire ; pas de bloc d’aide textuel sur la signification des notes — interface allégée **v4.3.2**). Bouton **+** : sous-modale **suggérer une étape** (photo optionnelle, même compression que l’admin) avec **état « Envoi en cours… »** (champs et boutons désactivés, message d’attente, anti double-clic) et toast court **« Suggestion envoyée. »** après succès. **Pas** d’onglet procédure si la ménagère n’est pas assignée ; en **mode sans auth** (vue admin sur le calendrier), comportement inchangé — pas d’onglet procédure.

### `/procedureSuggestions` — file d’attente (v4.3)

Sous **`/orgs/{orgId}/procedureSuggestions/{suggestionId}`** :

| Champ | Rôle |
|--------|------|
| `studioIndex` | `0` ou `1` (studio cible). |
| `shortDesc` | Description courte. |
| `longDesc` | Détails (peut être vide). |
| `photoUrl` | URL après upload, ou chaîne vide. |
| `suggestedBy` | Prénom (compte). |
| `createdAt` | Horodatage ms. |

**Storage** : **`orgs/{orgId}/procedures/{studioIndex}/{suggestionId}.jpg`** — identique aux photos d’étapes admin (`{stepId}.jpg`), l’id de suggestion devient l’id d’étape à la validation.

**Héritage** : anciennes entrées avec **`stepId`** + brouillon sous **`procedures/`** — encore gérées à la validation / au refus (voir comportement admin ci-dessus).

#### Rétrospective — pourquoi la validation cassait, et comment c’est réglé (v4.3.1)

À garder en tête pour toute évolution future (chemins Storage, `getBytes`, etc.) :

1. **Échec principal au début** : après un **`push()`** sur **`steps`**, la nouvelle étape avait un **`stepId` différent** du **`suggestionId`**. Pour « garder » la photo, le code faisait **`getBytes`** sur le fichier de la suggestion puis **`uploadBytes`** vers **`…/procedures/{studio}/{nouveauStepId}.jpg`**. Dès que cette chaîne échouait (souvent : **CORS** ou accès Storage depuis le navigateur, règles, token, réseau), **toute** la validation tombait — y compris la création de l’étape en texte. D’où la première stabilisation : valider **sans** recopie de fichier (étape créée, photo ignorée).

2. **Pourquoi des dossiers Storage à part** : tant que l’id du fichier (`suggestionId`) **n’est pas** l’id de l’étape (`stepId` issu d’un autre `push`), on ne peut pas utiliser **exactement** le même chemin que l’admin (`…/{studio}/{stepId}.jpg`) **sans** renommer ou recopier. D’où des essais avec des racines ou sous-dossiers dédiés (`procedureSuggestions/`, puis `…/suggest/`), ce qui fonctionnait mais multipliait les conventions.

3. **Modèle actuel (celui qui marche avec photo)** : le calendrier upload le JPEG sous **`orgs/{orgId}/procedures/{studio}/{suggestionId}.jpg`**, **identique** à une photo d’étape admin. À la **validation**, on **ne crée pas** l’étape avec un nouveau `push()` : on écrit **`procedures/{studio}/steps/{suggestionId}`** avec **`id = suggestionId`**, on recopie **`photoUrl`** depuis la suggestion, puis on supprime **`procedureSuggestions/{suggestionId}`**. Le fichier Storage **reste au même endroit** ; pas de **`getBytes`**, pas de second upload, pas de suppression du JPG à la validation. **Refus** : suppression RTDB + **`deleteObject`** sur ce même chemin (comme pour une étape sans valider).

4. **Données anciennes** : les images déjà enregistrées sous d’**anciens** chemins (ex. racines **`procedureSuggestions/`** ou **`…/suggest/`** d’essais intermédiaires) **ne sont pas migrées** par l’app ; l’URL en base peut encore pointer vers ces fichiers jusqu’à nettoyage manuel dans la console Firebase Storage si besoin.

**Règles** : l’app utilise une auth « maison » (pas Firebase Auth côté client) ; les règles RTDB / Storage doivent rester cohérentes avec ce modèle (voir commentaire en tête du script dans `admin.html` et § **Sécurité v4.3.0** ci-dessous).

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
- Badge en-tête : **lien** vers **`admin.html`** si rôle 👑 ou mode sans auth (**Admin**) ; **bouton** prénom (style discret) vers **`compte.html`** si compte ménage sans rôle admin (**v4.4.0** : tableau de bord + mot de passe sur page dédiée, plus de modale « Mon compte »). Pour tester **`admin.html`** ou **`compte.html`** en local, le serveur statique doit rester actif (ex. `python -m http.server 5173`) : le calendrier peut sembler vivant via Firebase alors qu’une navigation vers une autre page locale échoue si le serveur est arrêté.

**Calendrier**
- Affichage **S1 / S2** inchangé (noms de studios viennent de `/orgs/{orgId}/config`).
- **Départs** : si l’assignation a une **`note`** non vide (après trim), le bloc départ affiche **📝** après le libellé (ex. `Départ S1 📝`) — visible par tous (admin et ménagères).
- **Comptes rendus (rôle ménage, départ où l’on est assignée)** : modale avec onglets **Mon intervention** et **Procédure** (v4.3) — durée personnelle (heures + minutes), champs **communs** commande / commentaire, enregistrement dans **`cleaningReports`** ; onglet **Procédure** : étapes du studio, coches **Fait** (**`stepFeedback`**, temps réel), notes 1–3 persistantes (**`ratings/{Prénom}`**), suggestion d’étape (**+**) ; **v4.3.4** : si une **note d’assignation** existe, **3ᵉ onglet** **📝** (orange, largeur réduite — info optionnelle) : texte **en lecture seule** (« Note de [noteBy ou l’administration] »). Onglet par défaut : **Mon intervention**. Si non assignée, pop-up **M’assigner** uniquement (pas d’onglet procédure) ; **v4.3.4** : si une note existe, encart discret **lecture seule** sous les dates, avant les boutons. Croix de fermeture en haut à droite ; fermeture automatique après **Enregistrer** sur l’onglet intervention.
- **Badge** du prénom sous le départ : **contour noir** si des heures ont été enregistrées pour cette personne sur ce départ.
- **Indisponibilités (v4.5.0)** : troisième bouton **Indispo** dans la carte filtres (**Arrivées** / **Départs** / **Indispo**), état **`S.showUnavailability`** (désactivé par défaut) ; actif en rouge **`#E24B4A`**. Listener **`/orgs/{orgId}/unavailability/`** → **`S.unavailability`** aplati (niveau **`dates`**). **Pastilles** en haut à droite de chaque case jour si **Indispo** est actif : **indépendant** de **`filterType`** (y compris si ni arrivées ni départs) ; périmètre = ménagère du **filtre prénom** si sélectionnée, sinon toutes les **`menage`**. Pastille : couleur **`cleanerColor`**, initiales blanches, barre oblique (indispo) ; clic → modale lecture seule (**`stopPropagation`**). Clés jour = **date locale** **`YYYY-MM-DD`**.

### compte.html — Espace intervenante

- **Accès** : session **`menage_session_v1`** (prénom) + org **`menage_org_v1`** ; sinon redirection vers **`index.html`**. Comptes **admin** : redirection vers **`index.html`** (page réservée aux intervenantes sans rôle admin).
- **Topbar** : prénom, indicateur sync, **Retour** vers **`index.html`** (session conservée) ; pas de bouton déconnexion (déco sur le calendrier).
- **Menu burger** : **Dashboard** (défaut), **Compte**, **Indisponibilités** (**v4.5.0**) ; hashes **`#dashboard`**, **`#compte`**, **`#indisponibilites`**.
- **Dashboard** : mois (← / libellé / → comme l’admin), KPIs **Interventions ce mois** (une réservation = une intervention si assignée en **c1** ou **c2**), **Prochain départ** (même libellés que le KPI calendrier *sans intervenante* : **Aujourd’hui**, **Demain**, **J-*n***, **Aucun**), **Heures totales ce mois** (somme **`cleaningReports`** pour ce prénom uniquement si **`assignSig`** correspond à l’assignation actuelle — comme **`cleaningReportViewFor`** sur **`index.html`**). Tableau d’historique du mois : date départ **jj/mm/aa**, studio **S1** / **S2**, heures ou **Non renseigné**.
- **Vue Compte** : changement de mot de passe (même règles qu’avant sur **`index.html`**, écriture **`adminConfig`**, entrée journal **`activityLog`**).
- **Vue Indisponibilités (v4.5.0)** : mois **découplé** du Dashboard ; navigation bornée **± 3 ans** (local) avec boutons **←** / **→** grisés aux limites. Calendrier mensuel : jours hors mois et passés non modifiables ; passés avec indispo en fond rouge pâle (lecture seule) ; **aujourd’hui et futur** : bascule **`set` / `remove`** sur **`…/unavailability/{prénom}/dates/{YYYY-MM-DD}`** avec **optimistic UI** et **toast + rollback** si erreur Firebase. Listener **`onValue`** sur le nœud **`dates`** de l’utilisatrice connectée.

### admin.html — Back-office

- La **note** sur une réservation (champ **Note** de la modale d’assignation) est saisie depuis **`index.html`** (pas depuis une vue dédiée de l’admin). **`noteBy`** est enregistré côté **`index.html`** lors de l’enregistrement admin — voir § **`/assignments`**.
- **Sans** `menage_org_v1` valide : **redirection vers `index.html`**.
- Toutes les opérations Firebase sous **`/orgs/{orgId}/`** pour l’org choisie sur le calendrier.
- **Topbar** : titre **Administration** et **nom de l’organisation** uniquement (sans suffixe « Planning Ménage ») ; **menu burger** à gauche ; retour **focus** sur le burger à la fermeture du tiroir (accessibilité).
- **Navigation latérale** (ordre du haut vers le bas) — une **vue pleine page** par entrée, sans sous-menus :
  1. **Dashboard** — statistiques du mois, **export Excel** (aperçu optionnel), **historique des interventions**, bouton **Se déconnecter**.
  2. **Procédure** — **Procédures & préparation studio** (étapes par studio, photos Storage + texte RTDB, suggestions orange en tête de liste, moyenne des notes par étape), voir § `/procedures` et `/procedureSuggestions` ci-dessus.
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

### purge-unavailability.js (**v4.4.0**, inchangé en v4.5.0)

- Parcourt **`tesson`** puis **`nade`** (même liste que **`notify-departs.js`**).
- Lit **`/orgs/{orgId}/unavailability`** ; si le nœud est absent, **aucune** action pour cette org.
- Supprime les entrées **`…/unavailability/{prenom}/dates/{YYYY-MM-DD}`** dont la date est **strictement &lt;** (aujourd’hui **UTC** − 3 ans). Secret **`FIREBASE_SERVICE_ACCOUNT`** uniquement.
- Workflow : **`.github/workflows/purge-unavailability.yml`** — planification **1er de chaque mois à 3h00 UTC**, Node **20**, **`workflow_dispatch`** possible.

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
- Penser à inclure **`/orgs/{orgId}/cleaningReports`** (et sous-chemins **`stepFeedback`**, **`procedureSuggestions`**, **`procedures/.../ratings`**) dans les **règles Realtime Database** si elles ne sont pas déjà couvertes par une règle large (sinon les comptes rendus / procédure ne s’enregistrent pas). Idem pour **`unavailability`** (lecture utile pour le calendrier ; écriture par chaque ménagère sur son sous-chemin **`dates`** si vous affinez les règles).
- **Firebase Storage** : autoriser **`orgs/{orgId}/procedures/...`** (un seul schéma : **`{studio}/{id}.jpg`** pour étape ou suggestion).

#### Sécurité v4.3.0 — exemples de règles (console Firebase)

Les règles ne sont **pas** versionnées dans ce dépôt ; copier-coller des blocs adaptés si vous n’utilisez pas déjà une règle large sur `orgs/{orgId}`.

**Realtime Database** (exemple si vous affinez par enfant ; à fusionner avec votre arbre existant) :

```json
{
  "rules": {
    "orgs": {
      "$orgId": {
        "procedureSuggestions": {
          ".read": true,
          ".write": true
        },
        "cleaningReports": {
          "$uid": {
            "stepFeedback": {
              "$stepId": {
                "checked": {
                  ".read": true,
                  ".write": true
                }
              }
            }
          }
        },
        "procedures": {
          "$studio": {
            "steps": {
              "$stepId": {
                "ratings": {
                  "$name": {
                    ".read": true,
                    ".write": true
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

Souvent, une règle du type **`orgs/{orgId}/.read` / `.write`** couvre déjà ces nœuds sans ajout explicite.

**Storage** (règles type) :

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /orgs/{orgId}/procedures/{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```

Remplacer les `if true` par une contrainte (domaine, App Check, etc.) lorsque vous durcissez la sécurité.

### CORS — Firebase Storage (optionnel, dépannage local)

Si des **uploads** ou appels Storage depuis l’admin **ou le calendrier** (suggestions avec photo, v4.3) échouent en local (`http://127.0.0.1:…`) avec *blocked by CORS policy*, vous pouvez configurer le bucket :

1. **Nom du bucket** : Firebase Console → **Storage**.
2. Adapter **`storage-cors.example.json`** (origines).
3. `gsutil cors set storage-cors.example.json gs://planning-menage-18b09.firebasestorage.app` (voir bucket réel dans la console).

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
5. ~~**Consultation des procédures** depuis le calendrier (`index.html`)~~ — **fait en v4.3** (onglet Procédure pour intervenantes assignées)  
6. **Hub multi-plannings** (enfants, crèche, etc.)  
7. **Application mobile native** — notifications push  

---

## Comment reprendre le développement avec Claude

```
Projet : Planning Ménage Airbnb
Version : 4.5.0
GitHub : https://github.com/JonathanTesson/planning-menage
App : https://jonathantesson.github.io/planning-menage/
Admin : https://jonathantesson.github.io/planning-menage/admin.html
Compte : https://jonathantesson.github.io/planning-menage/compte.html
Fichiers : index.html, admin.html, compte.html, sync-ical.js, notify-departs.js, purge-unavailability.js, migrate.js, .gitignore
README : https://github.com/JonathanTesson/planning-menage/blob/main/README.md
```

---

## Historique des versions

### v4.5.0 — Avril 2026
- **Indisponibilités** : schéma **`/orgs/{orgId}/unavailability/{prenom}/dates/{YYYY-MM-DD}`** — saisie en **date locale** ; purge cron en **seuil UTC** sur les clés (documenté § **`/unavailability`**).
- **`compte.html`** : vue **Indisponibilités** (menu burger, **`#indisponibilites`**), calendrier tactile, optimistic + rollback, mois indépendant du Dashboard.
- **`index.html`** : **`S.unavailability`** (normalisation **`dates`**), bouton **Indispo**, pastilles sur le calendrier, modale info ; **`APP_VERSION` : 4.5.0**.

### v4.4.0 — Avril 2026
- **`compte.html`** : page **intervenante** (menu burger) — **Dashboard** (KPIs mois, historique, règle **`assignSig`** pour les heures, prochain départ aligné sur les libellés du calendrier) et **Compte** (mot de passe).
- **`index.html`** : clic sur le **prénom** → **`compte.html`** ; suppression de la modale **Mon compte** et des fonctions **`openAccountMenu`** / **`_saveOwnPassword`**.
- **`purge-unavailability.js`** + **`.github/workflows/purge-unavailability.yml`** : purge mensuelle des indisponibilités **> 3 ans** (UTC), schéma **`/unavailability/{prenom}/dates/{YYYY-MM-DD}`** documenté dans le README.
- **`APP_VERSION` : 4.4.0** dans **`index.html`**.

### v4.3.4 — Avril 2026
- **Calendrier (`index.html`)** — **Note d’assignation** : enregistrement de **`noteBy`** (auteur) lorsque la **note** est non vide à la sauvegarde admin (**`_sa`** / **`assignActorLabel()`**) ; **`noteBy: null`** si la note est vidée.
- **Calendrier** : indicateur **📝** sur le libellé des **départs** lorsqu’une note existe (trim).
- **Ménagère non assignée** : affichage **lecture seule** de la note (auteur **noteBy** ou **l’administration** si absent) dans la pop-up **M’assigner**.
- **Ménagère assignée** : **3ᵉ onglet** **📝** (orange, compact) dans la modale **Mon intervention** si une note existe ; contenu en lecture seule ; onglets principaux **Mon intervention** / **Procédure** inchangés.
- **Self-assign / retrait** : conservation de **`noteBy`** lorsque l’objet assignation est réécrit.
- **`APP_VERSION` : 4.3.4** dans `index.html` et `admin.html`.

### v4.3.3 — Avril 2026
- **Admin (`admin.html`)** : **Procédure** — (1) suppression de **`forceFullRebuild=sugs.length>0`** qui empêchait le rendu incrémental des **étapes officielles** dès qu’une suggestion existait ; (2) **cause principale** du rechargement des **photos orange** : à **chaque** appel de **`renderProcedures()`** (y compris après un blur sur une étape officielle), le bloc **`proc-suggestions-block`** était entièrement refait en **`innerHTML`**, ce qui **recréait** les vignettes suggestion. Désormais une **signature** (ids + champs affichés) évite de toucher au DOM des suggestions si leurs données n’ont pas changé.
- **Calendrier (`index.html`)** : onglet **Procédure** — rendu **incrémental** des étapes (coches **Fait** / notes **étoiles**) pour ne pas recréer les **`<img>`** à chaque sync Firebase, sur le même principe que l’admin.
- **`APP_VERSION` : 4.3.3** dans `index.html` et `admin.html`.

### v4.3.2 — Avril 2026
- **Calendrier (`index.html`)** : suggestion d’étape — interface d’envoi **bloquée pendant** compression / upload / RTDB (libellé **Envoi en cours…**, texte d’attente, pas de double clic, fond modal inactif) ; toast de succès court **« Suggestion envoyée. »** ; suppression du paragraphe d’aide sur la signification des **étoiles** dans l’onglet Procédure (gain de place).
- **Admin (`admin.html`)** : après **Copier** une étape vers un autre studio, le toast rappelle explicitement que la **photo n’est pas copiée**.
- **Nettoyage** : retrait de **`renderSettings`** et du stub **`toggleSettings`** dans `index.html` (jamais appelés ; champs `name-s1` / `name-s2` inexistants sur le calendrier).
- **`APP_VERSION` : 4.3.2** dans `index.html` et `admin.html`.

### v4.3.1 — Avril 2026
- **Suggestions — validation fiable avec photo** : alignement Storage calendrier / admin sur **`orgs/{orgId}/procedures/{studio}/{id}.jpg`** ; à la validation, création de l’étape avec **`id` = `suggestionId`** (**`set`** sur **`steps/{suggestionId}`**, plus de **`push`** pour ce cas) pour **ne pas déplacer** le JPEG ; **`photoUrl`** repris depuis RTDB ; plus de **`getBytes`** / ré-upload à la validation (cause fréquente d’échec total auparavant).
- **Refus suggestion** : suppression du fichier via **`procedureStoragePath(si, suggestionId)`** (même convention que les étapes).
- **Garde-fou** : toast si une étape existe déjà sous le même id (cas anormal).
- **Docs** : README — nouvelle sous-section **« Rétrospective — pourquoi la validation cassait »** ; `APP_VERSION` **4.3.1**.

### v4.3.0 — Avril 2026
- **Calendrier (`index.html`)** : onglet **Procédure** dans la modale ménage (intervenante assignée, auth activée) — coches **Fait**, notes **ratings**, sous-modale **+** : métadonnées **`procedureSuggestions/`** + envoi photo suggestion (chemins Storage affinés en **v4.3.1**).
- **Admin (`admin.html`)** : suggestions filtrées par studio (encadré orange), **Valider** / **Supprimer** (modale intégrée), moyenne des notes en demi-étoiles sous la corbeille, suppression d’étape étendue (nettoyage `stepFeedback` sur tous les rapports via `update` multi-chemin)
- **Données** : conservation de **`stepFeedback`** lors des changements d’assignation (`syncCleaningReportAfterAssignmentChange`, comme les heures)
- **Docs** : README (schéma, sécurité v4.3.0, comportement index/admin) ; commentaire règles en tête de `admin.html` ; `APP_VERSION` **4.3.0** à la sortie de cette release
- **Scripts non modifiés** : `sync-ical.js`, `notify-departs.js`, `migrate.js` — aucune référence aux suggestions

### v4.2.1 — Avril 2026
- **Admin — Procédures** : nouvelle étape **en tête** ; flèches **▲▼** ; zone photo unifiée ; **Copier** les **textes seulement** (pas de photo, phrase dans la modale) ; après copie, le menu **Studio** reste sur le studio en cours ; **rendu incrémental** de la liste pour ne pas recharger les images quand seules les descriptions changent ; suppression d’étape + fichier Storage `…/{studio}/{stepId}.jpg` ; modales intégrées **remplacer photo** / **supprimer** / **copier** ; code nettoyé (plus de logique copie / partage de photo ni `getBytes` pour les procédures)
- **Versions affichées** : `APP_VERSION` **4.2.1** dans `index.html` et `admin.html` (aligner avec ce README à chaque release)

### v4.2.0 — Avril 2026
- **Admin — Procédures & préparation studio** : étapes par studio (`/orgs/{orgId}/procedures/...`), photos JPEG dans Storage (`orgs/{orgId}/procedures/{studioIndex}/{stepId}.jpg`), compression côté navigateur (max 640 px, qualité ~0,48) ; enregistrement au blur / après upload
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
