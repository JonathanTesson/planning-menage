const https = require('https');
const http = require('http');

const STUDIO_NAMES_FALLBACK = ['Studio 1', 'Studio 2'];
const FIREBASE_DB_URL = 'https://planning-menage-18b09-default-rtdb.firebaseio.com';
const TELEGRAM_CHAT_ID = '-1002590523626';
const HISTORY_MONTHS = 24;

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

/**
 * Construit la liste des orgs à synchroniser : /organizations + /orgs/{id}/icalFeeds par org.
 * Retourne [{ id, label, feeds: [{ url, studio }] }] (feeds = [] si absent ou non tableau).
 */
async function loadOrgSync(token) {
  const rawOrgs = await firebaseGet('organizations', token);
  const orgMap = rawOrgs && typeof rawOrgs === 'object' && !Array.isArray(rawOrgs) ? rawOrgs : {};
  const ids = Object.keys(orgMap).sort((a, b) => {
    const la = (orgMap[a] && orgMap[a].label) || a;
    const lb = (orgMap[b] && orgMap[b].label) || b;
    return String(la).localeCompare(String(lb), 'fr');
  });
  const out = [];
  for (const id of ids) {
    const v = orgMap[id];
    const label = (v && v.label) || id;
    const feedsRaw = await firebaseGet(`orgs/${id}/icalFeeds`, token);
    let feeds = [];
    if (feedsRaw == null) feeds = [];
    else if (Array.isArray(feedsRaw)) feeds = feedsRaw;
    else if (typeof feedsRaw === 'object') {
      feeds = Object.keys(feedsRaw)
        .sort((a, b) => Number(a) - Number(b))
        .map(k => feedsRaw[k])
        .filter(x => x != null && typeof x === 'object');
    }
    out.push({ id, label, feeds });
  }
  return out;
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

function buildNewResaMessage(r, studioNames, orgLabel) {
  const nights = Math.round((new Date(r.end) - new Date(r.start)) / 86400000);
  const sn = studioNames[r.studio] || STUDIO_NAMES_FALLBACK[r.studio] || `S${r.studio + 1}`;
  return `🏠 <b>${orgLabel} — nouvelle réservation — ${sn}</b>\n` +
    `📅 Arrivée : ${formatDate(r.start)}\n` +
    `📅 Départ : ${formatDate(r.end)}\n` +
    `🌙 Durée : ${nights} nuit${nights > 1 ? 's' : ''}\n` +
    `👤 ${r.summary !== 'Réservation' ? r.summary : 'Voyageur non précisé'}`;
}

function buildCancelMessage(r, assignment, studioNames, orgLabel) {
  const names = [assignment?.c1, assignment?.c2].filter(Boolean);
  const intervenantes = names.length
    ? `👷 Intervenante${names.length > 1 ? 's' : ''} prévue${names.length > 1 ? 's' : ''} : ${names.join(' + ')}\n`
    : '';
  const sn = studioNames[r.studio] || STUDIO_NAMES_FALLBACK[r.studio] || `S${r.studio + 1}`;
  return `❌ <b>${orgLabel} — réservation annulée — ${sn}</b>\n` +
    `📅 Arrivée annulée : ${formatDate(r.start)}\n` +
    `📅 Départ annulé : ${formatDate(r.end)}\n` +
    `👤 ${r.summary !== 'Réservation' ? r.summary : 'Voyageur non précisé'}\n` +
    intervenantes;
}

async function syncOneOrg(org, token) {
  const base = `orgs/${org.id}`;
  const validFeeds = org.feeds.filter(f => f.url && String(f.url).trim());
  if (!validFeeds.length) {
    console.log(`⏭️ ${org.id} (${org.label}) : aucune URL iCal — sync ignorée (À compléter dans sync-ical.js)`);
    return;
  }

  let studioNames = [...STUDIO_NAMES_FALLBACK];
  let telegramEnabled = true;
  try {
    const cfg = await firebaseGet(`${base}/config`, token);
    if (cfg?.studioNames?.length) studioNames = cfg.studioNames;
  } catch (e) {
    console.warn(`⚠️ ${org.id} config illisible, noms studios par défaut`);
  }
  try {
    const ac = await firebaseGet(`${base}/adminConfig`, token);
    if (ac) telegramEnabled = ac.telegramEnabled !== false;
  } catch (e) {
    /* défaut : actif */
  }

  let existing = {};
  let assignments = {};
  try {
    existing = (await firebaseGet(`${base}/reservations`, token)) || {};
    assignments = (await firebaseGet(`${base}/assignments`, token)) || {};
    console.log(`📦 [${org.id}] ${Object.keys(existing).length} réservation(s) existantes`);
  } catch (e) {
    console.warn(`⚠️ [${org.id}] lecture existant:`, e.message);
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - HISTORY_MONTHS);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const merged = {};
  for (const [uid, r] of Object.entries(existing)) {
    if (r.end >= cutoffStr) merged[uid] = r;
  }

  const freshUids = new Set();
  for (const feed of validFeeds) {
    try {
      console.log(`📅 [${org.id}] Chargement studio ${feed.studio}...`);
      const text = await fetchUrl(feed.url);
      const resas = parseIcal(text, feed.studio);
      for (const r of resas) {
        freshUids.add(r.uid);
        merged[r.uid] = { ...(merged[r.uid] || {}), ...r };
      }
      console.log(`✅ [${org.id}] studio ${feed.studio}: ${resas.length} réservation(s) dans le flux`);
    } catch (e) {
      console.error(`❌ [${org.id}] studio ${feed.studio}:`, e.message);
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const notifications = [];

  for (const uid of freshUids) {
    if (!existing[uid] && merged[uid].end >= today) {
      console.log(`🆕 [${org.id}] Nouvelle réservation : ${uid}`);
      notifications.push(buildNewResaMessage(merged[uid], studioNames, org.label));
    }
  }

  for (const [uid, r] of Object.entries(existing)) {
    if (r.end >= today && !freshUids.has(uid)) {
      console.log(`❌ [${org.id}] Annulation : ${uid}`);
      const assignment = assignments[uid] || null;
      notifications.push(buildCancelMessage(r, assignment, studioNames, org.label));
      delete merged[uid];
    }
  }

  if (notifications.length === 0) {
    console.log(`📭 [${org.id}] Aucun changement — pas de notification`);
  } else if (!telegramEnabled) {
    console.log(`🔕 [${org.id}] ${notifications.length} changement(s) — Telegram désactivé pour cette org (admin)`);
  } else {
    console.log(`📬 [${org.id}] ${notifications.length} notification(s)`);
    for (const msg of notifications) {
      await sendTelegram(msg);
      await new Promise(r => setTimeout(r, 500));
    }
  }

  await firebasePut(`${base}/reservations`, merged, token);
  await firebasePut(`${base}/lastSync`, {
    ts: new Date().toISOString(),
    count: Object.keys(merged).length,
    notifications: notifications.length
  }, token);
  console.log(`✅ [${org.id}] Firebase mis à jour — ${Object.keys(merged).length} réservation(s)`);
}

async function main() {
  console.log('🔄 Sync iCal → Firebase (multi-organisations)...');

  let token;
  try {
    token = await getFirebaseToken();
    console.log('✅ Token Firebase obtenu');
  } catch (e) {
    console.error('❌ Erreur token Firebase:', e.message);
    process.exit(1);
  }

  const orgSync = await loadOrgSync(token);
  for (const org of orgSync) {
    try {
      await syncOneOrg(org, token);
    } catch (e) {
      console.error(`❌ [${org.id}] Erreur sync:`, e.message);
    }
  }
  console.log('🎉 Synchronisation terminée !');
}

main();
