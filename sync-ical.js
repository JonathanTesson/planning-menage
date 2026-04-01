const https = require('https');
const http = require('http');

const ICAL_URLS = [
  'https://www.airbnb.fr/calendar/ical/23714051.ics?s=1c507a926f8f63d87b20fea875da704e',
  'https://www.airbnb.fr/calendar/ical/846411261288811527.ics?s=998c515b74309dda07f768a2083cf270'
];

const FIREBASE_DB_URL = 'https://planning-menage-18b09-default-rtdb.firebaseio.com';

// Garde les réservations jusqu'à 24 mois dans le passé
const HISTORY_MONTHS = 24;

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
  const signature = sign.sign(private_key, 'base64url');
  const jwt = `${signingInput}.${signature}`;
  const tokenData = await new Promise((resolve, reject) => {
    const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': postData.length }
    }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject); req.write(postData); req.end();
  });
  return tokenData.access_token;
}

async function firebaseGet(path, token) {
  const url = new URL(`${FIREBASE_DB_URL}/${path}.json`);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + '?access_token=' + token,
      method: 'GET'
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(d === 'null' ? null : JSON.parse(d));
        else reject(new Error('Firebase GET error: ' + res.statusCode));
      });
    });
    req.on('error', reject); req.end();
  });
}

async function firebasePut(path, data, token) {
  const body = JSON.stringify(data);
  const url = new URL(`${FIREBASE_DB_URL}/${path}.json`);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + '?access_token=' + token,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(d));
        else reject(new Error('Firebase PUT error: ' + res.statusCode + ' ' + d));
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}

async function main() {
  console.log('🔄 Démarrage de la synchronisation iCal → Firebase (mode fusion)...');

  let token;
  try {
    token = await getFirebaseToken();
    console.log('✅ Token Firebase obtenu');
  } catch (e) {
    console.error('❌ Erreur token Firebase:', e.message);
    process.exit(1);
  }

  // Charger les réservations existantes dans Firebase
  let existing = {};
  try {
    const data = await firebaseGet('reservations', token);
    existing = data || {};
    console.log(`📦 ${Object.keys(existing).length} réservation(s) existante(s) dans Firebase`);
  } catch (e) {
    console.warn('⚠️ Impossible de lire les réservations existantes:', e.message);
  }

  // Calculer la date limite de conservation (24 mois en arrière)
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - HISTORY_MONTHS);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  console.log(`📅 Conservation des réservations depuis : ${cutoffStr}`);

  // Filtrer les existantes — garder uniquement celles dans la fenêtre d'historique
  const merged = {};
  let keptOld = 0;
  for (const [uid, r] of Object.entries(existing)) {
    if (r.end >= cutoffStr) {
      merged[uid] = r;
      keptOld++;
    }
  }
  console.log(`♻️ ${keptOld} réservation(s) historiques conservées`);

  // Charger et parser les nouveaux iCal
  let newCount = 0;
  let updatedCount = 0;
  for (let i = 0; i < ICAL_URLS.length; i++) {
    try {
      console.log(`📅 Chargement Studio ${i + 1}...`);
      const text = await fetchUrl(ICAL_URLS[i]);
      const resas = parseIcal(text, i);
      for (const r of resas) {
        if (merged[r.uid]) {
          // Mise à jour des données Airbnb mais on preserve l'uid
          const wasNew = !existing[r.uid];
          merged[r.uid] = { ...merged[r.uid], ...r };
          if (wasNew) newCount++; else updatedCount++;
        } else {
          merged[r.uid] = r;
          newCount++;
        }
      }
      console.log(`✅ Studio ${i + 1}: ${resas.length} réservation(s) depuis Airbnb`);
    } catch (e) {
      console.error(`❌ Studio ${i + 1} erreur:`, e.message);
    }
  }

  const total = Object.keys(merged).length;
  console.log(`📊 Total après fusion : ${total} réservation(s) (${newCount} nouvelles, ${updatedCount} mises à jour)`);

  // Écrire dans Firebase
  try {
    await firebasePut('reservations', merged, token);
    await firebasePut('lastSync', {
      ts: new Date().toISOString(),
      count: total,
      newCount,
      updatedCount
    }, token);
    console.log(`✅ Firebase mis à jour avec ${total} réservation(s)`);
    console.log('🎉 Synchronisation terminée !');
  } catch (e) {
    console.error('❌ Erreur écriture Firebase:', e.message);
    process.exit(1);
  }
}

main();
