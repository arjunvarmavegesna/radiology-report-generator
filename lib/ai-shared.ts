/**
 * Shared building blocks for the AI report-drafting pipeline. Both
 * lib/anthropic.ts (Claude) and lib/gemini.ts (Gemini) import from here, so
 * the system prompt, the per-scan template lookup, the message blocks, and
 * the report schema are a single source of truth across providers.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { extractDocxText } from "./extract-docx-text";
import { getReferenceReports } from "./reference-corpus";
import { SCAN_TYPES, scanTypeLabel } from "./scan-types";
import type { CaseDoc } from "./types";

/** scan_type → original (untagged) template path. The AI sees the boilerplate,
 *  not the placeholder-tagged version. */
export const SOURCE_TEMPLATES: Record<string, string> = Object.fromEntries(
  SCAN_TYPES.map((s) => {
    const map: Record<string, string> = {
      abdomen_male: "Templates/abdomen male format.docx",
      abdomen_female: "Templates/empty abdomen report female.docx",
      thyroid_neck: "Templates/Ultra sound thyroid neck.docx",
      breast: "Templates/Breast scan template.docx",
      nt_scan: "Templates/nt scan template.docx",
      nt_twins: "Templates/NT Twins template.docx",
      tiffa: "Templates/TIFFA TEMPLATE.docx",
      tiffa_twins: "Templates/Twins TIFFA.docx",
      growth: "Templates/growth template.docx",
      growth_twins: "Templates/twins growth.docx",
      early_pregnancy: "Templates/Early pregnancy template.docx",
      early_pregnancy_no_fhr: "Templates/Early pregnancy no FHR.docx",
      fetal_echo: "Templates/Fetal echo template.docx",
      venous_doppler: "Templates/Venous doppler template.docx",
      venous_doppler_single: "Templates/single limb venous doppler.docx",
      arteries_doppler: "Templates/Arteries doppler Template.docx",
      carotid_doppler: "Templates/carotid doppler Template.docx",
      renal_artery_doppler: "Templates/Renal artery doppler template.docx",
      soft_parts: "Templates/soft parts.docx",
      scrotum: "Templates/Scrotum template.docx",
      pelvis: "Templates/Ultra sound pelvis template.docx",
    };
    return [s.value, map[s.value]];
  }),
);

/** System prompt — the AI is now the sole author. No human review step, no
 *  verify-flag gate. The report it produces is rendered directly to .docx,
 *  opened in Word, and printed. Generate confidently and completely. */
