/**
 * Patch one-shot : ajoute nom, email, pseudo manquants
 * dans /orgs/{orgId}/adminConfig/accounts[] 
 * en lisant les données depuis /accounts global.
 *
 * Ne modifie QUE les champs manquants (SKIP si déjà présent).
 *
 * Usage :
 *   $env:FIREBASE_SERVICE_ACCOUNT = Get-Content ".\Firebase\planning-menage-18b09-firebase.json" -Raw; node patch-legacy-accounts.js
 */

const https = require('https');
const crypto = require('crypto');

const FIREBASE_DB_URL = 'https://planning-menage-18b09-default-rtdb.firebaseio.com';

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
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const jwt = `${signingInput}.${sign.sign(private_key, 'base64url')}`;
  const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const res = await httpRequest({
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
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

async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('  Patch legacy — ajout nom/email/pseudo manquants');
  console.log('══════════════════════════════════════════════════════\n');

  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT manquant');
    process.exit(1);
  }

  const token = await getFirebaseToken();
  console.log('✅ Token Firebase obtenu\n');

  // Charger /accounts global
  const accountsRaw = await firebaseGet('accounts', token);
  const accounts = accountsRaw
    ? Object.entries(accountsRaw).map(([id, v]) => ({ id, ...v }))
    : [];
  console.log(`📦 ${accounts.length} compte(s) dans /accounts\n`);

  // Charger /organizations
  const orgsRaw = await firebaseGet('organizations', token);
  const orgIds = orgsRaw ? Object.keys(orgsRaw) : [];

  const summary = [];

  for (const orgId of orgIds) {
    const legacyRaw = await firebaseGet(`orgs/${orgId}/adminConfig/accounts`, token);
    if (!legacyRaw) {
      console.log(`⏭️  [${orgId}] Aucun compte legacy\n`);
      continue;
    }

    const legacy = Array.isArray(legacyRaw) ? legacyRaw : Object.values(legacyRaw);
    let changed = false;

    console.log(`🏢 [${orgId}] — ${legacy.length} compte(s)`);

    for (let i = 0; i < legacy.length; i++) {
      const leg = legacy[i];
      const name = String(leg.name || '').trim();
      if (!name) continue;

      // Trouver dans /accounts par name ou prenom
      const global = accounts.find(a =>
        String(a.name || '').trim() === name ||
        String(a.prenom || '').trim() === name
      );

      if (!global) {
        console.log(`  ⚠️  "${name}" : pas de compte global trouvé — ignoré`);
        summary.push({ orgId, name, status: 'SKIP (pas de global)' });
        continue;
      }

      let patched = [];

      // Patch nom
      if (!leg.nom && global.nom) {
        legacy[i].nom = global.nom;
        patched.push(`nom="${global.nom}"`);
        changed = true;
      }

      // Patch email
      if (!leg.email && global.email) {
        legacy[i].email = global.email;
        patched.push(`email="${global.email}"`);
        changed = true;
      }

      // Patch pseudo
      if (!leg.pseudo && global.pseudo) {
        legacy[i].pseudo = global.pseudo;
        patched.push(`pseudo="${global.pseudo}"`);
        changed = true;
      }

      if (patched.length > 0) {
        console.log(`  [PATCH] "${name}" : ${patched.join(', ')}`);
        summary.push({ orgId, name, status: 'PATCH', detail: patched.join(', ') });
      } else {
        console.log(`  [SKIP]  "${name}" : déjà complet`);
        summary.push({ orgId, name, status: 'SKIP' });
      }
    }

    if (changed) {
      await firebasePut(`orgs/${orgId}/adminConfig/accounts`, legacy, token);
      console.log(`  💾 Legacy [${orgId}] sauvegardé\n`);
    } else {
      console.log(`  ✅ Aucune modification nécessaire\n`);
    }
  }

  console.log('────────── Résumé ──────────');
  for (const row of summary) {
    const detail = row.detail ? ` — ${row.detail}` : '';
    console.log(`  [${row.status}] ${row.orgId}/${row.name}${detail}`);
  }

  console.log('\nPatch terminé.');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
