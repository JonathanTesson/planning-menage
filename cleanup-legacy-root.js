/**
 * cleanup-legacy-root.js
 * Supprime les nœuds racine orphelins de la RTDB (héritage pré-migration multi-org).
 *
 * Nœuds supprimés :
 *   /activityLog      → remplacé par /orgs/{orgId}/activityLog
 *   /activityLogs     → nœud orphelin (1 entrée, format abandonné)
 *   /lastSync         → remplacé par /orgs/{orgId}/lastSync
 *   /config           → remplacé par /orgs/{orgId}/config
 *   /reservations     → remplacé par /orgs/{orgId}/reservations
 *   /assignments      → remplacé par /orgs/{orgId}/assignments
 *   /adminConfig      → remplacé par /accounts (global) + /orgs/{orgId}/adminConfig
 *
 * Nœuds JAMAIS touchés :
 *   /organizations    → source canonique des orgs
 *   /accounts         → nouveau système global de comptes
 *   /orgs/            → données métier par org (production)
 *   /superAdmin       → credentials Super Admin
 *   /pendingDeletionRequests → demandes de suppression en cours
 *
 * Prérequis :
 *   - Avoir exécuté check-accounts.js et validé 0 compte legacy orphelin
 *   - Avoir vérifié que sync-ical.js et index.html lisent/écrivent dans /orgs/{orgId}/
 *
 * Usage :
 *   $env:FIREBASE_SERVICE_ACCOUNT = Get-Content ".\Firebase\planning-menage-18b09-firebase.json" -Raw
 *   node cleanup-legacy-root.js
 *
 *   Pour supprimer sans confirmation interactive (CI) :
 *   node cleanup-legacy-root.js --confirm
 */

const https = require('https');
const readline = require('readline');

const FIREBASE_DB_URL = 'https://planning-menage-18b09-default-rtdb.firebaseio.com';

// Nœuds racine à supprimer — dans cet ordre
const NODES_TO_DELETE = [
  { path: 'activityLog',  label: '/activityLog  (logs legacy racine)' },
  { path: 'activityLogs', label: '/activityLogs (logs orphelins, 1 entrée)' },
  { path: 'lastSync',     label: '/lastSync     (sync legacy racine)' },
  { path: 'config',       label: '/config       (config legacy racine)' },
  { path: 'reservations', label: '/reservations (réservations legacy racine)' },
  { path: 'assignments',  label: '/assignments  (assignations legacy racine)' },
  { path: 'adminConfig',  label: '/adminConfig  (comptes legacy racine — migrés vers /accounts)' },
];

// Nœuds protégés — ne jamais toucher
const PROTECTED = ['organizations', 'accounts', 'orgs', 'superAdmin', 'pendingDeletionRequests'];

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getFirebaseToken() {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const { private_key, client_email } = sa;
  const crypto = require('crypto');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: client_email, sub: client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'
  };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body   = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${header}.${body}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const jwt = `${signingInput}.${sign.sign(private_key, 'base64url')}`;
  const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const res = await httpRequest({
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
  }, postData);
  const parsed = JSON.parse(res.body);
  if (!parsed.access_token) throw new Error('Token Firebase non obtenu : ' + res.body);
  return parsed.access_token;
}

async function firebaseGet(path, token) {
  const res = await httpRequest({
    hostname: new URL(FIREBASE_DB_URL).hostname,
    path: `/${path}.json?access_token=${token}`,
    method: 'GET'
  });
  return res.body === 'null' ? null : JSON.parse(res.body);
}

async function firebaseDelete(path, token) {
  const res = await httpRequest({
    hostname: new URL(FIREBASE_DB_URL).hostname,
    path: `/${path}.json?access_token=${token}`,
    method: 'DELETE'
  });
  if (res.status !== 200) throw new Error(`DELETE /${path} → HTTP ${res.status} : ${res.body}`);
}

function countEntries(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'object' && !Array.isArray(val)) return Object.keys(val).length;
  if (Array.isArray(val)) return val.length;
  return 1;
}

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

