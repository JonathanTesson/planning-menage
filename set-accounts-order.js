/**
 * set-accounts-order.js
 * Ajoute le champ `order` (index couleur) sur les comptes /accounts existants.
 * One-shot — à exécuter une seule fois, puis supprimer ou archiver.
 *
 * Ordre défini manuellement selon l'ordre original avant migration :
 *   tesson : Jonath(0) Steffie(1) Mireille(2) Emmy(3) Valérie(4) Christelle(5)
 *   nade   : Nade(6) Solene(7)
 *   zencles: Clémentine(8) Floriandre(9)
 *
 * Les nouveaux comptes créés après ce script reçoivent automatiquement
 * order = max(order existants) + 1 (géré dans superadmin.html et admin.html).
 *
 * Usage :
 *   $env:FIREBASE_SERVICE_ACCOUNT = Get-Content ".\Firebase\planning-menage-18b09-firebase.json" -Raw
 *   node set-accounts-order.js
 */

const https = require('https');
const crypto = require('crypto');

const FIREBASE_DB_URL = 'https://planning-menage-18b09-default-rtdb.firebaseio.com';

// Ordre défini manuellement — clé = name du compte, valeur = index couleur
const ORDER_MAP = {
  'Jonath':     0,
  'Steffie':    1,
  'Mireille':   2,
  'Emmy':       3,
  'Valérie':    4,
  'Christelle': 5,
  'Nade':       6,
  'Solene':     7,
  'Clémentine': 8,
  'Floriandre': 9,
};

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
  if (!parsed.access_token) throw new Error('Token non obtenu : ' + res.body);
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

async function firebasePatch(path, data, token) {
  const body = JSON.stringify(data);
  const res = await httpRequest({
    hostname: new URL(FIREBASE_DB_URL).hostname,
    path: `/${path}.json?access_token=${token}`,
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error(`PATCH /${path} → HTTP ${res.status} : ${res.body}`);
}

function ok(msg)   { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
function err(msg)  { console.log(`  ❌ ${msg}`); }

async function main() {
  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log('  set-accounts-order.js — Planning Ménage v4.8.0');
  console.log('  Ajout champ `order` sur les comptes /accounts');
  console.log('══════════════════════════════════════════════════════');
  console.log('');

  const token = await getFirebaseToken();
  ok('Token Firebase obtenu');

  const raw = await firebaseGet('accounts', token);
  if (!raw) { err('Aucun compte trouvé dans /accounts'); process.exit(1); }

  const entries = Object.entries(raw);
  console.log(`\n📦 ${entries.length} compte(s) trouvé(s)\n`);

  let updated = 0;
  let skipped = 0;
  let unknown = 0;

  for (const [id, acc] of entries) {
    const name = String(acc.name || acc.prenom || '').trim();
    if (!name) { warn(`Compte ${id} sans nom — ignoré`); skipped++; continue; }

    if (acc.order != null) {
      ok(`${name} — order déjà présent (${acc.order}) — ignoré`);
      skipped++;
      continue;
    }

    const order = ORDER_MAP[name];
    if (order == null) {
      warn(`${name} — absent de ORDER_MAP — ignoré (à ajouter manuellement)`);
      unknown++;
      continue;
    }

    try {
      await firebasePatch(`accounts/${id}`, { order }, token);
      ok(`${name} → order = ${order}`);
      updated++;
    } catch(e) {
      err(`${name} → échec : ${e.message}`);
    }
  }

  console.log('');
  console.log('══════════════════════════════════════════════════════');
  console.log(`  ✅ ${updated} compte(s) mis à jour`);
  if (skipped) console.log(`  ℹ️  ${skipped} compte(s) ignoré(s) (déjà à jour)`);
  if (unknown) console.log(`  ⚠️  ${unknown} compte(s) absent(s) de ORDER_MAP — à traiter manuellement`);
  console.log('══════════════════════════════════════════════════════');
  console.log('');
  process.exit(0);
}

main().catch(e => { console.error('\n❌ Erreur fatale :', e.message); process.exit(1); });
