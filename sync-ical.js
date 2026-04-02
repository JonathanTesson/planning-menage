const https = require('https');
const http = require('http');

const ICAL_URLS = [
  'https://www.airbnb.fr/calendar/ical/23714051.ics?s=1c507a926f8f63d87b20fea875da704e',
  'https://www.airbnb.fr/calendar/ical/846411261288811527.ics?s=998c515b74309dda07f768a2083cf270'
];

const STUDIO_NAMES = ['Studio 1', 'Studio 2'];
const FIREBASE_DB_URL = 'https://planning-menage-18b09-default-rtdb.firebaseio.com';
const TELEGRAM_CHAT_ID = '-1002590523626';
const HISTORY_MONTHS = 24;

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
        return fetchUrl(res.headers.location, redirectCount + 1).then(resolve).catch(reject);
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
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

// ─── iCal parser ─────────────────────────────────────────────────────────────

function parseIcal(text, studioIndex) {
  const reservations = [];
  for (const ev of text.split('BEGIN:VEVENT').slice(1)) {
    const uid = ((ev.match(/UID:([^\r\n]+)/) || [])[1] || '').trim();
    const summary = ((ev.match(/SUMMARY:([^\r\n]+)/) || [])[1] || 'Réservation').trim();
    const low = summary.toLowerCase();
    if (low.includes('not available') || low.includes('airbnb') || low.includes('unavailable')) continue;
    const dtstart = ((ev.match(/DTSTART(?:;[^:]*)?:([^\r\n]+)/) || [])[1] || '').trim();
    const dtend = ((ev.match(/DTEND(?:;[^:]*)?:([^\r\n]+)/) || [])[1] || '').trim();
    if (!dtstart || !dtend) continue;
    const pd = s => { const c = s.replace(/\D/g, ''); return `${c.slice(0,4)}-${c.slice(4,6)}-${c.slice(6,8)}`; };
    const start = pd(dtstart), end = pd(dtend);
    if (!start || !end) continue;
    const safeUid = uid.replace(/[.#$/\[\]]/g, '_');
    reservations.push({ uid: safeUid, summary, start, end, studio: studioIndex });
  }
  return reservations;
}

// ─── Firebase helpers ─────────────────────────────────────────────────────────

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
  if (res.status !== 200) throw new Error('Firebase PUT error: ' + res.status + ' ' + res.body);
  return JSON.parse(res.body);
}

// ─── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.warn('⚠️ TELEGRAM_BOT_TOKEN manquant, notification ignorée'); return; }
  const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' });
  try {
    const res = await httpRequest({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, body);
    const result = JSON.parse(res.body);
    if (result.ok) console.log('✅ Telegram envoyé');
    else console.warn('⚠️ Telegram erreur:', result.description);
  } catch (e) {
    console.warn('⚠️ Telegram échec:', e.message);
  }
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function buildNewResaMessage(r) {
  const nights = Math.round((new Date(r.end) - new Date(r.start)) / 86400000);
  return `🏠 <b>Nouvelle réservation — ${STUDIO_NAMES[r.studio]}</b>\n` +
    `📅 Arrivée : ${formatDate(r.start)}\n` +
    `📅 Départ : ${formatDate(r.end)}\n` +
    `🌙 Durée : ${nights} nuit${nights > 1 ? 's' : ''}\n` +
    `👤 ${r.summary !== 'Réservation' ? r.summary : 'Voyageur non précisé'}`;
}

function buildCancelMessage(r, assignment) {
  const names = [assignment?.c1, assignment?.c2].filter(Boolean);
  const intervenantes = names.length
    ? `👷 Intervenante${names.length > 1 ? 's' : ''} prévue${names.length > 1 ? 's' : ''} : ${names.join(' + ')}\n`
    : '';
  return `❌ <b>Réservation annulée — ${STUDIO_NAMES[r.studio]}</b>\n` +
    `📅 Arrivée annulée : ${formatDate(r.start)}\n` +
    `📅 Départ annulé : ${formatDate(r.end)}\n` +
    `👤 ${r.summary !== 'Réservation' ? r.summary : 'Voyageur non précisé'}\n` +
    intervenantes;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔄 Sync iCal → Firebase v3 (avec notifications Telegram)...');

  let token;
  try {
    token = await getFirebaseToken();
    console.log('✅ Token Firebase obtenu');
  } catch (e) {
    console.error('❌ Erreur token Firebase:', e.message);
    process.exit(1);
  }

  // Charger les réservations existantes
  let existing = {};
  let assignments = {};
  try {
    existing = (await firebaseGet('reservations', token)) || {};
    assignments = (await firebaseGet('assignments', token)) || {};
    console.log(`📦 ${Object.keys(existing).length} réservation(s) existantes dans Firebase`);
  } catch (e) {
    console.warn('⚠️ Impossible de lire les données existantes:', e.message);
  }

  // Cutoff historique
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - HISTORY_MONTHS);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  // Garder les réservations dans la fenêtre d'historique
  const merged = {};
  for (const [uid, r] of Object.entries(existing)) {
    if (r.end >= cutoffStr) merged[uid] = r;
  }

  // Fetch nouveaux iCal
  const freshUids = new Set();
  for (let i = 0; i < ICAL_URLS.length; i++) {
    try {
      console.log(`📅 Chargement ${STUDIO_NAMES[i]}...`);
      const text = await fetchUrl(ICAL_URLS[i]);
      const resas = parseIcal(text, i);
      for (const r of resas) {
        freshUids.add(r.uid);
        merged[r.uid] = { ...(merged[r.uid] || {}), ...r };
      }
      console.log(`✅ ${STUDIO_NAMES[i]}: ${resas.length} réservation(s)`);
    } catch (e) {
      console.error(`❌ ${STUDIO_NAMES[i]} erreur:`, e.message);
    }
  }

  // ── Détecter les changements ──────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const notifications = [];

  // Nouvelles réservations (dans le futur uniquement)
  for (const uid of freshUids) {
    if (!existing[uid] && merged[uid].end >= today) {
      console.log(`🆕 Nouvelle réservation détectée : ${uid}`);
      notifications.push(buildNewResaMessage(merged[uid]));
    }
  }

  // Annulations : réservations futures qui étaient dans existing mais plus dans fresh
  for (const [uid, r] of Object.entries(existing)) {
    if (r.end >= today && !freshUids.has(uid)) {
      console.log(`❌ Annulation détectée : ${uid}`);
      const assignment = assignments[uid] || null;
      notifications.push(buildCancelMessage(r, assignment));
      // On supprime la réservation annulée de Firebase
      delete merged[uid];
    }
  }

  // Envoyer les notifications Telegram
  if (notifications.length === 0) {
    console.log('📭 Aucun changement détecté — pas de notification');
  } else {
    console.log(`📬 ${notifications.length} notification(s) à envoyer`);
    for (const msg of notifications) {
      await sendTelegram(msg);
      // Petite pause entre les messages
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Écrire dans Firebase
  try {
    await firebasePut('reservations', merged, token);
    await firebasePut('lastSync', {
      ts: new Date().toISOString(),
      count: Object.keys(merged).length,
      notifications: notifications.length
    }, token);
    console.log(`✅ Firebase mis à jour — ${Object.keys(merged).length} réservation(s)`);
    console.log('🎉 Synchronisation terminée !');
  } catch (e) {
    console.error('❌ Erreur écriture Firebase:', e.message);
    process.exit(1);
  }
}

main();
