# Radiology Report Generator — Setup (Phase 1)

Phase 1 is role + workflow plumbing: auth, the radiologist new-case form, the
Firestore write, and the typist/reviewer queues. **No AI, DOCX export, or rich
editor yet** — those are Phase 2+.

## Prerequisites

- Node 18+ (developed on Node 24) and npm.

## 1. Install

```bash
npm install
```

## 2. Create a Firebase project

1. Create a project at <https://console.firebase.google.com>.
2. **Authentication → Sign-in method →** enable **Email/Password**.
3. **Firestore Database →** create a database (production mode).
4. **Project settings → Your apps → Web app (`</>`)** → register an app and copy
   the config values.

## 3. Configure environment

```bash
cp .env.local.example .env.local
```

Fill the `NEXT_PUBLIC_FIREBASE_*` values from the web-app config. For the
role-assignment script (and Phase 2 server actions) also set the
`FIREBASE_ADMIN_*` values, **or** drop a service-account key at the repo root as
`serviceAccountKey.json` (Project settings → Service accounts → Generate new
private key). Both `.env.local` and `serviceAccountKey.json` are git-ignored.

## 4. Deploy the security rules

Paste `firestore.rules` into Firebase console → Firestore → Rules → Publish, or
with the Firebase CLI: `firebase deploy --only firestore:rules`.

## 5. Create users and assign roles

1. In Firebase console → Authentication, add an email/password user for each
   person (radiologist, typist, reviewer).
2. Assign a role (sets the custom claim **and** writes `users/{uid}`):

   ```bash
   npx tsx scripts/set-role.ts radiologist@clinic.in radiologist "Dr K Valli Manasa"
   npx tsx scripts/set-role.ts typist@clinic.in       typist      "Vijaya"
   npx tsx scripts/set-role.ts reviewer@clinic.in     reviewer    "Reviewer Name"
   ```

   The custom claim takes effect after the user signs out and back in. Until
   then the app falls back to the `users/{uid}` role the script just wrote, so
   login works immediately.

## 6. Run

```bash
npm run dev   # http://localhost:3000
```

- **Radiologist** → `/radiologist/new`: create a case → it lands in the typist queue.
- **Typist** → `/typist/queue`: see the case, click to open it (read-only for now).
- **Reviewer** → `/reviewer/queue`: see cases awaiting review.

## Important notes

- **PHI:** `Templates/` and `Approved  data/` hold real templates and ~190
  approved patient reports. They are git-ignored — never commit them. In Phase 3
  they move to Firebase Storage via a seed script.
- **shadcn/ui runs on Tailwind v3 + Radix** (the stable, documented combo for
  Next 14). Do **not** run `npx shadcn@latest add …` — its current default
  ("base-nova") pulls Tailwind v4 + Base UI and breaks this setup. Add new
  components by hand in `components/ui/` matching the existing files, or pin a
  Tailwind-v3-compatible shadcn CLI version.
- Firebase initialization in `lib/firebase.ts` is guarded so `npm run build`
  succeeds even without credentials (e.g. CI/preview); it initializes for real
  on the client and in production SSR where the public config is present.
