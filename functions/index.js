const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

/** v1 `onCall` n’expose pas `cors` dans firebase-functions ; v2 le permet (même contrat client `httpsCallable`). */
const ADMIN_AUTH_CORS = [
  "https://jonathantesson.github.io",
  "http://127.0.0.1:5173",
];

exports.adminAuth = onCall(
  {
    region: "us-central1",
    cors: ADMIN_AUTH_CORS,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const data = request.data || {};
    const action = data.action;

    switch (action) {
      case "createUser": {
        const { email, password, displayName } = data;
        if (!email || !password) {
          throw new HttpsError(
            "invalid-argument",
            "createUser requires email and password."
          );
        }
        const user = await admin.auth().createUser({
          email,
          password,
          displayName: displayName || undefined,
        });
        return { uid: user.uid };
      }
      case "deleteUser": {
        const { uid } = data;
        if (!uid) {
          throw new HttpsError("invalid-argument", "deleteUser requires uid.");
        }
        await admin.auth().deleteUser(uid);
        return { success: true };
      }
      case "updatePassword": {
        const { uid, password } = data;
        if (!uid || !password) {
          throw new HttpsError(
            "invalid-argument",
            "updatePassword requires uid and password."
          );
        }
        await admin.auth().updateUser(uid, { password });
        return { success: true };
      }
      default:
        throw new HttpsError(
          "invalid-argument",
          action
            ? `Unknown action: ${action}`
            : "Missing or invalid action."
        );
    }
  }
);
