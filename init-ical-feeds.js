/**
 * Initialisation one-shot : écriture des flux iCal sous /orgs/{orgId}/icalFeeds.
 * Ne modifie pas une entrée déjà présente (SKIP).
 *
 * Usage :
 *   set FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
 *   node init-ical-feeds.js
 */

const https = require('https');

const FIREBASE_DB_URL = 'https://planning-menage-18b09-default-rtdb.firebaseio.com';

/** Données alignées sur sync-ical.js (ORG_SYNC → feeds). */
const ICAL_FEEDS_BY_ORG = {
  tesson: [
    { url: 'https://www.airbnb.fr/calendar/ical/23714051.ics?s=1c507a926f8f63d87b20fea875da704e', studio: 0 },
    { url: 'https://www.airbnb.fr/calendar/ical/846411261288811527.ics?s=998c515b74309dda07f768a2083cf270', studio: 1 }
  ],
  nade: [
    { url: 'https://www.airbnb.fr/calendar/ical/14100888.ics?s=8deacda46a0d8789fd490d36d2273c47', studio: 0 },
    { url: 'https://www.airbnb.fr/calendar/ical/22488935.ics?s=c29e0c53f848194fac3b0fcb136157bd', studio: 1 }
  ]
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

async function main() {
  console.log('══════════════════════════════════════════════════════');
  console.log('  Init iCal feeds → /orgs/{orgId}/icalFeeds');
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
  const orgIds = Object.keys(ICAL_FEEDS_BY_ORG);

  for (const orgId of orgIds) {
    const apiPath = `orgs/${orgId}/icalFeeds`;
    const logPath = `/orgs/${orgId}/icalFeeds`;
    try {
      const existing = await firebaseGet(apiPath, token);
      if (existing != null) {
        console.log(`[SKIP] ${logPath} déjà présent`);
        summary.push({ path: logPath, status: 'SKIP' });
      } else {
        await firebasePut(apiPath, ICAL_FEEDS_BY_ORG[orgId], token);
        console.log(`[OK] ${logPath} créé (${ICAL_FEEDS_BY_ORG[orgId].length} flux)`);
        summary.push({ path: logPath, status: 'OK' });
      }
    } catch (e) {
      console.error(`✗ ${logPath} :`, e.message);
      summary.push({ path: logPath, status: 'erreur', detail: e.message });
      process.exit(1);
    }
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
