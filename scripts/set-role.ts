/**
 * Assign a role to a user: sets the `role` custom claim AND upserts the
 * users/{uid} document.
 *
 * Usage:
 *   npx tsx scripts/set-role.ts <email> <radiologist|typist|reviewer> [full name]
 *
 * Auth: place a Firebase service account JSON at ./serviceAccountKey.json,
 * or set GOOGLE_APPLICATION_CREDENTIALS to its path.
 *
 * The user must sign out and back in for a new claim to take effect.
 */
import { initializeApp, cert, applicationDefault, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const VALID_ROLES = ["radiologist", "typist", "reviewer"] as const;
type Role = (typeof VALID_ROLES)[number];

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
    const keyPath = resolve(process.cwd(), "serviceAccountKey.json");
    if (existsSync(keyPath)) {
      initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, "utf8"))) });
    } else {
      initializeApp({ credential: applicationDefault() });
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
