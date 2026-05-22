/**
 * Server-only Firebase Admin SDK accessors. Used by API route handlers and
 * server actions. Do NOT import this from client components.
 *
 * Credentials:
 *  - Local dev: a serviceAccountKey.json at the project root.
 *  - App Hosting / GCP: application default credentials (no file needed).
 */
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage, type Storage } from "firebase-admin/storage";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function resolveStorageBucket(): string | undefined {
  if (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) {
    return process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  }
  if (process.env.FIREBASE_ADMIN_PROJECT_ID) {
    return `${process.env.FIREBASE_ADMIN_PROJECT_ID}.firebasestorage.app`;
  }
  return undefined;
}

function initAdmin(): App {
  if (getApps().length) return getApp();
  const storageBucket = resolveStorageBucket();

  const keyPath = resolve(process.cwd(), "serviceAccountKey.json");
  if (existsSync(keyPath)) {
    return initializeApp({
      credential: cert(JSON.parse(readFileSync(keyPath, "utf8"))),
      storageBucket,
    });
  }
  return initializeApp({
    credential: applicationDefault(),
    storageBucket,
  });
}

export function adminAuth(): Auth {
  return getAuth(initAdmin());
}
export function adminDb(): Firestore {
  return getFirestore(initAdmin());
}
export function adminStorage(): Storage {
  return getStorage(initAdmin());
}
