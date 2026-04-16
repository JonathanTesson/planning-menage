/**
 * Initialisation one-shot : compte de test global /accounts/account-test-jonath.
 *
 * Usage (avec secret JSON dans l'environnement) :
 *   set FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
 *   node init-accounts.js
 *
 * PowerShell :
 *   $env:FIREBASE_SERVICE_ACCOUNT = Get-Content ".\Firebase\planning-menage-18b09-firebase.json" -Raw; node init-accounts.js
 */

const https = require('https');
const crypto = require('crypto');

const FIREBASE_DB_URL = 'https://planning-menage-18b09-default-rtdb.firebaseio.com';

const TEST_PASSWORD = 'test1234';

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

function sha256HexUtf8(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('  Init compte global de test (account-test-jonath)');
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

  const apiPath = 'accounts/account-test-jonath';
  const logPath = '/accounts/account-test-jonath';

  try {
    const existing = await firebaseGet(apiPath, token);
    if (existing != null) {
      console.log(`[SKIP] ${logPath} déjà présent`);
      summary.push({ path: logPath, status: 'SKIP' });
    } else {
      const pwdHash = sha256HexUtf8(TEST_PASSWORD);
      await firebasePut(apiPath, {
        nom: 'Tesson',
        prenom: 'Jonathan',
        pseudo: 'jonath-test',
        email: 'test@test.com',
        tel: '',
        defaultOrg: 'tesson',
        pwdHash,
        orgs: {
          tesson: {
            roles: ['menage', 'admin']
          }
        }
      }, token);
      console.log(`[OK] ${logPath} créé (pwdHash = SHA-256 de « ${TEST_PASSWORD} »)`);
      summary.push({ path: logPath, status: 'OK' });
    }
  } catch (e) {
    console.error(`✗ ${logPath} :`, e.message);
    summary.push({ path: logPath, status: 'erreur', detail: e.message });
    process.exit(1);
  }

  console.log('\n────────── Résumé ──────────');
  for (const row of summary) {
    const extra = row.detail ? ` — ${row.detail}` : '';
    console.log(`  [${row.status}] ${row.path}${extra}`);
  }
  console.log('\nInitialisation terminée.');
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