export const SYSTEM_PROMPT = `You are the AI radiology report writer for an ultrasound clinic. You take a radiologist's findings (photographed handwriting, typed shorthand, or both) and produce a complete, formatted, print-ready report.

YOUR OUTPUT IS FINAL. There is no review queue, no verify-flag checklist, and no second-pass human edit before the report is filed. A clinician will open the .docx in Word for proofreading but will not check bracketed annotations. Generate confidently. Generate completely. Never insert placeholders, uncertainty markers, or bracketed notes in the report text — they look like errors when the patient receives the document.

HOW YOUR OUTPUT FILLS THE TEMPLATE:
The "TEMPLATE FOR THIS SCAN TYPE" shown below is the complete final document layout. When your JSON is rendered to .docx, ONLY these four fields fill placeholders:
  - scanTitle      → the title line (e.g. "ULTRASOUND NECK", "TIFFA SCAN")
  - sections[]     → the per-patient findings (measurements, organ-by-organ observations, abnormalities) — appears AFTER the title and any boilerplate intro
  - impression[]   → bullets in the IMPRESSION block
  - complianceText → PC&PNDT compliance for OB scans (null otherwise)

Everything else in the template — the standard procedure intro sentence ("High resolution ultrasound of the neck was done using a linear high frequency transducer.", "This study was carried out per ALARA guidelines.", etc.), section banners, the "IMPRESSION:" label, the signature block, "Dr. K Valli Manasa, MD" / "Consultant radiologist" — is BAKED INTO the template and rendered automatically by the .docx generator.

CRITICAL: do NOT put the standard procedure-description intro line into sections[]. Do NOT put the signature line or doctor's name into sections[]. Doing so produces duplicated text in the printed document. Start sections[] from the first per-patient FINDING (e.g., "Right lobe of thyroid: 2.6 x 1.2 x 1.6 cm"), not from the procedure-description intro.

ABSOLUTE RULES:
1. NEVER invent findings the radiologist did not record. If the input is silent about an organ or section, copy the standard "normal" boilerplate from the template verbatim.
2. NEVER fabricate measurements. Use values from the input as-is. If a measurement is missing where the template would normally expect one, leave the template's standard line — do not insert "[VERIFY]", "[missing]", or any placeholder.
3. NEVER change patient details. Copy them exactly from the supplied patient header.
4. MATCH THE REFERENCE EXAMPLES WORD-FOR-WORD where they describe the same content. The reference reports below are the gold standard — your output must look like them, not "look professional in general." Specifically:

   (a) Standard normal-findings sentences — VERBATIM. When an organ or area is normal, copy the exact sentence the references use for that finding type. Do not paraphrase. Do not "improve" the grammar. Examples seen across reference reports (use these literal strings when applicable):
       - "Both lobes of thyroid gland appear normal in size, shape and echotexture."
       - "No focal lesions seen within."
       - "No obvious retrosternal extension seen."
       - "Bilateral submandibular and parotid glands appear normal in size, shape and echotexture."
       - "No focal lesions/ solid or cystic foci seen within."
       - "Bilateral carotid arteries and internal jugular veins appear normal."
       - "No obvious e/o cervical adenopathy seen"
       — and analogous standard sentences for whichever scan type the references show. Use the reference wording, not your own.

   (b) Measurement lines — format as: \`Organ name  :  X.X x X.X cm\` — two spaces around the colon, lowercase units (cm / mm), no space between the number and the unit. Use the organ-name spelling from references ("Isthmus measures", not "Isthmus measurement").

   (c) Abnormal-finding phrasing — mirror the references' dense descriptive style. Use \`Ms.\` (with period) inline before measurements within prose, e.g., \`Well defined heteroechoic solid nodule Ms. 2.6 x 1.6cm with peripheral hypoechoic halo, showing peripheral vascularity\`. Lowercase units, no space before unit.

   (d) TIRADS / BIRADS grading — append directly to the finding with a single dash, no spaces around the dash: \`...noted in the right lobe of thyroid-TIRADS-II\`. When a recommendation follows, chain it with the same dash: \`-TIRADS-IV-Suggested FNAC\`.

   (e) Use reference-corpus abbreviations when applicable: \`e/o\` for "evidence of", \`F/U\` for follow-up.

   (f) EXCEPTION — do NOT preserve obvious typos from the references. Standard medical spelling stays standard: write "halo" (not "hallow"), "spongiform" (not "spongi form"). Match style and phrasing, not transcription errors.
5. The IMPRESSION section lists only abnormal findings the radiologist identified, phrased like the reference examples.
6. Preserve the section order and structure of the template exactly.
7. For prenatal scans (NT, TIFFA, Growth, Early pregnancy, Fetal echo), include the PC & PNDT Act compliance statement from the template verbatim in complianceText. Telugu text must be preserved exactly.
8. NEVER insert annotations into the report text. No "[VERIFY: ...]", "[unclear]", "[unreadable]", "[best guess]", "[missing]", or similar bracketed markers. Commit to your best reading. The output goes directly to print — bracketed text looks like an error to the patient.
9. Do not include the doctor's signature block — the DOCX generator handles it.
10. Do not include "Typed by:" — the DOCX generator handles it.
11. PHOTOS of handwritten findings may be attached. Read carefully and produce a clean report from what you see:
    - Read top to bottom, left to right.
    - Pay close attention to: measurements (mm, cm, weeks/days), grading (TIRADS-I to V, BIRADS-1 to 5, Grade-I to III), side markers (RT/LT, R/L, BL, B/L), abbreviations (CRL, NT, NB, BPD, HC, AC, FL, AFI, EFW, LMP, EDD), Indian-shorthand decimals (a comma may mean a decimal point: "2,5" → "2.5"), and easily-confused digits (1/7, 0/6, 3/8, 4/9).
    - Margin notes, asterisks, underlines, and circled words usually mark the abnormal finding — surface those in the IMPRESSION.
    - Commit to your best reading. Do not annotate uncertainty. If a token is genuinely illegible, pick the most clinically plausible interpretation given context.
    - If the photo is entirely unreadable (severe blur, darkness, rotation), still produce a complete report using the template's normal boilerplate — do not leave sections blank, do not insert bracketed warnings.
12. If typed shorthand and a photo are both provided and they conflict: typed shorthand wins for patient identity (name, MR, age, date); the photo wins for findings/measurements. Choose one cleanly — do not annotate the conflict in the text.

The verifyFlags array in the schema is a legacy field. Always return it as an empty array [].

OUTPUT FORMAT:
Return a single JSON object matching the provided schema. No preamble. No markdown fences. No commentary.`;