function ok(msg)   { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
function err(msg)  { console.log(`  ❌ ${msg}`); }
function info(msg) { console.log(`  ℹ️  ${msg}`); }

async function main() {
  const autoConfirm = process.argv.includes('--confirm');

  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log('  cleanup-legacy-root.js — Planning Ménage v4.8.0');
  console.log('  Nettoyage nœuds racine orphelins (post-migration)');
  console.log('══════════════════════════════════════════════════════');
  console.log('');

  // Garde-fou : vérifier que les nœuds à supprimer ne sont pas dans PROTECTED
  for (const node of NODES_TO_DELETE) {
    if (PROTECTED.includes(node.path)) {
      err(`ERREUR CRITIQUE : "${node.path}" est dans la liste protégée ! Abandon.`);
      process.exit(1);
    }
  }

  let token;
  try {
    token = await getFirebaseToken();
    ok('Token Firebase obtenu');
  } catch (e) {
    err('Erreur token Firebase : ' + e.message);
    process.exit(1);
  }

  // ── Phase 1 : Audit — lire ce qui existe ────────────────────────────────────
  console.log('');
  console.log('── Phase 1 : Audit des nœuds racine ───────────────────');
  console.log('');

  const audit = [];
  for (const node of NODES_TO_DELETE) {
    try {
      const val = await firebaseGet(node.path, token);
      const count = countEntries(val);
      const exists = val !== null;
      audit.push({ ...node, exists, count, val });
      if (!exists) {
        info(`${node.label} → déjà absent (rien à faire)`);
      } else {
        warn(`${node.label} → ${count} entrée(s) — sera supprimé`);
      }
    } catch (e) {
      err(`Lecture /${node.path} impossible : ${e.message}`);
      audit.push({ ...node, exists: false, count: 0, error: e.message });
    }
  }

  const toDelete = audit.filter(n => n.exists);

  console.log('');
  console.log('── Vérification nœuds protégés ────────────────────────');
  console.log('');

  for (const p of PROTECTED) {
    try {
      const val = await firebaseGet(p, token);
      if (val !== null) {
        ok(`/${p} présent et intact`);
      } else {
        warn(`/${p} absent de Firebase (inattendu)`);
      }
    } catch (e) {
      err(`Lecture /${p} impossible : ${e.message}`);
    }
  }

  console.log('');

  if (!toDelete.length) {
    ok('Aucun nœud à supprimer — la base est déjà propre !');
    console.log('');
    process.exit(0);
  }

  // ── Phase 2 : Confirmation ───────────────────────────────────────────────────
  console.log('── Récapitulatif des suppressions ──────────────────────');
  console.log('');
  for (const node of toDelete) {
    console.log(`  🗑️  ${node.label} (${node.count} entrée(s))`);
  }
  console.log('');
  console.log('  ⛔ Cette opération est IRRÉVERSIBLE.');
  console.log('  ✅ Les nœuds /organizations /accounts /orgs/ /superAdmin ne sont PAS touchés.');
  console.log('');

  if (!autoConfirm) {
    const answer = await ask('  Confirmer la suppression ? Tapez OUI pour continuer : ');
    if (answer !== 'OUI') {
      warn('Abandon — aucune modification effectuée.');
      console.log('');
      process.exit(0);
    }
  } else {
    info('Mode --confirm : suppression automatique sans prompt.');
  }

  // ── Phase 3 : Suppression ────────────────────────────────────────────────────
  console.log('');
  console.log('── Phase 3 : Suppression ───────────────────────────────');
  console.log('');

  let deleted = 0;
  let failed  = 0;

  for (const node of toDelete) {
    try {
      await firebaseDelete(node.path, token);
      ok(`Supprimé : ${node.label}`);
      deleted++;
    } catch (e) {
      err(`Échec suppression /${node.path} : ${e.message}`);
      failed++;
    }
  }

  // ── Phase 4 : Vérification post-suppression ──────────────────────────────────
  console.log('');
  console.log('── Phase 4 : Vérification post-suppression ─────────────');
  console.log('');

  for (const node of toDelete) {
    try {
      const val = await firebaseGet(node.path, token);
      if (val === null) {
        ok(`/${node.path} → absent ✓`);
      } else {
        err(`/${node.path} → encore présent ! Suppression échouée.`);
        failed++;
      }
    } catch (e) {
      err(`Vérification /${node.path} impossible : ${e.message}`);
    }
  }

  // ── Bilan ────────────────────────────────────────────────────────────────────
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  if (failed === 0) {
    console.log(`  ✅ Nettoyage terminé — ${deleted} nœud(s) supprimé(s), 0 erreur`);
  } else {
    console.log(`  ⚠️  Nettoyage partiel — ${deleted} supprimé(s), ${failed} erreur(s)`);
    console.log('     Relancer le script pour réessayer les nœuds en échec.');
  }
  console.log('══════════════════════════════════════════════════════');
  console.log('');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('\n❌ Erreur fatale :', e.message);
  process.exit(1);
});
