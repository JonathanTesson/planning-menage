const https = require('https');
const http = require('http');

const ICAL_URLS = [
  'https://www.airbnb.fr/calendar/ical/23714051.ics?s=1c507a926f8f63d87b20fea875da704e',
  'https://www.airbnb.fr/calendar/ical/846411261288811527.ics?s=998c515b74309dda07f768a2083cf270'
];

const FIREBASE_DB_URL = 'https://planning-menage-18b09-default-rtdb.firebaseio.com';

function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseIcal(text, studioIndex) {
  const reservations = [];
  const events = text.split('BEGIN:VEVENT').slice(1);
  for (const ev of events) {
    const uid = ((ev.match(/UID:([^\r\n]+)/) || [])[1] || '').trim();
    const summary = ((ev.match(/SUMMARY:([^\r\n]+)/) || [])[1] || 'Réservation').trim();
    const low = summary.toLowerCase();
    if (low.includes('not available') || low.includes('airbnb') || low.includes('unavailable')) continue;
    const dtstart = ((ev.match(/DTSTART(?:;[^:]*)?:([^\r\n]+)/) || [])[1] || '').trim();
    const dtend = ((ev.match(/DTEND(?:;[^:]*)?:([^\r\n]+)/) || [])[1] || '').trim();
    if (!dtstart || !dtend) continue;
    const parseDate = s => {
      const c = s.replace(/\D/g, '');
      return `${c.slice(0,4)}-${c.slice(4,6)}-${c.slice(6,8)}`;
    };
    const start = parseDate(dtstart);
    const end = parseDate(dtend);
    if (!start || !end) continue;
    const safeUid = uid.replace(/[.#$/\[\]]/g, '_');
    reservations.push({ uid: safeUid, summary, start, end, studio: studioIndex });
  }
  return reservations;
}

async function getFirebaseToken() {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  const { private_key, client_email } = serviceAccount;

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
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${header}.${body}`;

  const crypto = require('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(private_key, 'base64url');
  const jwt = `${signingInput}.${signature}`;

  const tokenData = await new Promise((resolve, reject) => {
    const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': postData.length }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  return tokenData.access_token;
}

async function writeToFirebase(path, data, token) {
  const body = JSON.stringify(data);
  const url = new URL(`${FIREBASE_DB_URL}/${path}.json`);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + '?access_token=' + token,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(d));
        else reject(new Error('Firebase write error: ' + res.statusCode + ' ' + d));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('🔄 Démarrage de la synchronisation iCal → Firebase...');

  let token;
  try {
    token = await getFirebaseToken();
    console.log('✅ Token Firebase obtenu');
  } catch (e) {
    console.error('❌ Erreur token Firebase:', e.message);
    process.exit(1);
  }

  const allReservations = [[], []];
  for (let i = 0; i < ICAL_URLS.length; i++) {
    try {
      console.log(`📅 Chargement Studio ${i + 1}...`);
      const text = await fetchUrl(ICAL_URLS[i]);
      allReservations[i] = parseIcal(text, i);
      console.log(`✅ Studio ${i + 1}: ${allReservations[i].length} réservation(s)`);
    } catch (e) {
      console.error(`❌ Studio ${i + 1} erreur:`, e.message);
    }
  }

  const flat = [...allReservations[0], ...allReservations[1]];
  const asObject = {};
  for (const r of flat) asObject[r.uid] = r;

  try {
    await writeToFirebase('reservations', asObject, token);
    await writeToFirebase('lastSync', { ts: new Date().toISOString(), count: flat.length }, token);
    console.log(`✅ ${flat.length} réservation(s) écrites dans Firebase`);
    console.log('🎉 Synchronisation terminée !');
  } catch (e) {
    console.error('❌ Erreur écriture Firebase:', e.message);
    process.exit(1);
  }
}

main();
