const https = require('https');

const STUDIO_NAMES = ['Studio 1', 'Studio 2'];
const FIREBASE_DB_URL = 'https://planning-menage-18b09-default-rtdb.firebaseio.com';
const TELEGRAM_CHAT_ID = '-1002590523626';

// ─── HTTP helper ──────────────────────────────────────────────────────────────

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

// ─── Firebase ────────────────────────────────────────────────────────────────

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

// ─── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) { console.warn('⚠️ TELEGRAM_BOT_TOKEN manquant'); return; }
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

function daysBetween(dateStr1, dateStr2) {
  return Math.round((new Date(dateStr2) - new Date(dateStr1)) / 86400000);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔔 Vérification des départs du jour...');

  // Date d'aujourd'hui en format YYYY-MM-DD (UTC)
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 Aujourd'hui : ${today}`);

  let token;
  try {
    token = await getFirebaseToken();
    console.log('✅ Token Firebase obtenu');
  } catch (e) {
    console.error('❌ Erreur token Firebase:', e.message);
    process.exit(1);
  }

  // Charger réservations et assignations
  let reservations = {}, assignments = {};
  try {
    reservations = (await firebaseGet('reservations', token)) || {};
    assignments = (await firebaseGet('assignments', token)) || {};
    console.log(`📦 ${Object.keys(reservations).length} réservation(s) chargées`);
  } catch (e) {
    console.error('❌ Erreur lecture Firebase:', e.message);
    process.exit(1);
  }

  // Trouver les départs d'aujourd'hui
  const departsAujourdhui = Object.values(reservations).filter(r => r.end === today);

  if (departsAujourdhui.length === 0) {
    console.log('📭 Aucun départ aujourd\'hui — pas de notification');
    return;
  }

  console.log(`🚪 ${departsAujourdhui.length} départ(s) aujourd'hui`);

  // Pour chaque départ, trouver la prochaine arrivée dans le même studio
  for (const r of departsAujourdhui) {
    const assignment = assignments[r.uid] || {};
    const c1 = assignment.c1 || null;
    const c2 = assignment.c2 || null;
    const note = assignment.note || '';

    // Trouver la prochaine réservation dans ce studio
    const prochainesResas = Object.values(reservations)
      .filter(x => x.studio === r.studio && x.start > today)
      .sort((a, b) => a.start.localeCompare(b.start));
    const prochaine = prochainesResas[0] || null;

    // Construire le message
    const studioEmoji = r.studio === 0 ? '1️⃣' : '2️⃣';
    const intervenantes = [c1, c2].filter(Boolean);

    let msg = `${studioEmoji} <b>Départ aujourd'hui — ${STUDIO_NAMES[r.studio]}</b>\n\n`;

    if (r.summary && r.summary !== 'Réservation') {
      msg += `👤 Voyageur : ${r.summary}\n`;
    }

    msg += `📅 Départ : ${formatDate(r.end)}\n`;

    if (prochaine) {
      const joursAvant = daysBetween(today, prochaine.start);
      if (joursAvant === 0) {
        msg += `📅 Prochaine arrivée : <b>aujourd'hui même !</b>\n`;
      } else if (joursAvant === 1) {
        msg += `📅 Prochaine arrivée : <b>demain</b> (${formatDate(prochaine.start)})\n`;
      } else {
        msg += `📅 Prochaine arrivée : dans <b>${joursAvant} jours</b> (${formatDate(prochaine.start)})\n`;
      }
    } else {
      msg += `📅 Prochaine arrivée : <b>aucune prévue</b>\n`;
    }

    if (intervenantes.length > 0) {
      msg += `\n🧹 Intervenante${intervenantes.length > 1 ? 's' : ''} : <b>${intervenantes.join(' + ')}</b>`;
    } else {
      msg += `\n⚠️ <b>Aucune intervenante assignée !</b>`;
    }

    if (note) {
      msg += `\n📝 Note : ${note}`;
    }

    console.log(`📤 Envoi notification départ ${STUDIO_NAMES[r.studio]}...`);
    await sendTelegram(msg);
    await new Promise(res => setTimeout(res, 500));
  }

  console.log('🎉 Notifications départs terminées !');
}

main();
