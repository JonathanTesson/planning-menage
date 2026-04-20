/**
 * update-accounts-auth.template.js
 * Template versionné — copier vers update-accounts-auth.local.js puis adapter.
 * Le fichier update-accounts-auth.local.js est ignoré par git.
 */

module.exports = [
  // --- Mises à jour d'email (emails bidons → emails réels) ---
  { type: 'updateEmail', accId: '-OqN_E32KsI6z4jTuLIa', newEmail: 'steffietesson@gmail.com',         prenom: 'Steffie' },
  { type: 'updateEmail', accId: '-OqN_E9yCu7lNJDGLQ5T', newEmail: 'myrtille.monnier@icloud.com',     prenom: 'Mireille' },
  { type: 'updateEmail', accId: '-OqN_EGyW6amH6QBSgrX', newEmail: 'emmydugas290610@gmail.com',       prenom: 'Emmy' },
  { type: 'updateEmail', accId: '-OqN_ENgnl2ItzB6RiX3', newEmail: 'fava0722@gmail.com',              prenom: 'Valérie' },
  { type: 'updateEmail', accId: '-OqN_EUVtklg7Jlr-vB-', newEmail: 'christelle.bridonneau@hotmail.fr', prenom: 'Christelle' },
  { type: 'updateEmail', accId: '-OqN_EaI2GTC917uNctK', newEmail: 'leonadevinci@orange.fr',          prenom: 'Nade' },

  // --- Suppressions (elles recréeront leurs comptes plus tard) ---
  { type: 'delete', accId: '-OqN_EngDxCK54Eck7pt', prenom: 'Clémentine' },
  { type: 'delete', accId: '-OqN_EuNlBEBaHG-QMRa', prenom: 'Floriandre' },
];
