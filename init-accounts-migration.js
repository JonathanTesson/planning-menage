/**
 * Migration one-shot : comptes legacy → /accounts/{pushId}.
 * Ne modifie pas /orgs/.../adminConfig/accounts (lecture + vérif hashSimple uniquement).
 *
 * Usage :
 *   set FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
 *   node init-accounts-migration.js
 *
 * PowerShell :
 *   $env:FIREBASE_SERVICE_ACCOUNT = Get-Content ".\Firebase\planning-menage-18b09-firebase.json" -Raw; node init-accounts-migration.js
 */

const https = require('https');
const crypto = require('crypto');

const FIREBASE_DB_URL = 'https://planning-menage-18b09-default-rtdb.firebaseio.com';

/** Identique à admin.html — les pwdHash legacy en base ont été générés ainsi. */
function hashSimple(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i), h |= 0;
  return h.toString(36);
}

function sha256HexUtf8(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

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

async function firebasePost(path, data, token) {
  const body = JSON.stringify(data);
  const res = await httpRequest({
    hostname: new URL(FIREBASE_DB_URL).hostname,
    path: `/${path}.json?access_token=${token}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error('POST ' + res.status + ' ' + res.body);
  const j = JSON.parse(res.body);
  if (!j.name) throw new Error('POST sans clé name: ' + res.body);
  return j.name;
}

function accountsArrayFromAdminConfig(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'object') return Object.keys(raw).map(k => raw[k]).filter(Boolean);
  return [];
}

function accountsMapToEntries(val) {
  if (!val || typeof val !== 'object') return [];
  return Object.entries(val).filter(([, v]) => v && typeof v === 'object').map(([id, v]) => ({ id, ...v }));
}

function hasAccountNameInGlobalAccounts(globalVal, prenom) {
  const p = String(prenom || '').trim();
  const entries = accountsMapToEntries(globalVal);
  return entries.some(row => String(row.name ?? '').trim() === p);
}

/**
 * legacyVerifyOrg : org où lire adminConfig.accounts pour la vérif (Jonath → tesson uniquement).
 */
const MIGRATIONS = [
  { name: 'Jonath', nom: 'Tesson', mdp: '9324', orgs: { tesson: { roles: ['menage', 'admin'] }, nade: { roles: ['menage', 'admin'] } }, defaultOrg: 'tesson', legacyVerifyOrg: 'tesson' },
  { name: 'Steffie', nom: 'Tesson', mdp: '9324', orgs: { tesson: { roles: ['menage', 'admin'] } }, defaultOrg: 'tesson' },
  { name: 'Mireille', nom: '', mdp: '1111', orgs: { tesson: { roles: ['menage'] } }, defaultOrg: 'tesson' },
  { name: 'Emmy', nom: '', mdp: '1111', orgs: { tesson: { roles: ['menage'] } }, defaultOrg: 'tesson' },
  { name: 'Valérie', nom: '', mdp: '1111', orgs: { tesson: { roles: ['menage'] } }, defaultOrg: 'tesson' },
  { name: 'Christelle', nom: '', mdp: '1111', orgs: { tesson: { roles: ['menage'] } }, defaultOrg: 'tesson' },
  { name: 'Nade', nom: 'Jolly', mdp: '9999', orgs: { nade: { roles: ['menage', 'admin'] } }, defaultOrg: 'nade' },
  { name: 'Solene', nom: '', mdp: '2222', orgs: { nade: { roles: ['menage'] } }, defaultOrg: 'nade' },
  { name: 'Clémentine', nom: '', mdp: '1111', orgs: { zencles: { roles: ['menage', 'admin'] } }, defaultOrg: 'zencles' },
  { name: 'Floriandre', nom: '', mdp: '1111', orgs: { zencles: { roles: ['menage', 'admin'] } }, defaultOrg: 'zencles' }
];

function verifyLegacyAccount(accountsArr, prenom, plainMdp) {
  const p = String(prenom || '').trim();
  const expected = hashSimple(plainMdp);
  for (const a of accountsArr) {
    if (!a || typeof a !== 'object') continue;
    if (String(a.name ?? '').trim() !== p) continue;
    const stored = a.pwdHash != null ? String(a.pwdHash) : '';
    return { found: true, hashOk: stored === expected };
  }
  return { found: false, hashOk: false };
}

async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('  Migration comptes → /accounts (one-shot)');
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

  let globalSnap;
  try {
    globalSnap = await firebaseGet('accounts', token);
  } catch (e) {
    console.error('✗ Lecture /accounts :', e.message);
    process.exit(1);
  }

  for (const row of MIGRATIONS) {
    const prenom = row.name;
    const logLabel = `${prenom} (${row.defaultOrg})`;
    const verifyOrg = row.legacyVerifyOrg || row.defaultOrg;
    const pathBase = `/accounts/{pushId} pour ${prenom}`;

    if (hasAccountNameInGlobalAccounts(globalSnap, prenom)) {
      console.log(`[SKIP] ${logLabel} — déjà un compte global avec name="${prenom}"`);
      summary.push({ path: pathBase, status: 'SKIP', detail: 'doublon name dans /accounts' });
      continue;
    }

    let legacyWarn = false;
    try {
      const adminCfg = await firebaseGet(`orgs/${verifyOrg}/adminConfig`, token);
      const arr = accountsArrayFromAdminConfig(adminCfg && adminCfg.accounts);
      const v = verifyLegacyAccount(arr, prenom, row.mdp);
      if (!v.found) {
        console.log(`[WARN] ${logLabel} — legacy introuvable sous /orgs/${verifyOrg}/adminConfig/accounts (création /accounts quand même)`);
        legacyWarn = true;
      } else if (!v.hashOk) {
        console.log(`[WARN] ${logLabel} — legacy trouvé mais pwdHash ≠ hashSimple(mdp) (création /accounts quand même)`);
        legacyWarn = true;
      }
    } catch (e) {
      console.log(`[WARN] ${logLabel} — erreur lecture legacy: ${e.message} (création /accounts quand même)`);
      legacyWarn = true;
    }

    const payload = {
      name: prenom,
      nom: row.nom != null ? String(row.nom) : '',
      pseudo: prenom,
      email: '',
      tel: '',
      pwdHash: sha256HexUtf8(row.mdp),
      orgs: row.orgs,
      defaultOrg: row.defaultOrg
    };

    let pushId;
    try {
      pushId = await firebasePost('accounts', payload, token);
    } catch (e) {
      console.error(`✗ ${logLabel} :`, e.message);
      summary.push({ path: pathBase, status: 'erreur', detail: e.message });
      process.exit(1);
    }

    console.log(`[OK] ${logLabel} → /accounts/${pushId}${legacyWarn ? ' (avec avertissement legacy)' : ''}`);
    summary.push({
      path: `/accounts/${pushId} (${prenom})`,
      status: legacyWarn ? 'OK+WARN' : 'OK',
      detail: legacyWarn ? 'legacy non confirmé' : ''
    });

    globalSnap = await firebaseGet('accounts', token);
  }

  console.log('\n────────── Résumé ──────────');
  for (const row of summary) {
    const extra = row.detail ? ` — ${row.detail}` : '';
    console.log(`  [${row.status}] ${row.path}${extra}`);
  }
  console.log('\nMigration terminée.');
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
