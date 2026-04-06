/**
 * Migration one-shot : copie les données historiques (racine RTDB)
 * vers /orgs/tesson/ sans supprimer la racine.
 *
 * Usage (avec secret JSON dans l'environnement) :
 *   set FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
 *   node migrate.js
 *
 * Vérifier le résumé en console, puis valider côté app avant toute suppression racine.
 */

const https = require('https');

const FIREBASE_DB_URL = 'https://planning-menage-18b09-default-rtdb.firebaseio.com';
const TARGET_ORG = 'tesson';

const KEYS_TO_MIGRATE = [
  'config',
  'reservations',
  'assignments',
  'adminConfig',
  'lastSync',
  'activityLog'
];

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
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: client_email, sub: client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'
  };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${header}.${body}`;
  const crypto = require('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const jwt = `${signingInput}.${sign.sign(private_key, 'base64url')}`;
  const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const res = await httpRequest({
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': postData.length }
  }, postData);
  return JSON.parse(res.body).access_token;
}

async function firebaseGet(path, token) {
  const res = await httpRequest({
    hostname: new URL(FIREBASE_DB_URL).hostname,
    path: `/${path}.json?access_token=${token}`,
    method: 'GET'
  });
  return res.body === 'null' ? null : JSON.parse(res.body);
}

async function firebasePut(path, data, token) {
  const body = JSON.stringify(data);
  const res = await httpRequest({
    hostname: new URL(FIREBASE_DB_URL).hostname,
    path: `/${path}.json?access_token=${token}`,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error('PUT ' + res.status + ' ' + res.body);
}

function countNodes(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val !== 'object') return 1;
  return Object.keys(val).length;
}

async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('  Migration racine → /orgs/' + TARGET_ORG + '/');
  console.log('  (la racine n’est PAS supprimée)');
  console.log('══════════════════════════════════════════════════════\n');

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('❌ Définir la variable d’environnement FIREBASE_SERVICE_ACCOUNT (JSON compte de service).');
    process.exit(1);
  }

  let token;
  try {
    token = await getFirebaseToken();
  } catch (e) {
    console.error('❌ Token Firebase:', e.message);
    process.exit(1);
  }

  const summary = [];

  for (const key of KEYS_TO_MIGRATE) {
    try {
      const data = await firebaseGet(key, token);
      if (data === null || data === undefined) {
        summary.push({ key, status: 'absent', detail: 'rien à la racine' });
        console.log(`— ${key} : absent à la racine (ignoré)`);
        continue;
      }
      const dest = `orgs/${TARGET_ORG}/${key}`;
      await firebasePut(dest, data, token);
      const n = typeof data === 'object' && data !== null ? Object.keys(data).length : 1;
      summary.push({ key, status: 'copié', detail: `→ ${dest} (${n} clé(s) racine ou objet)` });
      console.log(`✓ ${key} : copié vers ${dest}`);
    } catch (e) {
      summary.push({ key, status: 'erreur', detail: e.message });
      console.error(`✗ ${key} :`, e.message);
    }
  }

  console.log('\n────────── Résumé ──────────');
  for (const row of summary) {
    console.log(`  [${row.status}] ${row.key} — ${row.detail}`);
  }
  console.log('\nÉtape suivante : vérifier l’app avec org « tesson », puis décider si vous supprimez la racine (manuellement).');
}

main();
