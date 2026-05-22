import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

// Client SDK config. All NEXT_PUBLIC_* values are safe to ship to the browser;
// access is governed by Firestore/Storage security rules, not by hiding the key.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app: FirebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);

// Guard initialization so a credential-less build (e.g. `next build` before
// .env.local is set, or a CI/preview without env) does not throw at import.
// On the client `window` exists; in production SSR the public config is present.
const canInit = typeof window !== "undefined" || Boolean(firebaseConfig.apiKey);

export const auth: Auth = canInit
  ? getAuth(app)
  : (undefined as unknown as Auth);
export const db: Firestore = canInit
  ? getFirestore(app)
  : (undefined as unknown as Firestore);
export const storage: FirebaseStorage = canInit
  ? getStorage(app)
  : (undefined as unknown as FirebaseStorage);

export default app;
