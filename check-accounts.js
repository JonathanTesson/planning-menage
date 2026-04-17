/**
 * Vérification de la cohérence des comptes /accounts vs legacy
 * Usage :
 *   $env:FIREBASE_SERVICE_ACCOUNT = Get-Content ".\Firebase\planning-menage-18b09-firebase.json" -Raw; node check-accounts.js
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

function ok(msg)   { console.log(`  ✅ ${msg}`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }
function err(msg)  { console.log(`  ❌ ${msg}`); }

async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('  Vérification cohérence comptes /accounts vs legacy');
  console.log('══════════════════════════════════════════════════════\n');

  const token = await getFirebaseToken();

  // Charger /accounts
  const accountsRaw = await firebaseGet('accounts', token);
  const accounts = accountsRaw
    ? Object.entries(accountsRaw).map(([id, v]) => ({ id, ...v }))
    : [];

  // Charger /organizations
  const orgsRaw = await firebaseGet('organizations', token);
  const orgIds = orgsRaw ? Object.keys(orgsRaw) : [];

  console.log(`📦 ${accounts.length} compte(s) dans /accounts`);
  console.log(`🏢 ${orgIds.length} organisation(s) : ${orgIds.join(', ')}\n`);

  // Vérification de chaque compte global
  console.log('── Vérification /accounts ──────────────────────────');
  for (const acc of accounts) {
    const label = `[${acc.name || acc.prenom || acc.id}]`;
    console.log(`\n👤 ${label}`);

    // Champs obligatoires
    if (!acc.email)      warn('email manquant');
    else                 ok(`email: ${acc.email}`);

    if (!acc.pseudo)     warn('pseudo manquant');
    else                 ok(`pseudo: ${acc.pseudo}`);

    if (!acc.pwdHash)    err('pwdHash manquant !');
    else                 ok('pwdHash présent');

    if (!acc.defaultOrg) warn('defaultOrg manquant');
    else                 ok(`defaultOrg: ${acc.defaultOrg}`);

    if (!acc.orgs || !Object.keys(acc.orgs).length)
                         err('aucune org associée !');
    else                 ok(`orgs: ${Object.keys(acc.orgs).join(', ')}`);
  }

  // Vérification doublons pseudo
  console.log('\n── Vérification doublons pseudo ────────────────────');
  const pseudos = {};
  for (const acc of accounts) {
    const p = String(acc.pseudo || '').trim();
    if (!p) continue;
    if (!pseudos[p]) pseudos[p] = [];
    pseudos[p].push(acc.name || acc.prenom || acc.id);
  }
  let doublons = 0;
  for (const [p, names] of Object.entries(pseudos)) {
    if (names.length > 1) {
      err(`Pseudo "${p}" utilisé par : ${names.join(', ')}`);
      doublons++;
    }
  }
  if (!doublons) ok('Aucun doublon de pseudo');

  // Vérification cohérence legacy par org
  console.log('\n── Vérification cohérence legacy par org ───────────');
  for (const orgId of orgIds) {
    const legacyRaw = await firebaseGet(`orgs/${orgId}/adminConfig/accounts`, token);
    const legacy = legacyRaw
      ? (Array.isArray(legacyRaw) ? legacyRaw : Object.values(legacyRaw))
      : [];

    console.log(`\n🏢 ${orgId} — ${legacy.length} compte(s) legacy`);

    for (const leg of legacy) {
      const name = leg.name || '?';
      // Chercher dans /accounts
      const match = accounts.find(a =>
        String(a.name || '').trim() === name ||
        String(a.prenom || '').trim() === name
      );
      if (!match) {
        warn(`"${name}" est dans legacy mais PAS dans /accounts`);
      } else {
        // Vérifier que l'org est bien dans /accounts
        if (!match.orgs || !match.orgs[orgId]) {
          warn(`"${name}" trouvé dans /accounts mais org "${orgId}" manquante dans orgs{}`);
        } else {
          ok(`"${name}" cohérent (legacy + /accounts + org)`);
        }
        // Vérifier nom et email
        if (!leg.nom)   warn(`"${name}" : nom manquant dans legacy`);
        if (!leg.email) warn(`"${name}" : email manquant dans legacy`);
        if (!leg.pseudo) warn(`"${name}" : pseudo manquant dans legacy`);
      }
    }

    // Comptes dans /accounts avec cette org mais absents du legacy
    const inGlobalNotLegacy = accounts.filter(a =>
      a.orgs && a.orgs[orgId] &&
      !legacy.find(l => String(l.name||'').trim() === String(a.name||a.prenom||'').trim())
    );
    for (const a of inGlobalNotLegacy) {
      warn(`"${a.name||a.prenom}" est dans /accounts (org: ${orgId}) mais PAS dans legacy`);
    }
  }

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Vérification terminée');
  console.log('══════════════════════════════════════════════════════');
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