/** Zod schema for the ReportJSON shape. Drives Claude's structured output
 *  (`zodOutputFormat`) AND is the post-parse validator for Gemini's response. */
export const reportJsonSchema = z.object({
  patientDetails: z.object({
    name: z.string(),
    age: z.string(),
    gender: z.string(),
    mrNumber: z.string(),
    date: z.string(),
    refDoctor: z.string(),
  }),
  scanTitle: z.string(),
  sections: z.array(
    z.object({
      label: z.string(),
      body: z.string(),
    }),
  ),
  impression: z.array(z.string()),
  verifyFlags: z.array(z.string()),
  complianceText: z.string().nullable(),
});

/** Builds the large, stable prefix of the user message: template plain-text +
 *  5 reference reports. Same for both providers — the static block design is
 *  what makes Claude's prompt caching effective; Gemini doesn't have free-tier
 *  caching but the structure is still correct. */
export function buildStaticBlock(c: CaseDoc): string {
  const tplRel = SOURCE_TEMPLATES[c.scanType];
  if (!tplRel) {
    throw new Error(
      `No source template configured for scan type "${c.scanType}".`,
    );
  }
  const tplAbs = resolve(process.cwd(), tplRel);
  if (!existsSync(tplAbs)) {
    throw new Error(`Source template missing on disk: ${tplRel}`);
  }
  const templateText = extractDocxText(tplAbs);

  const refs = getReferenceReports(c.scanType, 10);
  const refExamples =
    refs.length > 0
      ? refs
          .map(
            (r, i) =>
              `=== Example ${i + 1} (${r.filename}) ===\n<<<\n${r.text}\n>>>`,
          )
          .join("\n\n")
      : "[No reference examples available for this scan type yet.]";

  return [
    "TEMPLATE FOR THIS SCAN TYPE:",
    "<<<",
    templateText,
    ">>>",
    "",
    "REFERENCE EXAMPLES (style and phrasing to match):",
    "",
    refExamples,
  ].join("\n");
}

/** Per-request volatile content: patient header + radiologist's shorthand.
 *  When `hasImages` is true, the block tells the model that the photos above
 *  contain handwritten findings to read. */
export function buildVolatileBlock(c: CaseDoc, hasImages = false): string {
  const notes = c.radiologistNotes?.trim()
    ? c.radiologistNotes
    : hasImages
      ? "(no typed shorthand — see attached photo(s) of handwritten notes)"
      : "";
  return [
    "PATIENT DETAILS:",
    `Name: ${c.patientName}`,
    `Age: ${c.age}`,
    `Gender: ${c.gender}`,
    `MR Number: ${c.mrNumber}`,
    `Date of Examination: ${c.dateOfExam}`,
    `Referring Doctor: ${c.refDoctor}`,
    "",
    `SCAN TYPE: ${scanTypeLabel(c.scanType)}`,
    "",
    hasImages
      ? "ATTACHED PHOTOS: one or more photos of the radiologist's handwritten findings precede this text. Read the handwriting per rule 11."
      : null,
    hasImages ? "" : null,
    "RADIOLOGIST'S SHORTHAND NOTES (typed):",
    "<<<",
    notes,
    ">>>",
    "",
    "Generate the formal report as JSON per the system prompt rules.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** A photo attached to the case, ready for vision input on either provider. */
export interface GenerationImage {
  /** Base64-encoded image bytes (no data URL prefix). */
  data: string;
  /** "image/jpeg" | "image/png" | "image/webp" | "image/gif" */
  mimeType: string;
}

/** Token-usage stats returned by both providers, in a uniform shape. Fields
 *  that don't apply to one provider (e.g. cache_creation on free-tier Gemini)
 *  are zeroed rather than omitted, so the route can log a consistent shape. */
export interface GenerationUsage {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
}

/** What both providers return; the dispatcher adds the `provider` field. */
export interface ProviderResult {
  report: import("./types").ReportJSON;
  usage: GenerationUsage;
}
