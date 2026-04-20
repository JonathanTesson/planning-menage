/**
 * update-accounts-auth.js
 * Script one-shot — mise à jour emails Firebase Auth et suppression de comptes.
 *
 * Prérequis :
 *   npm install  (firebase-admin)
 *   Firebase/service-account.json présent (ou variable FIREBASE_SERVICE_ACCOUNT)
 *   update-accounts-auth.local.js rempli (cf update-accounts-auth.template.js)
 *
 * Usage :
 *   npm run update-auth          (dry-run)
 *   npm run update-auth:apply    (exécution réelle)
 *
 *   node update-accounts-auth.js
 *   node update-accounts-auth.js --apply
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const DRY_RUN = !process.argv.includes('--apply');
const serviceAccountPath = path.join(__dirname, 'Firebase', 'service-account.json');
const operationsPath = path.join(__dirname, 'update-accounts-auth.local.js');
const reportPath = path.join(__dirname, 'update-report.local.json');

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (e) {
      console.error('❌ FIREBASE_SERVICE_ACCOUNT invalide (JSON attendu).');
      process.exit(1);
    }
  }
  if (!fs.existsSync(serviceAccountPath)) {
    console.error(`❌ Compte de service introuvable : ${serviceAccountPath}`);
    console.error('   Ou définissez la variable d\'environnement FIREBASE_SERVICE_ACCOUNT.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
}

function loadOperations() {
  if (!fs.existsSync(operationsPath)) {
    console.error(`❌ Fichier introuvable : ${operationsPath}`);
    console.error('   Copiez update-accounts-auth.template.js vers update-accounts-auth.local.js puis adaptez.');
    process.exit(1);
  }
  try {
    delete require.cache[require.resolve(operationsPath)];
    return require(operationsPath);
  } catch (e) {
    console.error('❌ Impossible de charger update-accounts-auth.local.js :', e.message);
    process.exit(1);
  }
}

function normalizeEmail(s) {
  if (s == null || s === '') return '';
  return String(s).trim().toLowerCase();
}

function entryTimestamp() {
  return new Date().toISOString();
}

function labelPrenom(op, data) {
  if (op && op.prenom) return String(op.prenom).trim();
  if (!data || typeof data !== 'object') return '—';
  return String(data.name || data.prenom || '—').trim();
}

function summarize(entries, dryRun) {
  let updated = 0;
  let deleted = 0;
  let skipped = 0;
  let errors = 0;
  let plannedUpdates = 0;
  let plannedDeletes = 0;

  for (const e of entries) {
    const s = e.status;
    if (['updated', 'updated-auth-only', 'updated-rtdb-only'].includes(s)) updated++;
    else if (['deleted', 'rtdb-only-deleted'].includes(s)) deleted++;
    else if (['already-updated', 'already-deleted'].includes(s)) skipped++;
    else if (s === 'error') errors++;
    else if (s === 'dry-run-would-update') plannedUpdates++;
    else if (s === 'dry-run-would-delete') plannedDeletes++;
  }

  const summary = {
    updated,
    deleted,
    skipped,
    errors,
  };
  if (dryRun) {
    summary.plannedUpdates = plannedUpdates;
    summary.plannedDeletes = plannedDeletes;
  }
  return summary;
}

async function runUpdateEmail(op, dryRun) {
  const accId = op.accId;
  const targetRaw = op.newEmail != null ? String(op.newEmail) : '';
  const newEmail = normalizeEmail(targetRaw);
  const ts = entryTimestamp();
  const base = {
    accId,
    prenom: labelPrenom(op, null),
    type: 'updateEmail',
    timestamp: ts,
  };

  if (!accId) {
    return {
      ...base,
      before: null,
      after: { target: newEmail },
      status: 'error',
      error: 'accId manquant',
    };
  }
  if (!newEmail) {
    return {
      ...base,
      before: null,
      after: { target: newEmail },
      status: 'error',
      error: 'newEmail vide',
    };
  }

  const accRef = admin.database().ref(`/accounts/${accId}`);
  const snap = await accRef.once('value');
  const data = snap.val();

  if (!data || typeof data !== 'object') {
    return {
      ...base,
      prenom: labelPrenom(op, data),
      before: null,
      after: { target: newEmail },
      status: 'error',
      error: 'Compte absent dans /accounts',
    };
  }

  base.prenom = labelPrenom(op, data);

  const authUid = data.authUid != null ? String(data.authUid).trim() : '';
  const rtdbEmail = normalizeEmail(data.email);

  if (!authUid) {
    return {
      ...base,
      before: { auth: null, rtdb: rtdbEmail || null },
      after: { target: newEmail },
      status: 'error',
      error: 'authUid manquant',
    };
  }

  let authEmailNorm = '';
  try {
    const userRecord = await admin.auth().getUser(authUid);
    authEmailNorm = normalizeEmail(userRecord.email);
  } catch (e) {
    return {
      ...base,
      before: { auth: null, rtdb: rtdbEmail || null },
      after: { target: newEmail },
      status: 'error',
      error: `Auth: ${e.message || e.code || String(e)}`,
    };
  }

  const needAuth = authEmailNorm !== newEmail;
  const needRtdb = rtdbEmail !== newEmail;

  if (!needAuth && !needRtdb) {
    console.log(`🔄 ${base.prenom} (${accId}) — déjà à jour (Auth + RTDB) → already-updated`);
    return {
      ...base,
      before: { auth: authEmailNorm, rtdb: rtdbEmail || null },
      after: { target: newEmail },
      status: 'already-updated',
    };
  }

  if (dryRun) {
    console.log(
      `🔄 [dry-run] Mettrait à jour email → ${newEmail} (Auth: ${needAuth ? 'oui' : 'ok'}, RTDB: ${needRtdb ? 'oui' : 'ok'}) — ${base.prenom}`
    );
    return {
      ...base,
      before: { auth: authEmailNorm, rtdb: rtdbEmail || null },
      after: { target: newEmail },
      status: 'dry-run-would-update',
    };
  }

  try {
    if (needAuth) {
      await admin.auth().updateUser(authUid, { email: newEmail });
    }
    if (needRtdb) {
      await accRef.update({ email: newEmail });
    }

    let status = 'updated';
    if (needAuth && needRtdb) status = 'updated';
    else if (needAuth && !needRtdb) status = 'updated-auth-only';
    else if (!needAuth && needRtdb) status = 'updated-rtdb-only';

    console.log(`✅ ${base.prenom} (${accId}) — ${status}`);
    return {
      ...base,
      before: { auth: authEmailNorm, rtdb: rtdbEmail || null },
      after: { target: newEmail },
      status,
    };
  } catch (e) {
    const code = e.code || '';
    const msg = e.message || String(e);
    console.error(`❌ ${base.prenom} (${accId}) — ${code || msg}`);
    return {
      ...base,
      before: { auth: authEmailNorm, rtdb: rtdbEmail || null },
      after: { target: newEmail },
      status: 'error',
      error: code ? `${code}: ${msg}` : msg,
    };
  }
}

async function runDelete(op, dryRun) {
  const accId = op.accId;
  const ts = entryTimestamp();
  const base = {
    accId,
    prenom: labelPrenom(op, null),
    type: 'delete',
    timestamp: ts,
  };

  if (!accId) {
    return {
      ...base,
      before: null,
      after: null,
      status: 'error',
      error: 'accId manquant',
    };
  }

  const accRef = admin.database().ref(`/accounts/${accId}`);
  const snap = await accRef.once('value');
  const data = snap.val();

  if (!data || typeof data !== 'object') {
    console.log(`🔄 (${accId}) — déjà absent (Auth + RTDB) → already-deleted`);
    return {
      ...base,
      prenom: labelPrenom(op, data),
      before: { rtdb: false },
      after: null,
      status: 'already-deleted',
    };
  }

  base.prenom = labelPrenom(op, data);
  const authUid = data.authUid != null ? String(data.authUid).trim() : '';

  if (dryRun) {
    console.log(`🔄 [dry-run] Supprimerait compte ${base.prenom} (${accId})`);
    return {
      ...base,
      before: { rtdb: true, authUid: authUid || null },
      after: { removed: true },
      status: 'dry-run-would-delete',
    };
  }

  if (!authUid) {
    await accRef.remove();
    console.log(`✅ ${base.prenom} (${accId}) — rtdb-only-deleted (pas d'authUid)`);
    return {
      ...base,
      before: { rtdb: true, authUid: null },
      after: { removed: true },
      status: 'rtdb-only-deleted',
    };
  }

  try {
    await admin.auth().deleteUser(authUid);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') {
      console.error(`❌ ${base.prenom} (${accId}) — ${e.code || e.message}`);
      return {
        ...base,
        before: { rtdb: true, authUid },
        after: null,
        status: 'error',
        error: e.code ? `${e.code}: ${e.message}` : e.message,
      };
    }
  }

  await accRef.remove();
  console.log(`✅ ${base.prenom} (${accId}) — deleted`);
  return {
    ...base,
    before: { rtdb: true, authUid },
    after: { removed: true },
    status: 'deleted',
  };
}

async function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Mise à jour comptes Auth / RTDB  ${DRY_RUN ? '(DRY-RUN)' : '(APPLY)'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const serviceAccount = loadServiceAccount();
  const rawOps = loadOperations();
  const operations = Array.isArray(rawOps) ? rawOps : [];

  const projectId = serviceAccount.project_id;
  if (!projectId) {
    console.error('❌ project_id manquant dans le compte de service.');
    process.exit(1);
  }

  const databaseURL = `https://${projectId}-default-rtdb.firebaseio.com`;
  console.log(`📡 databaseURL : ${databaseURL}\n`);

  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL,
    });
  }

  const entries = [];

  for (const op of operations) {
    const t = op && op.type;
    try {
      if (t === 'updateEmail') {
        const row = await runUpdateEmail(op, DRY_RUN);
        entries.push(row);
      } else if (t === 'delete') {
        const row = await runDelete(op, DRY_RUN);
        entries.push(row);
      } else {
        entries.push({
          accId: op && op.accId != null ? String(op.accId) : null,
          prenom: '—',
          type: t || 'unknown',
          before: null,
          after: null,
          status: 'error',
          timestamp: entryTimestamp(),
          error: `Type d'opération inconnu : ${t}`,
        });
        console.error(`❌ Type inconnu : ${t}`);
      }
    } catch (e) {
      console.error('❌ Erreur opération :', e.message || e);
      entries.push({
        accId: op && op.accId != null ? String(op.accId) : null,
        prenom: labelPrenom(op, null),
        type: t || 'unknown',
        before: null,
        after: null,
        status: 'error',
        timestamp: entryTimestamp(),
        error: e.message || String(e),
      });
    }
  }

  const summary = summarize(entries, DRY_RUN);
  const report = {
    mode: DRY_RUN ? 'dry-run' : 'apply',
    databaseURL,
    generatedAt: entryTimestamp(),
    summary,
    entries,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n📄 Rapport écrit : ${reportPath}`);

  console.log('\n────────── Résumé ──────────');
  if (DRY_RUN) {
    console.log(
      `  Prévu : ${summary.plannedUpdates || 0} mise(s) à jour, ${summary.plannedDeletes || 0} suppression(s) | ` +
        `Ignorés : ${summary.skipped} | Erreurs : ${summary.errors}`
    );
  } else {
    console.log(
      `  ${summary.updated} mis à jour, ${summary.deleted} supprimé(s), ${summary.skipped} ignoré(s), ${summary.errors} erreur(s)`
    );
  }
  console.log('══════════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch(e => {
  console.error('❌ Erreur fatale :', e);
  process.exit(1);
});
