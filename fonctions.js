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

/**
 * Fragment HTML pour la popup « Ajouter un compte » (IDs stables ; branchement événements côté page).
 */
export function buildAddAccountModalHTML() {
  return `<div id="shared-acc-modal" class="shared-acc-modal" aria-hidden="true">
  <div class="shared-acc-panel" onclick="event.stopPropagation()">
    <div class="shared-acc-title">Ajouter un compte</div>
    <div class="shared-acc-field"><label for="shared-acc-prenom">Prénom<span class="shared-acc-req">*</span></label><input type="text" id="shared-acc-prenom" autocomplete="given-name"></div>
    <div class="shared-acc-field"><label for="shared-acc-nom">Nom<span class="shared-acc-req">*</span></label><input type="text" id="shared-acc-nom" autocomplete="family-name"></div>
    <div class="shared-acc-field"><label for="shared-acc-pseudo">Pseudo de connexion<span class="shared-acc-req">*</span></label><input type="text" id="shared-acc-pseudo" autocomplete="username"></div>
    <div class="shared-acc-field"><label for="shared-acc-email">Email<span class="shared-acc-req">*</span></label><input type="email" id="shared-acc-email" autocomplete="email"></div>
    <div class="shared-acc-field"><label for="shared-acc-tel">Téléphone (optionnel)</label><input type="text" id="shared-acc-tel" autocomplete="tel"></div>
    <div class="shared-acc-field"><label for="shared-acc-pwd">Mot de passe<span class="shared-acc-req">*</span></label><input type="password" id="shared-acc-pwd" autocomplete="new-password"></div>
    <div class="shared-acc-field">
      <span style="font-size:12px;color:#888;font-weight:500">Rôles</span>
      <div class="shared-acc-roles">
        <span class="account-role active" id="shared-acc-role-menage" title="Peut faire le ménage">🧹</span>
        <span class="account-role" id="shared-acc-role-admin" title="Administrateur">👑</span>
      </div>
    </div>
    <div class="shared-acc-actions">
      <button type="button" class="btn-cancel" id="shared-acc-cancel">Annuler</button>
      <button type="button" class="btn-primary" id="shared-acc-submit">Ajouter</button>
    </div>
  </div>
</div>`;
}

/**
 * Fragment HTML — confirmation d’association d’un compte existant (message dynamique dans #shared-confirm-assoc-text).
 */
export function buildConfirmAssocModalHTML() {
  return `<div id="shared-confirm-assoc-modal" class="shared-acc-modal" aria-hidden="true">
  <div class="shared-acc-panel" onclick="event.stopPropagation()">
    <div class="shared-acc-title">Compte existant</div>
    <p id="shared-confirm-assoc-text" style="margin:0 0 12px;font-size:13px;color:#555;line-height:1.45"></p>
    <div class="shared-acc-actions">
      <button type="button" class="btn-secondary" id="shared-confirm-assoc-cancel">Annuler</button>
      <button type="button" class="btn-primary" id="shared-confirm-assoc-ok">Associer</button>
    </div>
  </div>
</div>`;
}

/**
 * Fragment HTML — édition d’un compte (IDs stables ; branchement côté page).
 */
export function buildEditAccountModalHTML() {
  return `<div id="shared-edit-acc-modal" class="shared-acc-modal" aria-hidden="true">
  <div class="shared-acc-panel" onclick="event.stopPropagation()">
    <div class="shared-acc-title">Modifier le compte</div>
    <div class="shared-acc-field"><label for="shared-edit-prenom">Prénom</label><input type="text" id="shared-edit-prenom" class="shared-edit-input-ro" readonly autocomplete="off"></div>
    <div class="shared-acc-field"><label for="shared-edit-nom">Nom<span class="shared-acc-req">*</span></label><input type="text" id="shared-edit-nom" autocomplete="off"></div>
    <div class="shared-acc-field"><label for="shared-edit-email">Email<span class="shared-acc-req">*</span></label><input type="email" id="shared-edit-email" autocomplete="email"></div>
    <div class="shared-acc-field"><label for="shared-edit-pseudo">Pseudo de connexion<span class="shared-acc-req">*</span></label><input type="text" id="shared-edit-pseudo" autocomplete="username"></div>
    <div class="shared-acc-field"><label for="shared-edit-tel">Téléphone (optionnel)</label><input type="text" id="shared-edit-tel" autocomplete="tel"></div>
    <div class="shared-acc-field"><label for="shared-edit-pwd">Nouveau mot de passe</label><input type="password" id="shared-edit-pwd" autocomplete="new-password" placeholder="Laisser vide pour ne pas changer"></div>
    <div class="shared-acc-field">
      <span style="font-size:12px;color:#888;font-weight:500">Rôles</span>
      <div class="shared-acc-roles">
        <span class="account-role" id="shared-edit-role-menage" title="Peut faire le ménage">🧹</span>
        <span class="account-role" id="shared-edit-role-admin" title="Administrateur">👑</span>
      </div>
    </div>
    <div class="shared-edit-actions">
      <button type="button" class="btn-danger" id="shared-edit-delete">Supprimer</button>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button type="button" class="btn-secondary" id="shared-edit-cancel">Annuler</button>
        <button type="button" class="btn-primary" id="shared-edit-save">Enregistrer</button>
      </div>
    </div>
  </div>
</div>`;
}
