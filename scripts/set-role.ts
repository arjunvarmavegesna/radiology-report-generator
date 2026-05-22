/**
 * Assign a role to a user: sets the `role` custom claim AND upserts the
 * users/{uid} document.
 *
 * Usage:
 *   npx tsx scripts/set-role.ts <email> <radiologist|typist|reviewer> [full name]
 *
 * Auth (any one of):
 *   - a Firebase service account JSON saved as ./serviceAccountKey.json, or
 *   - any *firebase-adminsdk*.json dropped in the project root (auto-detected), or
 *   - GOOGLE_APPLICATION_CREDENTIALS pointing at a key file.
 *
 * The user must sign out and back in for a new claim to take effect.
 */
import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const VALID_ROLES = ["radiologist", "typist", "reviewer"] as const;
type Role = (typeof VALID_ROLES)[number];

/** Locate a service account key: explicit name first, then any admin-sdk json. */
function findKeyFile(): string | null {
  const explicit = resolve(process.cwd(), "serviceAccountKey.json");
  if (existsSync(explicit)) return explicit;

  const candidates = readdirSync(process.cwd()).filter(
    (f) => f.toLowerCase().endsWith(".json") && /firebase-adminsdk/i.test(f),
  );
  if (candidates.length === 1) return resolve(process.cwd(), candidates[0]);
  if (candidates.length > 1) {
    console.error(
      `Found multiple admin-SDK keys (${candidates.join(", ")}). ` +
        "Rename the correct one to serviceAccountKey.json and re-run.",
    );
    process.exit(1);
  }
  return null;
}

async function main() {
  const [email, role, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ").trim();

  if (!email || !role) {
    console.error(
      "Usage: npx tsx scripts/set-role.ts <email> <radiologist|typist|reviewer> [full name]",
    );
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role as Role)) {
    console.error(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  if (!getApps().length) {
    const keyPath = findKeyFile();
    if (keyPath) {
      initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, "utf8"))) });
      console.log(`Using service account: ${keyPath}`);
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp({ credential: applicationDefault() });
    } else {
      console.error(
        "\nNo Firebase credentials found.\n" +
          "Firebase Console -> Project settings (gear) -> Service accounts ->\n" +
          "  Generate new private key, save it as serviceAccountKey.json in the\n" +
          "  project root, then re-run this command.\n",
      );
      process.exit(1);
    }
  }

  const auth = getAuth();
  const db = getFirestore();

  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { role });
  await db
    .collection("users")
    .doc(user.uid)
    .set(
      {
        name: name || user.displayName || email.split("@")[0],
        email,
        role,
        active: true,
      },
      { merge: true },
    );

  console.log(`OK: set role "${role}" for ${email} (uid: ${user.uid}).`);
  console.log("The user must sign out and back in for the claim to take effect.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
