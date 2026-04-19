/** Utilitaires partagés (fonctions pures, sans Firebase ni accès DOM). */

export function hashSimple(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i), h |= 0;
  return h.toString(36);
}

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function accNormalizeEmail(e) {
  return String(e || '').trim().toLowerCase();
}

export function accEntriesFromSnapshotVal(val) {
  if (!val || typeof val !== 'object') return [];
  return Object.entries(val).filter(([, v]) => v && typeof v === 'object').map(([id, v]) => ({ id, ...v }));
}

export function accFindIdentityMatch(entries, prenom, nom, email) {
  const pl = prenom.trim().toLowerCase();
  const nl = nom.trim().toLowerCase();
  const em = accNormalizeEmail(email);
  if (!pl || !nl || !em) return null;
  for (const row of entries) {
    const rPr = String(row.prenom ?? '').trim().toLowerCase();
    const rName = String(row.name ?? '').trim().toLowerCase();
    const rNom = String(row.nom ?? '').trim().toLowerCase();
    if ((rPr === pl || rName === pl) && rNom === nl && accNormalizeEmail(row.email) === em) return row;
  }
  return null;
}

export function accFindPseudoOwner(entries, pseudo) {
  const ps = String(pseudo || '').trim();
  if (!ps) return null;
  for (const row of entries) {
    if (String(row.pseudo ?? '').trim() === ps) return row;
  }
  return null;
}

export function accFindPseudoOwnerExcluding(entries, pseudo, excludeId) {
  const ps = String(pseudo || '').trim();
  if (!ps) return null;
  for (const row of entries) {
    if (excludeId && row.id === excludeId) continue;
    if (String(row.pseudo ?? '').trim() === ps) return row;
  }
  return null;
}

export function calcMaxOrder(entries) {
  let max = -1;
  for (const e of entries) {
    const ord = e?.order;
    if (typeof ord === 'number' && Number.isFinite(ord)) max = Math.max(max, ord);
  }
  return max;
}

/**
 * Objet prêt pour `set(ref(db, 'accounts/...'), payload)` — aligné sur admin.html / superadmin.html.
 */
export function buildAccountPayload({ prenom, nom, pseudo, email, tel, pwdHash, orgId, roles, order }) {
  return {
    name: prenom,
    nom,
    prenom,
    pseudo,
    email,
    tel: tel || '',
    pwdHash,
    orgs: { [orgId]: { roles } },
    defaultOrg: orgId,
    order
  };
}
