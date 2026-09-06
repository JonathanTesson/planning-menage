const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

/** v1 `onCall` n’expose pas `cors` dans firebase-functions ; v2 le permet (même contrat client `httpsCallable`). Origines autorisées pour les CFs appelables depuis le front (GitHub Pages + Vite local). */
const APP_CORS_ORIGINS = [
  "https://jonathantesson.github.io",
  "http://127.0.0.1:5173",
];

exports.adminAuth = onCall(
  {
    region: "us-central1",
    cors: APP_CORS_ORIGINS,
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

exports.inviteToken = onCall(
  {
    region: "us-central1",
    cors: APP_CORS_ORIGINS,
  },
  async (request) => {
    // Public by design — invitation flow is pre-auth. Per-action security is enforced inside the switch.

    const data = request.data || {};
    const action = data.action;

    switch (action) {
      case "validate": {
        const raw = data.token;
        const token = typeof raw === "string" ? raw.trim() : "";
        if (!token) {
          throw new HttpsError(
            "invalid-argument",
            "validate requires token."
          );
        }
        const snap = await admin
          .database()
          .ref("inviteTokens/" + token)
          .get();
        if (!snap.exists() || !snap.val() || typeof snap.val() !== "object") {
          return { valid: false, reason: "not_found" };
        }
        const row = snap.val();
        if (row.status === "revoked") {
          return { valid: false, reason: "revoked" };
        }
        if (row.status === "used") {
          return { valid: false, reason: "used" };
        }
        const exp = Number(row.expiresAt);
        if (!Number.isFinite(exp) || exp <= Date.now()) {
          return { valid: false, reason: "expired" };
        }
        return { valid: true, expiresAt: exp };
      }
      case "consume": {
        try {
          const rawToken = data.token;
          const token =
            typeof rawToken === "string" ? rawToken.trim() : "";
          if (!token) {
            throw new HttpsError(
              "invalid-argument",
              "Missing or invalid token."
            );
          }

          const account = data.account;
          if (!account || typeof account !== "object") {
            throw new HttpsError("invalid-argument", "Missing account.");
          }
          const mode = account.mode;
          if (mode !== "password" && mode !== "google") {
            throw new HttpsError("invalid-argument", "Invalid account.mode.");
          }

          const prenom =
            typeof account.prenom === "string"
              ? account.prenom.trim()
              : "";
          const nom =
            typeof account.nom === "string" ? account.nom.trim() : "";
          const email =
            typeof account.email === "string" ? account.email.trim() : "";
          if (!prenom || !nom || !email) {
            throw new HttpsError(
              "invalid-argument",
              "Account prenom, nom, and email are required."
            );
          }

          if (mode === "password") {
            const pwd =
              typeof account.pwd === "string" ? account.pwd : "";
            if (pwd.length < 6) {
              throw new HttpsError(
                "invalid-argument",
                "Password must be at least 6 characters."
              );
            }
          } else {
            const googleUid =
              typeof account.googleUid === "string"
                ? account.googleUid.trim()
                : "";
            if (!googleUid) {
              throw new HttpsError(
                "invalid-argument",
                "googleUid is required for Google mode."
              );
            }
          }

          const org = data.org;
          if (!org || typeof org !== "object") {
            throw new HttpsError("invalid-argument", "Missing org.");
          }
          const orgNom =
            typeof org.nom === "string" ? org.nom.trim() : "";
          const slug =
            typeof org.slug === "string" ? org.slug.trim() : "";
          if (!orgNom || !slug) {
            throw new HttpsError(
              "invalid-argument",
              "Organization nom and slug are required."
            );
          }

          const rawStudios = data.studios;
          if (!Array.isArray(rawStudios) || rawStudios.length === 0) {
            throw new HttpsError(
              "invalid-argument",
              "studios must be a non-empty array."
            );
          }
          const studios = rawStudios.map((s) =>
            typeof s === "string" ? s.trim() : ""
          );
          if (!studios.some((s) => s.length > 0)) {
            throw new HttpsError(
              "invalid-argument",
              "studios must contain at least one non-empty name."
            );
          }

          const tokenSnap = await admin
            .database()
            .ref("inviteTokens/" + token)
            .get();
          if (
            !tokenSnap.exists() ||
            !tokenSnap.val() ||
            typeof tokenSnap.val() !== "object"
          ) {
            throw new HttpsError("not-found", "Token not found.");
          }
          const row = tokenSnap.val();
          if (row.status !== "active") {
            throw new HttpsError(
              "failed-precondition",
              "Token already used or revoked."
            );
          }
          const exp = Number(row.expiresAt);
          if (!Number.isFinite(exp) || exp <= Date.now()) {
            throw new HttpsError(
              "failed-precondition",
              "Token expired."
            );
          }

          const orgSlugSnap = await admin
            .database()
            .ref("organizations/" + slug)
            .get();
          if (orgSlugSnap.exists()) {
            throw new HttpsError(
              "already-exists",
              "Organization slug already taken."
            );
          }

          let uid;
          if (mode === "password") {
            try {
              const user = await admin.auth().createUser({
                email,
                password: account.pwd,
                displayName: prenom + " " + nom,
              });
              uid = user.uid;
            } catch (e) {
              if (e && e.code === "auth/email-already-exists") {
                throw new HttpsError(
                  "already-exists",
                  "Email already in use."
                );
              }
              throw e;
            }
          } else {
            const googleUid =
              typeof account.googleUid === "string"
                ? account.googleUid.trim()
                : "";
            try {
              await admin.auth().getUser(googleUid);
              uid = googleUid;
            } catch (e) {
              if (e && e.code === "auth/user-not-found") {
                throw new HttpsError(
                  "not-found",
                  "Google account not found."
                );
              }
              throw e;
            }
          }

          const icalRaw = data.ical;
          const icalObj =
            icalRaw &&
            typeof icalRaw === "object" &&
            !Array.isArray(icalRaw)
              ? icalRaw
              : {};
          const icalArray = [];
          for (const key of Object.keys(icalObj)) {
            const i = Number(key);
            if (
              !Number.isFinite(i) ||
              i < 0 ||
              i >= studios.length
            ) {
              continue;
            }
            const url =
              icalObj[key] == null
                ? ""
                : String(icalObj[key]).trim();
            if (!url) continue;
            icalArray.push({ studio: i, url, locked: false });
          }
          icalArray.sort((a, b) => a.studio - b.studio);

          const accountRef = admin.database().ref("accounts").push();
          const accountId = accountRef.key;

          const updates = {};
          updates["organizations/" + slug] = { label: orgNom };
          updates["orgs/" + slug + "/config/studioNames"] = studios;
          updates["orgs/" + slug + "/adminConfig"] = {
            defaultOrgId: slug,
            authEnabled: true,
            telegramEnabled: false,
          };
          if (icalArray.length > 0) {
            updates["orgs/" + slug + "/icalFeeds"] = icalArray;
          }
          updates["accounts/" + accountId] = {
            authUid: uid,
            name: prenom,
            prenom,
            nom,
            pseudo: prenom,
            email,
            tel: "",
            defaultOrg: slug,
            orgs: { [slug]: { roles: ["menage", "admin"] } },
            order: 0,
            needsPasswordChange: false,
          };
          updates["inviteTokens/" + token + "/status"] = "used";
          updates["inviteTokens/" + token + "/usedAt"] = Date.now();
          updates["inviteTokens/" + token + "/usedByUid"] = uid;
          updates["inviteTokens/" + token + "/orgIdCreated"] = slug;

          await admin.database().ref("/").update(updates);

          return { success: true, uid, slug, accountId };
        } catch (e) {
          if (e instanceof HttpsError) throw e;
          console.error("[consume]", e);
          throw new HttpsError("internal", "Unexpected error.");
        }
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

/**
 * GET /nextIntervenante?studio=1&key=...
 * Renvoie qui fait le prochain ménage d'un studio (org "tesson" par défaut),
 * pour affichage externe (Home Assistant / Jeedom). Lecture seule,
 * n'écrit rien et n'a aucun effet sur le reste de l'app.
 *
 * Réponse : { studio, date, intervenantes }
 *   - date : jour (YYYY-MM-DD) du départ/ménage précédant la prochaine arrivée,
 *            ou null si aucune arrivée à venir n'est prévue.
 *   - intervenantes : tableau des prénoms assignés (c1/c2), vide si aucun.
 */
exports.nextIntervenante = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    if (req.method !== "GET") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const expectedKey = process.env.NEXT_INTERVENANTE_KEY;
    if (!expectedKey) {
      console.error(
        "[nextIntervenante] NEXT_INTERVENANTE_KEY manquant côté serveur."
      );
      res.status(500).json({ error: "Server misconfigured" });
      return;
    }
    if (req.query.key !== expectedKey) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const studioParam = Number(req.query.studio);
    if (!Number.isInteger(studioParam) || studioParam < 1) {
      res
        .status(400)
        .json({ error: "studio must be a positive integer (1, 2, ...)" });
      return;
    }
    const studioIdx = studioParam - 1;
    const orgId =
      typeof req.query.org === "string" && req.query.org.trim()
        ? req.query.org.trim()
        : "tesson";

    try {
      const base = `orgs/${orgId}`;
      const [reservationsSnap, assignmentsSnap] = await Promise.all([
        admin.database().ref(`${base}/reservations`).get(),
        admin.database().ref(`${base}/assignments`).get(),
      ]);
      const reservations = reservationsSnap.val() || {};
      const assignments = assignmentsSnap.val() || {};

      const today = new Date().toISOString().split("T")[0];

      const prochaines = Object.values(reservations)
        .filter((r) => r && r.studio === studioIdx && r.start >= today)
        .sort((a, b) => a.start.localeCompare(b.start));
      const nextArrival = prochaines[0] || null;

      if (!nextArrival) {
        res
          .status(200)
          .json({ studio: studioParam, date: null, intervenantes: [] });
        return;
      }

      const departsAvant = Object.values(reservations)
        .filter((r) => r && r.studio === studioIdx && r.end <= nextArrival.start)
        .sort((a, b) => b.end.localeCompare(a.end));
      const departureBefore = departsAvant[0] || null;

      if (!departureBefore) {
        res
          .status(200)
          .json({ studio: studioParam, date: null, intervenantes: [] });
        return;
      }

      const assignment = assignments[departureBefore.uid] || {};
      const intervenantes = [assignment.c1, assignment.c2].filter(Boolean);

      res.status(200).json({
        studio: studioParam,
        date: departureBefore.end,
        intervenantes,
      });
    } catch (e) {
      console.error("[nextIntervenante]", e);
      res.status(500).json({ error: "Internal error" });
    }
  }
);
