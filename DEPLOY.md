# Deploying to Firebase App Hosting

App Hosting builds this Next.js app from your GitHub branch (via Cloud Build) and
serves it on Cloud Run + CDN. Config lives in `apphosting.yaml`.

## Prerequisites

- The Firebase project must be on the **Blaze (pay-as-you-go) plan** — App Hosting
  requires it. (The free Spark plan won't work.)
- Code pushed to a **GitHub** repo (App Hosting deploys from GitHub).

## 1. Push to GitHub

Git is already initialized and your PHI folders (`Templates/`, `Approved  data/`)
are git-ignored. Create an empty GitHub repo, then:

```bash
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

## 2. Create the App Hosting backend

Firebase Console → **Build → App Hosting → Get started**:

- Connect GitHub and select this repo + the **live branch** (`main`).
- **Region:** choose `asia-south1` (Mumbai) for India data residency.
- Root directory: `/`.
- Finish — it runs the first rollout using `apphosting.yaml`.

Every later `git push` to `main` triggers a new rollout automatically.

## 3. Environment variables / secrets

- Public `NEXT_PUBLIC_FIREBASE_*` values are already in `apphosting.yaml` (safe to
  commit; inlined into the browser bundle at build time).
- Phase 2 secrets (e.g. `ANTHROPIC_API_KEY`) go in Cloud Secret Manager, not the file:
  ```bash
  firebase apphosting:secrets:set ANTHROPIC_API_KEY
  ```
  then uncomment the `secret:` block in `apphosting.yaml`.

## 4. Authorize the live domain for sign-in

After the first deploy you'll get a domain like
`https://<backend>--<project>.<region>.hosted.app`.

Firebase Console → **Authentication → Settings → Authorized domains → Add domain**
→ add that domain (and any custom domain). Otherwise sign-in fails on the live site.

## 5. Deploy Firestore security rules

Still required — App Hosting does not deploy rules:

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```

(`firebase.json` and `.firebaserc` are already wired to your project and
`firestore.rules`.)

## Notes

- `minInstances: 0` scales to zero to save cost (occasional cold starts); set `1`
  for always-warm.
- App Hosting builds Next.js natively — no Dockerfile or `output: standalone`.
- Optional local link to the backend: `firebase init apphosting`.
