/**
 * Purge des indisponibilités trop anciennes sous /orgs/{orgId}/unavailability/.
 *
 * Structure attendue (étape 2 UI) :
 *   /orgs/{orgId}/unavailability/{prenom}/dates/{YYYY-MM-DD} → true
 *
 * Supprime toutes les entrées dont la date (clé YYYY-MM-DD) est strictement antérieure
 * à (aujourd'hui UTC − 3 ans). Les dates sont comparées en UTC : le script et le cron
 * GitHub Actions tournent en UTC — pas de conversion fuseau Europe/Paris.
 *
 * Usage :
 *   set FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
 *   node purge-unavailability.js
 */

const https = require('https');

const ORGS = [
  { id: 'tesson', label: 'Studio Tesson' },
  { id: 'nade', label: 'Studio Nade' }
];

const FIREBASE_DB_URL = 'https://planning-menage-18b09-default-rtdb.firebaseio.com';

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => (d += c));
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
    iss: client_email,
    sub: client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'
  };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const jwtBody = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${header}.${jwtBody}`;
  const crypto = require('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const jwt = `${signingInput}.${sign.sign(private_key, 'base64url')}`;
  const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const res = await httpRequest(
    {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    },
    postData
  );
  return JSON.parse(res.body).access_token;
}

async function firebaseGet(path, token) {
  const res = await httpRequest({
    hostname: new URL(FIREBASE_DB_URL).hostname,
    path: `/${path}.json?access_token=${encodeURIComponent(token)}`,
    method: 'GET'
  });
  return res.body === 'null' ? null : JSON.parse(res.body);
}

/** PATCH shallow merge : null supprime la clé ciblée. */
async function firebasePatch(path, data, token) {
  const body = JSON.stringify(data);
  const res = await httpRequest({
    hostname: new URL(FIREBASE_DB_URL).hostname,
    path: `/${path}.json?access_token=${encodeURIComponent(token)}`,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  if (res.status !== 200) throw new Error(`PATCH ${path} → ${res.status} ${res.body}`);
}

/** Fusionne un chemin de clés menant à null dans un arbre d’update PATCH. */
function mergeNullAt(root, keyParts) {
  let cur = root;
  for (let i = 0; i < keyParts.length - 1; i++) {
    const k = keyParts[i];
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[keyParts[keyParts.length - 1]] = null;
}

function cutoffDateStrUtc() {
  const now = new Date();
  const c = new Date(Date.UTC(now.getUTCFullYear() - 3, now.getUTCMonth(), now.getUTCDate()));
  return c.toISOString().slice(0, 10);
}

function isYyyyMmDd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function purgeOrg(org, token, cutoffStr) {
  const basePath = `orgs/${org.id}/unavailability`;
  let tree;
  try {
    tree = await firebaseGet(basePath, token);
  } catch (e) {
    console.warn(`⚠️ [${org.id}] lecture:`, e.message);
    return 0;
  }
  if (tree == null || typeof tree !== 'object') return 0;

  const patchRoot = {};
  let count = 0;

  for (const prenom of Object.keys(tree)) {
    const node = tree[prenom];
    if (!node || typeof node !== 'object') continue;
    const dates = node.dates;
    if (!dates || typeof dates !== 'object') continue;
    for (const dateKey of Object.keys(dates)) {
      if (!isYyyyMmDd(dateKey)) continue;
      if (dateKey < cutoffStr) {
        mergeNullAt(patchRoot, ['unavailability', prenom, 'dates', dateKey]);
        count++;
      }
    }
  }

  if (count === 0) return 0;

  try {
    await firebasePatch(`orgs/${org.id}`, patchRoot, token);
  } catch (e) {
    console.warn(`⚠️ [${org.id}] écriture:`, e.message);
    return 0;
  }
  return count;
}

async function main() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('❌ Définir FIREBASE_SERVICE_ACCOUNT (JSON compte de service).');
    process.exit(1);
  }

  const cutoffStr = cutoffDateStrUtc();
  console.log(`Purge indisponibilités : dates < ${cutoffStr} (UTC, aujourd’hui − 3 ans)\n`);

  const token = await getFirebaseToken();

  for (const org of ORGS) {
    const n = await purgeOrg(org, token, cutoffStr);
    console.log(`[${org.id}] ${n} entrée(s) supprimée(s)`);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
