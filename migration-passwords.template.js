// migration-passwords.template.js
// Template versionné — copier vers migration-passwords.local.js puis remplir les passwords réels.
// Le fichier migration-passwords.local.js est ignoré par git (voir .gitignore).

module.exports = {
  // --- Organisation tesson ---
  '-OqN_Dx3zCeLHJeRZ79q': { email: 'tessonjonathan@gmail.com',              password: 'CHANGE_ME' }, // Jonath (admin + ménage)
  '-OqN_E32KsI6z4jTuLIa': { email: 'steffie.tesson@planning-menage.local',  password: 'CHANGE_ME' }, // Steffie
  '-OqN_E9yCu7lNJDGLQ5T': { email: 'mireille.tesson@planning-menage.local', password: 'CHANGE_ME' }, // Mireille
  '-OqN_EGyW6amH6QBSgrX': { email: 'emmy.tesson@planning-menage.local',     password: 'CHANGE_ME' }, // Emmy
  '-OqN_ENgnl2ItzB6RiX3': { email: 'valerie.tesson@planning-menage.local',  password: 'CHANGE_ME' }, // Valérie
  '-OqN_EUVtklg7Jlr-vB-': { email: 'christelle.tesson@planning-menage.local', password: 'CHANGE_ME' }, // Christelle

  // --- Organisation nade ---
  '-OqN_EaI2GTC917uNctK': { email: 'nade.jolly@planning-menage.local',      password: 'CHANGE_ME' }, // Nade (format prenom.nom, pas prenom.org)

  // --- Organisation zencles ---
  '-OqN_EngDxCK54Eck7pt': { email: 'clementine.zencles@planning-menage.local', password: 'CHANGE_ME' }, // Clémentine
  '-OqN_EuNlBEBaHG-QMRa': { email: 'floriandre.zencles@planning-menage.local', password: 'CHANGE_ME' }, // Floriandre (→ nom: "Menier" à ajouter dans RTDB)

  // --- Super Admin (compte Firebase Auth dédié) ---
  SUPER_ADMIN: { email: 'superadmin@planning-menage.local', password: 'CHANGE_ME' },
};
