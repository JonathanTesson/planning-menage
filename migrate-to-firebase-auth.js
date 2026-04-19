/**
 * migrate-to-firebase-auth.js
 * Script one-shot — migration des comptes /accounts vers Firebase Authentication
 *
 * Prérequis :
 *   npm install  (première fois uniquement)
 *   Fichier Firebase/service-account.json présent (ou variable FIREBASE_SERVICE_ACCOUNT)
 *   Fichier migration-passwords.local.js rempli (cf migration-passwords.template.js)
 *
 * Usage :
 *   npm run migrate-auth          (dry-run)
 *   npm run migrate-auth:apply    (exécution réelle)
 *
 *   node migrate-to-firebase-auth.js
 *   node migrate-to-firebase-auth.js --apply
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const DRY_RUN = !process.argv.includes('--apply');
const serviceAccountPath = path.join(__dirname, 'Firebase', 'service-account.json');
const passwordsPath = path.join(__dirname, 'migration-passwords.local.js');
const reportPath = path.join(__dirname, 'migration-report.local.json');

const FLORIANDRE_ACC_ID = '-OqN_EuNlBEBaHG-QMRa';

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

function loadPasswords() {
  if (!fs.existsSync(passwordsPath)) {
    console.error(`❌ Fichier introuvable : ${passwordsPath}`);
    console.error('   Copiez migration-passwords.template.js vers migration-passwords.local.js puis remplissez les mots de passe.');
    process.exit(1);
  }
  try {
    delete require.cache[require.resolve(passwordsPath)];
    return require(passwordsPath);
  } catch (e) {
    console.error('❌ Impossible de charger migration-passwords.local.js :', e.message);
    process.exit(1);
  }
}

function validatePasswordEntry(password, prenomLabel) {
  const p = password != null ? String(password) : '';
  const t = p.trim();
  if (!t) {
    return { ok: false, reason: 'empty' };
  }
  if (t === 'CHANGE_ME') {
    console.log(`⚠️  Placeholder CHANGE_ME détecté pour ${prenomLabel} — remplir le fichier local avant --apply`);
    return { ok: false, reason: 'placeholder' };
  }
  if (t.length < 6) {
    return { ok: false, reason: 'short' };
  }
  return { ok: true, password: t };
}

function entryTimestamp() {
  return new Date().toISOString();
}

async function ensureFloriandreNomIfNeeded(accId, accountData) {
  if (accId !== FLORIANDRE_ACC_ID) return;
  const nom = accountData.nom;
  if (nom !== undefined && nom !== null && String(nom).trim() !== '') return;
  if (DRY_RUN) {
    console.log(`🔄 [dry-run] Mettrait à jour /accounts/${accId} → nom: "Menier"`);
    return;
  }
  await admin.database().ref(`/accounts/${accId}`).update({ nom: 'Menier' });
  console.log(`✅ nom → "Menier" pour Floriandre (${accId})`);
}

async function migrateOneAccount(accId, data, passwords) {
  const prenom = data.name || data.prenom || '—';
  const base = {
    prenom,
    acc_id: accId,
    email: null,
    authUid: data.authUid || null,
    status: null,
    timestamp: entryTimestamp(),
  };

  if (data.authUid) {
    base.email = data.email || null;
    base.status = 'already-in-rtdb';
    await ensureFloriandreNomIfNeeded(accId, data);
    console.log(`🔄 ${prenom} (${accId}) — authUid déjà présent, ignoré`);
    return base;
  }

  const cfg = passwords[accId];
  if (!cfg || typeof cfg !== 'object') {
    base.status = 'skipped-no-password';
    console.log(`⚠️  ${prenom} (${accId}) — aucune entrée dans le fichier local (skipped-no-password)`);
    await ensureFloriandreNomIfNeeded(accId, data);
    return base;
  }

  const email = cfg.email != null ? String(cfg.email).trim() : '';
  const rawPassword = cfg.password;
  base.email = email || null;

  const pv = validatePasswordEntry(rawPassword, `${prenom} (${accId})`);
  if (!pv.ok) {
    if (pv.reason === 'short') {
      base.status = 'skipped-invalid-password';
      console.log(`⚠️  ${prenom} (${accId}) — mot de passe < 6 caractères (skipped-invalid-password)`);
    } else {
      base.status = 'skipped-no-password';
      console.log(`⚠️  ${prenom} (${accId}) — mot de passe manquant ou placeholder (skipped-no-password)`);
    }
    await ensureFloriandreNomIfNeeded(accId, data);
    return base;
  }

  if (!email) {
    base.status = 'skipped-no-password';
    console.log(`⚠️  ${prenom} (${accId}) — email manquant dans le fichier local`);
    await ensureFloriandreNomIfNeeded(accId, data);
    return base;
  }

  if (DRY_RUN) {
    base.status = 'dry-run-would-create';
    base.authUid = null;
    console.log(`🔄 [dry-run] Créerait Auth pour ${prenom} → ${email}`);
    await ensureFloriandreNomIfNeeded(accId, data);
    return base;
  }

  try {
    const userRecord = await admin.auth().createUser({
      email,
      password: pv.password,
      emailVerified: false,
      disabled: false,
    });
    await admin.database().ref(`/accounts/${accId}`).update({
      authUid: userRecord.uid,
      email,
      needsPasswordChange: true,
    });
    await ensureFloriandreNomIfNeeded(accId, data);
    base.authUid = userRecord.uid;
    base.status = 'created';
    console.log(`✅ ${prenom} (${accId}) — compte Auth créé (${userRecord.uid})`);
    return base;
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      try {
        const existing = await admin.auth().getUserByEmail(email);
        await admin.database().ref(`/accounts/${accId}`).update({
          authUid: existing.uid,
          email,
          needsPasswordChange: true,
        });
        await ensureFloriandreNomIfNeeded(accId, data);
        base.authUid = existing.uid;
        base.status = 'linked-existing-auth';
        console.log(`✅ ${prenom} (${accId}) — email déjà dans Auth, UID lié (${existing.uid})`);
        return base;
      } catch (e2) {
        base.status = 'error';
        base.error = e2.message;
        console.error(`❌ ${prenom} (${accId}) — échec liaison :`, e2.message);
        return base;
      }
    }
    base.status = 'error';
    base.error = e.message;
    console.error(`❌ ${prenom} (${accId}) :`, e.message);
    return base;
  }
}

async function migrateSuperAdmin(passwords) {
  const prenom = 'Super Admin';
  const base = {
    prenom,
    acc_id: 'SUPER_ADMIN',
    email: null,
    authUid: null,
    status: null,
    timestamp: entryTimestamp(),
  };

  const cfg = passwords.SUPER_ADMIN;
  if (!cfg || typeof cfg !== 'object') {
    base.status = 'skipped-no-password';
    console.log('⚠️  SUPER_ADMIN — entrée manquante dans le fichier local');
    return base;
  }

  const email = cfg.email != null ? String(cfg.email).trim() : '';
  base.email = email || null;

  const credSnap = await admin.database().ref('superAdmin/credentials').once('value');
  const cred = credSnap.val() || {};
  if (cred.authUid) {
    base.authUid = cred.authUid;
    base.status = 'already-in-rtdb';
    console.log('🔄 Super Admin — authUid déjà sous /superAdmin/credentials, ignoré');
    return base;
  }

  const pv = validatePasswordEntry(cfg.password, 'Super Admin');
  if (!pv.ok) {
    if (pv.reason === 'short') {
      base.status = 'skipped-invalid-password';
      console.log('⚠️  Super Admin — mot de passe < 6 caractères (skipped-invalid-password)');
    } else {
      base.status = 'skipped-no-password';
      console.log('⚠️  Super Admin — mot de passe manquant ou placeholder (skipped-no-password)');
    }
    return base;
  }

  if (!email) {
    base.status = 'skipped-no-password';
    console.log('⚠️  Super Admin — email manquant');
    return base;
  }

  if (DRY_RUN) {
    base.status = 'dry-run-would-create';
    console.log(`🔄 [dry-run] Créerait compte Auth Super Admin → ${email}`);
    return base;
  }

  try {
    const userRecord = await admin.auth().createUser({
      email,
      password: pv.password,
      emailVerified: false,
      disabled: false,
    });
    await admin.database().ref('superAdmin/credentials').update({ authUid: userRecord.uid });
    base.authUid = userRecord.uid;
    base.status = 'created';
    console.log(`✅ Super Admin — compte Auth créé (${userRecord.uid})`);
    return base;
  } catch (e) {
    if (e.code === 'auth/email-already-exists') {
      try {
        const existing = await admin.auth().getUserByEmail(email);
        await admin.database().ref('superAdmin/credentials').update({ authUid: existing.uid });
        base.authUid = existing.uid;
        base.status = 'linked-existing-auth';
        console.log(`✅ Super Admin — email déjà dans Auth, UID lié (${existing.uid})`);
        return base;
      } catch (e2) {
        base.status = 'error';
        base.error = e2.message;
        console.error('❌ Super Admin — échec liaison :', e2.message);
        return base;
      }
    }
    base.status = 'error';
    base.error = e.message;
    console.error('❌ Super Admin :', e.message);
    return base;
  }
}

function summarize(entries) {
  let migrated = 0;
  let alreadyPresent = 0;
  let skipped = 0;
  let errors = 0;

  const migratedStatuses = new Set(['created', 'linked-existing-auth']);
  const presentStatuses = new Set(['already-in-rtdb']);
  const skipStatuses = new Set([
    'skipped-no-password',
    'skipped-invalid-password',
    'orphan-password',
  ]);
  const dryMigrateStatuses = new Set(['dry-run-would-create']);

  for (const row of entries) {
    const s = row.status;
    if (migratedStatuses.has(s)) migrated++;
    else if (presentStatuses.has(s)) alreadyPresent++;
    else if (skipStatuses.has(s)) skipped++;
    else if (dryMigrateStatuses.has(s)) migrated++;
    else if (s === 'error') errors++;
  }

  return { migrated, alreadyPresent, skipped, errors };
}

async function main() {
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Migration Firebase Auth  ${DRY_RUN ? '(DRY-RUN — aucune écriture)' : '(APPLY — écritures réelles)'}`);
  console.log('══════════════════════════════════════════════════════════\n');

  const serviceAccount = loadServiceAccount();
  const passwords = loadPasswords();

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

  const accountsSnap = await admin.database().ref('/accounts').once('value');
  const accountsVal = accountsSnap.val() || {};
  const accountIds = Object.keys(accountsVal);

  console.log(`📦 ${accountIds.length} compte(s) dans /accounts\n`);

  const entries = [];

  for (const accId of accountIds) {
    const data = accountsVal[accId];
    const row = await migrateOneAccount(accId, data, passwords);
    entries.push(row);
  }

  const saRow = await migrateSuperAdmin(passwords);
  entries.push(saRow);

  const passwordKeys = Object.keys(passwords);
  const accountIdSet = new Set(accountIds);
  for (const key of passwordKeys) {
    if (key === 'SUPER_ADMIN') continue;
    if (accountIdSet.has(key)) continue;
    const orphan = {
      prenom: '—',
      acc_id: key,
      email: passwords[key] && passwords[key].email ? String(passwords[key].email) : null,
      authUid: null,
      status: 'orphan-password',
      timestamp: entryTimestamp(),
    };
    entries.push(orphan);
    console.log(`⚠️  Clé orpheline dans le fichier local : ${key} (orphan-password)`);
  }

  const summary = summarize(entries);
  const report = {
    mode: DRY_RUN ? 'dry-run' : 'apply',
    databaseURL,
    generatedAt: entryTimestamp(),
    summary: {
      migrated: summary.migrated,
      alreadyPresent: summary.alreadyPresent,
      skipped: summary.skipped,
      errors: summary.errors,
    },
    entries,
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n📄 Rapport écrit : ${reportPath}`);

  console.log('\n────────── Résumé ──────────');
  const sim = DRY_RUN ? ' (simulation)' : '';
  console.log(
    `  ${summary.migrated} migré(s)${sim}, ${summary.alreadyPresent} déjà présent(s), ${summary.skipped} ignoré(s), ${summary.errors} erreur(s)`
  );
  console.log('══════════════════════════════════════════════════════════\n');

  process.exit(0);
}

main().catch(e => {
  console.error('❌ Erreur fatale :', e);
  process.exit(1);
});
