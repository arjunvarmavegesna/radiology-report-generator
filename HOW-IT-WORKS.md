# Radiology Report Generator — How it works

A walkthrough of every screen, the data flow behind each one, and the operational pieces. Pair this with `SETUP.md` (first-time setup) and `DEPLOY.md` (Firebase App Hosting).

## Table of contents

1. [What this is](#1-what-this-is)
2. [The workflow at a glance](#2-the-workflow-at-a-glance)
3. [The three roles](#3-the-three-roles)
4. [The screens](#4-the-screens)
   - 4.1 [`/login` — Sign in](#41-login--sign-in)
   - 4.2 [`/` — Root redirect](#42---root-redirect)
   - 4.3 [`/radiologist/new` — New case](#43-radiologistnew--new-case)
   - 4.4 [`/radiologist/cases` — My cases](#44-radiologistcases--my-cases)
   - 4.5 [`/typist/queue` — Typing queue](#45-typistqueue--typing-queue)
   - 4.6 [`/typist/case/[id]` — Typist case view](#46-typistcaseid--typist-case-view)
   - 4.7 [`/reviewer/queue` — Review queue](#47-reviewerqueue--review-queue)
   - 4.8 [`/reviewer/case/[id]` — Reviewer case view](#48-reviewercaseid--reviewer-case-view)
5. [Behind the screens](#5-behind-the-screens)
   - 5.1 [Data model](#51-data-model)
   - 5.2 [AI report generation](#52-ai-report-generation)
   - 5.3 [DOCX export](#53-docx-export)
   - 5.4 [Security and access control](#54-security-and-access-control)
   - 5.5 [Tagged templates](#55-tagged-templates)
   - 5.6 [Reference corpus](#56-reference-corpus)
6. [Operations](#6-operations)
7. [File map](#7-file-map)
8. [What's not built yet](#8-whats-not-built-yet)

---

## 1. What this is

A small web app for an ultrasound/radiology clinic in India (consultant: Dr K Valli Manasa, MD).

**The problem it solves:** today, the typist opens a Word template, copies the radiologist's shorthand findings, manually expands them into formal clinical sentences, fills in standard "normal" boilerplate for organs the radiologist didn't mention, writes the IMPRESSION, and saves the file. It's slow and error-prone.

**What this app does:** the radiologist submits the case + shorthand from one screen. The typist clicks **Generate** and Claude AI drafts the formal report from the radiologist's notes + the scan-type's empty Word template + 5 previously-approved reports from the same scan type (used as style/phrasing examples). The typist edits, resolves any `[VERIFY]` flags the AI raised, and submits to the reviewer. The reviewer reviews, edits if needed, and clicks **Approve & export** — the app generates the final `.docx` (preserving the original template's fonts, signature alignment, and bilingual PC&PNDT compliance text), uploads it to Firebase Storage, and downloads it to the reviewer's browser.

Three humans remain in the loop on every report — the AI is a writing assistant, never a diagnostic system.

---

## 2. The workflow at a glance

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Radiologist │ →  │    Typist    │ →  │   Reviewer   │ →  │     .docx    │
│              │    │              │    │              │    │              │
│ enter        │    │ Generate     │    │ review       │    │ rendered     │
│ patient +    │    │ (AI draft)   │    │ + edit       │    │ from tagged  │
│ shorthand    │    │ + edit       │    │ + approve    │    │ template;    │
│ notes        │    │ + resolve    │    │ → triggers   │    │ uploaded to  │
│              │    │ [VERIFY]     │    │ export       │    │ Storage; URL │
│              │    │ flags        │    │              │    │ auto-opens   │
│              │    │ → submit     │    │              │    │ in browser   │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
   status:             status:             status:             status:
 pending_typing      pending_review        approved            approved
```

Every status change writes to Firestore. The case object accumulates a `draftReport` (AI's), `editedReport` (typist's), and `finalReport` (reviewer's) so you can see exactly what changed at each step (basis for the audit log when that UI lands).

---

## 3. The three roles

| Role | What they do | Home page | Custom claim |
|---|---|---|---|
| **Radiologist** | Enters patient details + the scan type + their shorthand findings. | `/radiologist/new` | `role: "radiologist"` |
| **Typist** | Drafts the formal report from the radiologist's notes (AI-assisted) and submits it to the reviewer. | `/typist/queue` | `role: "typist"` |
| **Reviewer** | Final QA; edits if needed; clicks Approve & export to generate the final `.docx`. | `/reviewer/queue` | `role: "reviewer"` |

A user has exactly one role at a time. To switch roles for testing, re-run `scripts/set-role.ts` and sign out/in. The role is read from the Firebase ID token's custom claim, with a fallback to the `users/{uid}` Firestore doc.

---

## 4. The screens

All screens share a header (`components/app-header.tsx`) showing the app name, role-specific nav links, a role badge, the signed-in user's name, and a Sign-out button. Each role area is wrapped by `components/role-guard.tsx` which redirects unauthenticated users to `/login` and wrong-role users to their own home.

### 4.1 `/login` — Sign in

**Who:** anyone not yet signed in.

**Layout:** centered card on a muted background.

**Fields:**
- Email
- Password
- **Sign in** button (full width)

**Behavior:**
- On submit → `firebase/auth.signInWithEmailAndPassword`.
- On success → an effect watches `useAuth()` and redirects to `roleHome(role)` (the user's role home).
- On invalid credentials → red toast "Invalid email or password."
- If the user signs in but has no role assigned, the card swaps to a "No role has been assigned to this account. Contact an administrator." message with a Sign-out button — they cannot proceed.

**Code:** `app/login/page.tsx`.

---

### 4.2 `/` — Root redirect

Not really a screen — it shows "Loading…" for a beat and then redirects:

- Not signed in → `/login`
- Signed in, role known → `roleHome(role)` (e.g. `/radiologist/new`)

**Code:** `app/page.tsx`.

---

### 4.3 `/radiologist/new` — New case

**Who:** signed-in user with `role: "radiologist"`.

**Layout:** a single Card titled "New Case", a responsive two-column grid of form fields, a full-width textarea at the bottom.

**Fields:**
- **Patient Name** (Input, required)
- **Age** (Input, required — free text, e.g. "32 yrs" or "6 months")
- **Gender** (RadioGroup: Male / Female, required)
- **MR Number** (Input, required)
- **Date of Examination** (HTML date picker — defaults to today; converted to dd/mm/yyyy for the report)
- **Referring Doctor** (Input, optional)
- **Scan Type** (Select with all 21 scan types — "Thyroid / Neck", "Whole Abdomen (Female)", "TIFFA (Twins)", etc.)
- **Radiologist's Shorthand Notes** (Textarea, mono font, 8 rows, required — example placeholder: `RT lobe 2.5x1.2x1.2, hyperechoic nodule 7x7mm TIRADS-III follow up`)

Required fields are marked with a red `*`.

**Behavior:**
- On Submit → validates all required fields are non-empty.
- Calls `createCase(input, user.uid)` from `lib/cases.ts` → writes a new doc to Firestore `cases/{caseId}` with `status: "pending_typing"`, all the report fields nulled out, server timestamps for `createdAt` / `updatedAt`.
- On success → green toast "Case created and sent to the typist queue." Form fields reset to defaults; the radiologist can immediately enter another case.
- On error → red toast with the error message.

**Code:** `app/radiologist/new/page.tsx` + `components/new-case-form.tsx`.

---

### 4.4 `/radiologist/cases` — My cases

**Who:** signed-in user with `role: "radiologist"`.

**Layout:** a single Card titled "My Cases" with a Refresh button (top-right) and a Table.

**Table columns:**
- Patient
- MR No.
- Scan Type
- Date of Exam
- Status (colored Badge — amber "Pending typing", blue "Pending review", green "Approved")
- Created (Firestore timestamp, formatted)

**Behavior:**
- On mount: calls `getCasesByRadiologist(user.uid)` — only the radiologist's own cases, newest first.
- Refresh button re-fetches.
- States: "Loading…" / "No cases yet." / error message — each as a single muted full-width row.
- Rows are not clickable (radiologists don't edit their submissions after the fact).

**Code:** `app/radiologist/cases/page.tsx`.

---

### 4.5 `/typist/queue` — Typing queue

**Who:** signed-in user with `role: "typist"`.

**Layout:** Card titled "Typing Queue" with description "Cases awaiting typing, oldest first." and a Refresh button.

**Table columns:**
- Patient (bold)
- MR No.
- Scan Type
- Date of Exam
- Ref. Doctor
- Received (case `createdAt`, formatted)

**Behavior:**
- On mount: `getTypingQueue()` — every case where `status == "pending_typing"`, sorted client-side by `createdAt` ascending.
- Each row has `cursor-pointer` and `hover:bg-muted/50`; clicking pushes to `/typist/case/${c.id}`.
- States: "Loading…" / "The queue is empty." / error.

**Code:** `app/typist/queue/page.tsx`.

---

### 4.6 `/typist/case/[id]` — Typist case view

**Who:** `role: "typist"`. The main work surface.

**Layout:** a three-column grid (`md:grid-cols-3 gap-6`):

```
┌─────────────────────────┬────────────────────────────────────────────┐
│ LEFT (md:col-span-1)    │ RIGHT (md:col-span-2)                      │
│                         │                                            │
│ ┌─────────────────────┐ │ ┌────────────────────────────────────────┐ │
│ │ Patient             │ │ │ Report                  [Generate / ⟳] │ │
│ │ Name / Age / Gender │ │ │ AI-drafted from notes; review + edit.  │ │
│ │ MR / Date / RefDoc  │ │ ├────────────────────────────────────────┤ │
│ │ Scan Type           │ │ │ ⚠ Verify (2/5) — resolve all to submit │ │
│ │ [Status badge]      │ │ │  ☐ measurement missing for left kidney │ │
│ └─────────────────────┘ │ │  ☐ contradiction: lobe size vs nodule  │ │
│                         │ │  ☑ unclear: "u/p" — confirm meaning    │ │
│ ┌─────────────────────┐ │ │  ...                                   │ │
│ │ Radiologist's Notes │ │ ├────────────────────────────────────────┤ │
│ │ (mono font, raw     │ │ │ Scan Title:  [____________________]    │ │
│ │  shorthand)         │ │ │                                        │ │
│ │                     │ │ │ Sections (organ-by-organ):  [+ Add]    │ │
│ └─────────────────────┘ │ │  ┌──────────────────────────────────┐  │ │
│                         │ │  │ [Liver]              [Remove]     │ │ │
│                         │ │  │ [textarea — findings]             │ │ │
│                         │ │  └──────────────────────────────────┘  │ │
│                         │ │  ... (more sections)                   │ │
│                         │ │                                        │ │
│                         │ │ Impression:                  [+ Add]   │ │
│                         │ │  ☐ [textarea — abnormal finding]       │ │
│                         │ │  ☐ [textarea]                          │ │
│                         │ │                                        │ │
│                         │ │ Compliance text (OB only):             │ │
│                         │ │  [textarea]                            │ │
│                         │ │                                        │ │
│                         │ │                  [Save draft] [Submit] │ │
│                         │ └────────────────────────────────────────┘ │
└─────────────────────────┴────────────────────────────────────────────┘
```

**Left column** (read-only, always visible):
- **Patient card** — name, age, gender, MR no., date of exam, ref. doctor, scan type. Status badge in the card header.
- **Radiologist's Notes card** — the raw shorthand from the radiologist, in `whitespace-pre-wrap` mono font.

**Right column:**
- **Report card** — the main editor, with a **Generate report** button (or **Regenerate** if a draft exists) in the card header.
  - **Verify-flag checklist** (amber-bordered panel) — only appears if the AI raised flags. Shows each flag as a checkbox + label. `Submit to reviewer` is disabled until every box is ticked. Brief rule 8.
  - **Scan Title** — Input. Defaults to the scan-type label uppercased ("ULTRASOUND NECK") but the AI/typist can edit.
  - **Sections** — a dynamic list of `{label, body}` rows. Each row has a small Input for the label ("Liver", "Right lobe of thyroid"), a Textarea for the findings, and Remove/Add buttons.
  - **Impression** — a dynamic list of bullet strings. Each is its own Textarea row with Remove/Add.
  - **Compliance text** — only rendered for OB scans (NT, TIFFA, growth, early-preg, fetal echo and their twins variants). Always optional in the UI; the tagged template carries the verbatim PC&PNDT block, so this field is informational unless you want to override it for a specific case.

**Behavior:**
- On mount: `getCase(id)` → loads the case. Picks the report to display, in order of preference: `editedReport` (typist's last save) → `draftReport` (last AI generation) → `emptyReport(c)` (blank shell with patient header pre-filled from the case).
- **Generate report** → POSTs `/api/generate/{caseId}` with the Firebase ID token in the Authorization header. The route calls Claude Sonnet 4.6 (see §5.2) and returns the structured `ReportJSON`. The page replaces `report` state with the AI's output; resolved-flag checkboxes reset. Green toast: "Draft ready. Resolve N verify flags before submitting." (or just "Draft ready" if none).
- **Save draft** → `saveTypistDraft(...)` writes `editedReport` and claims the case (`typistId`) without changing status.
- **Submit to reviewer** → validates (scan title non-empty, ≥1 section, ≥1 impression, all verify flags resolved) → `submitToReviewer(...)` writes `editedReport`, sets `status: "pending_review"`, stamps `typistSubmittedAt`. Then redirects to `/typist/queue`.

**Lock state:** if the case is no longer `pending_typing` (someone else already submitted, or the typist navigates back to a case they previously submitted), the editor is disabled and a muted note shows "Case is no longer pending typing — it's <status>. Editing is disabled."

**Code:** `app/typist/case/[id]/page.tsx` + `components/report-editor.tsx` (shared with the reviewer).

---

### 4.7 `/reviewer/queue` — Review queue

**Who:** `role: "reviewer"`.

**Layout:** Card titled "Review Queue", "Cases awaiting final review, oldest first.", Refresh button.

**Table columns:**
- Patient (bold)
- MR No.
- Scan Type
- Submitted (the `typistSubmittedAt` timestamp)

**Behavior:**
- On mount: `getReviewQueue()` — all cases with `status == "pending_review"`, sorted client-side by `typistSubmittedAt` asc.
- Rows clickable → `/reviewer/case/${c.id}`.
- States: "Loading…" / "No cases awaiting review." / error.

**Code:** `app/reviewer/queue/page.tsx`.

---

### 4.8 `/reviewer/case/[id]` — Reviewer case view

**Who:** `role: "reviewer"`.

**Layout:** same three-column grid as the typist case view, but the editor side has a different button row and a download-link panel that appears after a successful export.

**Left column:** identical to the typist's — Patient card (with status badge) and Radiologist's Notes card. The Patient card also shows **Submitted** (when the typist sent it over).

**Right column — Final Review card:**
- Description: "Edit if needed, then approve. Approval generates the final .docx and downloads it."
- **Success banner** (only after a successful export): a green-bordered panel reading "✓ DOCX ready. The download should have started automatically. If your browser blocked it, **click here to download**." That "click here" is a plain `<a href>` to the signed URL — popup blockers can't intercept it. Link is valid for 7 days.
- The **ReportEditor** (same component the typist used), populated from `finalReport` ?? `editedReport` ?? `draftReport`. Editable while status is `pending_review`; locked otherwise.
- **Action buttons** depend on status:
  - `pending_review` → **Save edits** (outline) and **Approve & export** (primary).
  - `approved` → **Re-export & download** (outline) — re-renders the docx with the current `finalReport`, useful if the original signed URL expired or the file got lost.

**Behavior:**
- **Save edits** → `saveReviewerDraft(...)` writes `finalReport` and claims the case for the reviewer without changing status.
- **Approve & export** → validates → calls `POST /api/export/{caseId}` with the Firebase ID token + `{ report }` in the body. The route (see §5.3) renders the tagged template, uploads the docx to Firebase Storage, marks the case `approved`, and returns a signed download URL.
  - On success: the page stores the URL in state (so the green banner is sticky), triggers a synthetic `<a>` click for the auto-download, and refreshes the case so the status badge updates.
  - **No auto-redirect** — the reviewer stays on the page so the success banner + manual download link remain available.
- **Re-export & download** (on already-approved cases) — same code path; re-renders the docx (idempotent), returns a fresh signed URL.

**Lock state:** if the case isn't `pending_review` and isn't `approved` (shouldn't happen, but if a reviewer navigates to a still-`pending_typing` case via URL hack), the editor is disabled with a muted note.

**Code:** `app/reviewer/case/[id]/page.tsx` + `components/report-editor.tsx`.

---

## 5. Behind the screens

### 5.1 Data model

#### `cases/{caseId}` — Firestore

Created by the radiologist; updated by typist and reviewer; never deleted.

```ts
{
  // patient header (set at creation, never edited)
  patientName: string,
  age: string,
  gender: 'Male' | 'Female',
  mrNumber: string,
  dateOfExam: string,      // dd/mm/yyyy
  refDoctor: string,

  // the scan
  scanType: string,        // one of the 21 canonical values (lib/scan-types.ts)
  radiologistId: string,
  radiologistNotes: string,  // the radiologist's raw shorthand

  // workflow status
  status: 'pending_typing' | 'pending_review' | 'approved',

  // the three layers of the report — populated as the case moves through the workflow
  draftReport: ReportJSON | null,     // last AI generation
  editedReport: ReportJSON | null,    // typist's last save
  finalReport: ReportJSON | null,     // reviewer's final approved version

  // handoff metadata
  typistId: string | null,
  typistSubmittedAt: Timestamp | null,
  reviewerId: string | null,
  reviewerApprovedAt: Timestamp | null,

  // final docx artifact
  finalDocxPath: string | null,       // e.g. final/<caseId>/<patient>_<scanType>.docx

  // timestamps
  createdAt: Timestamp,
  updatedAt: Timestamp,
}
```

`ReportJSON` shape (defined in `lib/types.ts`):

```ts
{
  patientDetails: { name, age, gender, mrNumber, date, refDoctor },
  scanTitle: string,                        // e.g. "ULTRASOUND NECK"
  sections: { label: string, body: string }[],
  impression: string[],
  verifyFlags: string[],                    // AI-raised concerns; typist resolves
  complianceText: string | null,            // for OB scans (informational; not used by export)
}
```

#### `users/{uid}` — Firestore

```ts
{ name: string, email: string, role: Role, active: boolean }
```

Written by `scripts/set-role.ts`. Read by the client auth context (as a fallback when the custom claim isn't set yet) and by Firestore rules (as the source of truth for authorization).

#### Audit log (not yet built)

The brief specifies an immutable `auditLog` subcollection under each case to record every status transition with before/after snapshots. The Firestore rules already permit append-only writes — the UI for viewing the audit trail is a Phase 3 deliverable.

---

### 5.2 AI report generation

When the typist clicks **Generate report**:

1. **Client** — `app/typist/case/[id]/page.tsx`:
   - Gets a fresh Firebase ID token via `user.getIdToken()`.
   - `POST /api/generate/{caseId}` with `Authorization: Bearer <token>`.

2. **Server route** — `app/api/generate/[caseId]/route.ts`:
   - Verifies the ID token with the Firebase Admin SDK.
   - Reads the user's role from the token claim, falling back to `users/{uid}.role`.
   - Allows `typist` or `radiologist` (so a radiologist can pre-draft if they want).
   - Loads the case from Firestore via the Admin SDK (bypasses security rules; we already enforced auth).
   - Calls `generateReport(case)` from **`lib/ai.ts`** (the provider dispatcher — see §5.2.4).

3. **`generateReport(c)` shared work** (both providers do this via `lib/ai-shared.ts`):
   - Maps the case's `scanType` to the source `.docx` template (`Templates/<file>.docx`) and extracts plain text via `lib/extract-docx-text.ts` (cached in memory).
   - Fetches up to 5 reference reports for that scan type from `lib/reference-corpus.ts` (extracted to plain text, alphabetically sorted — see §5.6).
   - Builds a **two-block user message**:
     - **Block 1 (static):** template plain-text + 5 reference examples — typically 8K–20K tokens. Cacheable on the Claude path.
     - **Block 2 (volatile):** patient details + the radiologist's shorthand notes — typically ~200 tokens. Per-request.

4. **Provider-specific call** — handled by `lib/anthropic.ts` or `lib/gemini.ts`. Both honor the same `ProviderResult` contract; the route is provider-agnostic.

5. **Server route** then:
   - Persists `result.report` to `cases/{caseId}.draftReport`.
   - Claims the case for the typist if not already claimed (`typistId`).
   - Returns `{ report, usage, provider }` to the client.

6. **Client** — sets `report` state to the AI's output. The editor re-renders with the AI-drafted scan title, sections, impression. Any `verifyFlags` populate the amber checklist. Submit-to-reviewer is hard-gated until every flag is checked.

#### 5.2.1 System prompt

Verbatim from Section 6 of the brief, with the 10 absolute rules (don't invent findings, don't change patient details, match reference phrasing, flag ambiguities, etc.). Lives in `lib/ai-shared.ts` — used by both providers, so the AI's behavior contract is identical regardless of which model generates the draft.

#### 5.2.2 Claude path (`lib/anthropic.ts`)

- Model: `claude-sonnet-4-6`.
- `client.messages.parse({...})` with `output_config.format: zodOutputFormat(reportJsonSchema)` — strict JSON output, validated against the Zod schema by the SDK before it returns.
- `temperature: 0.2`, `thinking: { type: "disabled" }`, `output_config.effort: "low"` — this is a structured-writing task, not reasoning.
- **Prompt caching:** the static block carries `cache_control: { type: "ephemeral" }`. The first request on a given scan type writes the cache; subsequent requests within ~5 minutes read it at ~0.1× cost.
- **Per-case cost**: first request ~$0.05, cache hits ~$0.02–0.03. No free tier.

#### 5.2.3 Gemini path (`lib/gemini.ts`)

- Model: `gemini-2.5-pro`.
- `ai.models.generateContent({...})` with `config.responseMimeType: "application/json"` and `config.responseSchema` (a typed `Type.OBJECT` mirror of the Zod schema) — strict JSON output.
- Same `temperature: 0.2` and `maxOutputTokens: 8192`.
- After the call, the parsed JSON is run through the same Zod schema (`reportJsonSchema.safeParse(...)`) as a defense-in-depth check — catches the rare case where Gemini drops a required field under tight token budgets.
- **No prompt caching on the free tier** — Gemini's Context Caching API is paid-tier only. The static/volatile block structure still applies (the model sees a consistent shape) — just no cache hits to count.
- **Per-case cost**: $0 on the free tier (5 RPM / 250K TPM / 25 RPD on Pro, plenty for a small clinic). $0.0001–0.001/case on the paid tier.

#### 5.2.4 Provider dispatcher (`lib/ai.ts`)

A thin `pickProvider()` function reads the `AI_PROVIDER` env var and resolves which path to use:

| `AI_PROVIDER` | What happens |
|---|---|
| `claude` or `anthropic` | Claude (errors if `ANTHROPIC_API_KEY` missing) |
| `gemini` or `google` | Gemini (errors if `GEMINI_API_KEY` missing) |
| unset | Auto: `ANTHROPIC_API_KEY` set → Claude; else `GEMINI_API_KEY` set → Gemini; else falls back to Claude so the error message is the most actionable |

The route's response includes `provider` so the client (and any future audit log) can record which model generated each draft. To compare providers on the same case, change `AI_PROVIDER` in `.env.local`, restart `npm run dev`, and click **Regenerate**.

#### 5.2.5 Provider tradeoffs

| | Claude Sonnet 4.6 | Gemini 2.5 Pro |
|---|---|---|
| **Free tier** | None | Yes — covers a small clinic comfortably |
| **Quality on this task** | Slightly stronger on "NEVER invent findings" rule-following | Comparable; very slightly looser on strict literal instruction-following |
| **Prompt caching** | Free, ~90% off on repeats | Paid-tier only |
| **Strict JSON output** | `messages.parse()` + Zod | `responseSchema` + post-parse Zod |
| **Per-case cost** | ~$0.03 with caching | $0 on free tier, ~$0.0005 paid |
| **Rate limits** | High (paid) | Free Pro: 5 RPM / 25 RPD; Free Flash: ~10× higher |

Default to Gemini for cost; switch to Claude if you ever see Gemini fabricate a finding (rule 1 violation) — Claude historically follows instruction-following rules with marginally higher fidelity for clinical work like this.

---

### 5.3 DOCX export

When the reviewer clicks **Approve & export**:

1. **Client** — `app/reviewer/case/[id]/page.tsx`:
   - `POST /api/export/{caseId}` with `Authorization: Bearer <id-token>` and `{ report: cleanedFinalReport }` in the body.

2. **Server route** — `app/api/export/[caseId]/route.ts`:
   - Verifies the ID token; requires `role: "reviewer"`.
   - Looks up the tagged template path for `case.scanType` (derived from `lib/scan-types.ts` — every scan type maps to `data/templates-tagged/<scanType>.tagged.docx`).
   - Opens the tagged template via `pizzip`, instantiates `Docxtemplater` with `paragraphLoop: true, linebreaks: true`.
   - Calls `doc.render({ ... })` with values from the report: `patientName`, `age`, `gender`, `mrNumber`, `date`, `refDoctor`, `scanTitle`, `sections` (array of `{label, body}`), `impression` (array of strings).
   - The tagged template's `{#sections}...{/sections}` and `{#impression}- {.}{/impression}` loops expand into the correct number of paragraphs. The signature block + (for OB) bilingual PC&PNDT compliance text live in the preserved tail of the tagged template — they pass through verbatim.
   - Generates the output buffer; uploads to Firebase Storage at `final/{caseId}/{safePatientName}_{scanType}.docx`.
   - Creates a signed read URL valid for 7 days with `responseDisposition: 'attachment; filename="..."'` — this forces the browser to download instead of preview, regardless of how the URL is opened.
   - Updates the case: `finalReport`, `finalDocxPath`, `status: "approved"`, `reviewerId`, `reviewerApprovedAt`.
   - Returns `{ downloadUrl, storagePath }`.

3. **Client**:
   - Stores `downloadUrl` in state → the success banner becomes visible and stays visible (so the reviewer can re-click the link if the auto-download fails).
   - Triggers a synthetic `<a>` click on the URL. Combined with the `Content-Disposition: attachment` header, this reliably downloads instead of opening a new tab — even on browsers with aggressive popup blockers (Brave).
   - Reloads the case so the status badge updates to "Approved" and the editor locks.

**Re-export** — the same `POST /api/export/{caseId}` works on an already-approved case. The "Re-export & download" button on the reviewer case view uses it (e.g. when the original signed URL expired or got lost). The Firestore update is idempotent (same content, fresh signed URL).

---

### 5.4 Security and access control

There are four layers:

1. **Firebase Auth** (`lib/firebase.ts` + `lib/auth-context.tsx`) — handles email/password sign-in and exposes the current user + role via `useAuth()`. The auth layer initialization is guarded so `npm run build` succeeds even without credentials.

2. **Custom claims** — the canonical source of role. Set by `scripts/set-role.ts` via the Admin SDK:
   ```bash
   npx tsx scripts/set-role.ts user@clinic.in radiologist "Dr K Valli Manasa"
   ```
   The user must sign out and back in for the new claim to take effect. The auth context falls back to the `users/{uid}.role` Firestore doc the script writes, so login works immediately.

3. **Firestore security rules** (`firestore.rules`) — enforce data-layer authorization. Highlights:
   - `users/{uid}` — only the user themselves and reviewers can read; writes are server-only (admin SDK / set-role script).
   - `cases/{caseId}` — radiologists can read only their own cases; typists can read pending-typing cases and their own assigned ones; reviewers can read everything.
   - Cases are append-only-ish: deletion is forbidden. Auditing is a non-goal of the rules; that's the audit-log subcollection's job (Phase 3 UI).

4. **API route guards** — every server route under `app/api/` independently verifies the Firebase ID token via the Admin SDK and checks the required role. Even if the Firestore rules were misconfigured, the routes wouldn't let an unauthorized request through.

Storage is read/written exclusively via the Admin SDK on the server. Clients receive short-lived **signed URLs** for downloads — they never need direct Storage access, so the Storage rules can remain locked-down (deny-all is fine).

---

### 5.5 Tagged templates

The clinic has 21 distinct scan-type templates (whole abdomen male/female, thyroid neck, breast, NT/TIFFA/growth/early-pregnancy/fetal-echo and their twin variants, the doppler family, soft parts, scrotum, pelvis). For each, `data/templates-tagged/<scanType>.tagged.docx` is a docxtemplater-tagged copy of the original.

**How tagging works** (see `scripts/tag-templates.ts`):

1. Read the original `.docx` from `Templates/<file>.docx`.
2. Locate the **preserved tail anchor** — a contiguous string that marks the start of the part of the document we want to keep verbatim:
   - Non-OB templates: `"Dr.K"` (the signature line).
   - OB templates: `"Sex Determination"` (the start of the bilingual PC&PNDT compliance block).
   - Each config has an ordered fallback list (e.g. `["Sex Determination", "PC &amp; PNDT", "Dr.K"]`) — graceful degradation if Word re-saves a template and fragments a needle across XML runs.
3. Walk backward from the anchor to the enclosing `<w:p>` (or `<w:tbl>`) — that's the start of the preserved tail.
4. Capture everything from the tail start to `<w:sectPr>` (or `</w:body>`) **byte-for-byte**. This is what makes the doctor's signature alignment, the bilingual Telugu text, and any BI-RADS reference tables come through unchanged.
5. Replace everything BEFORE that anchor with hand-built placeholder paragraphs: patient header (`{patientName}`, `{age}`, …), the scan title (`{scanTitle}`), a methodology line where the original has one, then a `{#sections}{label}{body}{/sections}` multi-paragraph loop and a `{#impression}- {.}{/impression}` single-paragraph loop. The paragraph styling (Times New Roman 24, bold for headers, centered+underlined for the title) is hand-crafted to match the originals.
6. Write to `data/templates-tagged/<scanType>.tagged.docx`. Inline render-test with dummy data catches malformed XML. For OB templates, an additional assert verifies `"Sex Determination"` and `"PNDT"` survived in the output.

**Special case — early-pregnancy templates.** The source `.docx` files for `early_pregnancy` and `early_pregnancy_no_fhr` don't carry the bilingual PC&PNDT block, unlike the other 7 OB templates. To keep all OB exports consistent, the tagger reads the compliance block from `Templates/growth template.docx` once and splices it in-memory before tagging the two early-pregnancy templates. The source `.docx` files on disk are never modified — the addition lives only in the tagged output. Documented in `data/CLEANUP.md`.

**To re-tag everything after a template change:**
```bash
npx tsx scripts/tag-templates.ts
```

The script also performs two idempotent file moves at the top of `main()`: it relocates two patient reports that were misfiled in `Templates/` (M. Nagadurga's NT scan, and a thyroid report under the misleading filename "Ultrasound neck.docx") into their proper `Approved  data/` category folders.

---

### 5.6 Reference corpus

`Approved  data/` (note the double space in the folder name) contains ~150 already-approved patient reports the clinic has accumulated, organized into 9 category folders. The AI uses up to **5 of these per request** as style/phrasing examples — Claude matches their sentence structure, terminology (TIRADS, BIRADS, "Ms." for measurements, "Grade-I fatty liver"), and impression phrasing.

The category folders don't map 1:1 to scan types (one OB folder lumps NT/TIFFA/growth/early-preg/fetal-echo; one doppler folder lumps all 5 doppler variants; one abdomen folder lumps male/female/pelvis). `lib/reference-corpus.ts` maps each of the 21 scan types to the right folder + filename-keyword filter:

| scan type | folder | filter |
|---|---|---|
| `thyroid_neck` | `Thyroid neck` | (no filter — all 29 reports) |
| `breast` | `Breast` | — |
| `soft_parts` | `soft parts` | — |
| `scrotum` | `scrotum` | — |
| `abdomen_male` / `abdomen_female` / `pelvis` | `Abdomens Male & female  & pelvis, KUB` | — |
| `fetal_echo` | `Fetal echo` + the mixed OB folder filtered by "fetal echo" | — / "fetal echo" |
| `nt_scan` | mixed OB folder | "NT scan", "NT" |
| `tiffa*` | mixed OB folder | "TIFFA" |
| `growth*` | mixed OB folder | "Growth" |
| `early_pregnancy*` | mixed OB folder | "Early pregnancy", "Early" |
| `venous_doppler*` | `dopplers` | "venous" |
| `arteries_doppler` | `dopplers` | "arterial", "arteries" |
| `carotid_doppler` | `dopplers` | "carotid" |
| `renal_artery_doppler` | `dopplers` | "renal" |

Results are sorted **alphabetically by filename**, not by mtime. Recency seems intuitive, but alphabetical is **deterministic** — the same top-5 set is returned across runs as long as no files are added/renamed, which keeps the prompt cache key stable. New approvals occasionally rotate the alphabetical top-5 (any new file alphabetically before the current top-5 bumps the last out), but within a 5-minute window the cache wins.

**Production deployment gap (current).** `Approved  data/` and `Templates/` are git-ignored (PHI policy) — they exist locally but don't ship with the App Hosting build. Local dev works fully; the production AI route would find no source templates or references. Two ways to close it:

- **Un-ignore `Templates/`** — empty templates aren't PHI; safe to commit and ship with the build. Refs would still be missing in production.
- **Phase 3 — corpus seed.** A one-time `scripts/seed-corpus.ts` uploads `Approved  data/*` to Firebase Storage under `reference/<category>/<filename>.docx` with metadata, and `lib/reference-corpus.ts` switches to reading from Storage (with an in-memory text-extract cache to keep latency tight). This is what the original brief specifies.

---

## 6. Operations

### 6.1 Adding a user

1. Firebase Console → **Authentication → Users → Add user** (email + password).
2. From the project root:
   ```bash
   npx tsx scripts/set-role.ts user@clinic.in radiologist "Full Name"
   ```
   (Replace the role with `typist` or `reviewer` as appropriate.)
3. Tell the user to sign in. If they were already signed in, they need to sign out and back in for the new claim to take effect.

The script needs admin credentials — either `serviceAccountKey.json` at the project root (preferred for the clinic's own laptop), `GOOGLE_APPLICATION_CREDENTIALS` pointing at a key file, or any `*firebase-adminsdk*.json` in the project root (auto-detected).

### 6.2 Deploying Firestore security rules

```bash
firebase login
firebase deploy --only firestore:rules
```

`firebase.json` and `.firebaserc` are wired up — the deploy command finds `firestore.rules` automatically.

### 6.3 Regenerating tagged templates

After editing any template `.docx` in `Templates/`:

```bash
npx tsx scripts/tag-templates.ts
```

The script:
- Performs the data-cleanup file moves (idempotent — safe to re-run).
- Re-tags all 21 templates from their `Templates/<file>.docx` sources.
- Runs an inline render-test on each output with dummy data.
- Runs an additional compliance-preservation check for the 9 OB templates.
- Fails loudly with the offending scan type if anything is wrong.

Commit the regenerated `data/templates-tagged/<scanType>.tagged.docx` files (they're tracked — empty templates, no PHI).

### 6.4 Updating a template's text or layout

For most edits (changing default "normal" boilerplate, fixing typos, adjusting fonts):

1. Edit `Templates/<file>.docx` in Word.
2. `npx tsx scripts/tag-templates.ts`.
3. Test by approving a case of that scan type and inspecting the exported `.docx`.

For more structural changes (e.g. you want a per-OB-scan compliance footer that differs from the growth-template one), edit `scripts/tag-templates.ts`'s config for that scan type and re-run.

### 6.5 Local development

Prerequisites: Node 18+, npm.

```bash
npm install
cp .env.local.example .env.local
# Fill in the NEXT_PUBLIC_FIREBASE_* values + ANTHROPIC_API_KEY
npm run dev
```

The dev server reloads `.env.local` on (re)start, not on save — if you edit it while the server is running, restart.

Without a Firebase API key, the build still compiles (firebase init is guarded); the auth flow won't work in the browser. Without an Anthropic API key, **Generate report** returns 500.

### 6.6 Production deployment (Firebase App Hosting)

The full setup is in `DEPLOY.md`. Summary:

- App Hosting needs the project on the **Blaze plan**.
- `apphosting.yaml` carries the public `NEXT_PUBLIC_FIREBASE_*` values inline (safe — they're identifiers, not secrets) with `availability: [BUILD, RUNTIME]` so they're inlined into the browser bundle at build time.
- Phase 2 secret (`ANTHROPIC_API_KEY`) is currently a commented-out block in `apphosting.yaml`. When you're ready to deploy AI:
  ```bash
  firebase apphosting:secrets:set ANTHROPIC_API_KEY
  ```
  …then uncomment the `secret:` block in `apphosting.yaml`.
- Code is deployed by pushing to GitHub. App Hosting auto-rolls out on push to the connected branch.
- **Don't deploy AI until the corpus seeding gap (§5.6) is closed**, or the route will fail at runtime.

---

## 7. File map

```
app/
  layout.tsx               — root layout: AuthProvider + Toaster
  page.tsx                 — root redirect (/ → /login or roleHome)
  globals.css              — Tailwind v3 + shadcn theme (slate/HSL)
  login/page.tsx           — sign-in screen
  radiologist/
    layout.tsx             — role guard + app header (radiologist nav)
    new/page.tsx           — new-case form
    cases/page.tsx         — my cases list
  typist/
    layout.tsx
    queue/page.tsx
    case/[id]/page.tsx     — typist case view (Generate, edit, verify, submit)
  reviewer/
    layout.tsx
    queue/page.tsx
    case/[id]/page.tsx     — reviewer case view (edit, Approve & export, re-export)
  api/
    generate/[caseId]/route.ts   — AI report drafting endpoint
    export/[caseId]/route.ts     — DOCX export endpoint

components/
  ui/                      — shadcn/ui primitives (Radix-based, Tailwind v3 style)
  role-guard.tsx           — client-side role gate
  app-header.tsx           — top nav bar
  new-case-form.tsx        — the radiologist's form
  report-editor.tsx        — the structured ReportJSON editor (used by typist + reviewer)

lib/
  firebase.ts              — client SDK init (guarded against missing env)
  firebase-admin.ts        — server-only Admin SDK accessors
  auth-context.tsx         — useAuth() + AuthProvider
  types.ts                 — CaseDoc, ReportJSON, UserDoc, etc.
  scan-types.ts            — 21 canonical scan_type values + labels + isObstetric
  roles.ts                 — Role labels, roleHome()
  cases.ts                 — client-side Firestore CRUD (createCase, queue queries, etc.)
  format.ts                — date/timestamp helpers + status-badge styling
  utils.ts                 — cn() (Tailwind class merger)
  extract-docx-text.ts     — server-only plain-text extraction from .docx (cached)
  reference-corpus.ts      — scan_type → folder + filter → top-5 reference reports
  ai-shared.ts             — shared system prompt + Zod schema + message builders
  anthropic.ts             — Claude Sonnet 4.6 backend (messages.parse + prompt cache)
  gemini.ts                — Gemini 2.5 Pro backend (responseSchema + Zod post-validate)
  ai.ts                    — provider dispatcher (pickProvider + generateReport)

scripts/
  set-role.ts              — assign role + write users/{uid}
  tag-templates.ts         — generate data/templates-tagged/*.tagged.docx

data/
  templates-tagged/        — 21 docxtemplater-tagged template .docx files (tracked)
  CLEANUP.md               — notes on data moves + in-memory compliance injection

Templates/                  — original empty .docx templates (gitignored — see §5.6)
Approved  data/             — ~150 approved patient reports, by category (gitignored — PHI)

firestore.rules             — Firestore security rules
firestore.indexes.json      — Firestore composite indexes (empty — queries sort client-side)
firebase.json + .firebaserc — Firebase CLI wiring
apphosting.yaml             — Firebase App Hosting config
serviceAccountKey.json      — admin credentials (gitignored)
.env.local.example          — env-var template
.env.local                  — env vars (gitignored)

HOW-IT-WORKS.md             — this doc
SETUP.md                    — first-time setup
DEPLOY.md                   — App Hosting deployment
README.md                   — default Next.js README (untouched)
```

---

## 8. What's not built yet

Honest list, roughly ordered by priority:

1. **Production deployment of the AI** — needs the corpus seed (§5.6). Without it, `/api/generate` fails on App Hosting because `Templates/` and `Approved  data/` aren't in the deployed build.
2. **Audit-log UI** — the `auditLog` subcollection is permitted by Firestore rules but nothing writes to it yet, and there's no UI to view the trail. Brief Phase 3.
3. **Admin user management UI** — currently users are added via the Firebase console + the `set-role` script. An in-app `/admin/users` screen is in the brief.
4. **Tiptap rich-text editor** — the current `ReportEditor` is a structured form (Input + Textarea per field). The brief calls for Tiptap with `[VERIFY]` flags inline-highlighted in the editor itself. The hard-gate verify-flag checklist is a functional substitute today.
5. **`neurosonogram`** — the `Approved  data/neurosonogram/` folder has 2 reports but there's no `neurosonogram` scan_type or template. Add the type to `lib/scan-types.ts`, create a template in `Templates/`, run the tagger.
6. **Embedding-based reference retrieval** — current is alphabetical top-5. Brief Phase 4 calls for cosine-similarity over Claude embeddings to pick the most semantically relevant 5 references per case.
7. **Voice input for the radiologist** — Web Speech API → Deepgram fallback for the shorthand-notes textarea. Brief Phase 4.
8. **Bulk approve / batch export / case-history search** — Brief Phase 4.
9. **Mobile-friendly radiologist view** — current layout works on desktop and tablets but isn't optimized for phones. Brief Phase 4.
