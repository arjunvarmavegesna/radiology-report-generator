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
The "TEMPLATE FOR THIS SCAN TYPE" shown below is the complete final document layout. When your JSON is rendered to .docx, ONLY these three fields fill placeholders:
  - scanTitle      → the title line (e.g. "ULTRASOUND NECK", "TIFFA SCAN")
  - body[]         → the full per-patient report content as an array of paragraph strings. Each string in body becomes ONE paragraph in the .docx, in order. Include findings AND the IMPRESSION section in body. The first paragraphs are organ-by-organ findings; then a paragraph "IMPRESSION:" as a header line; then one paragraph per impression bullet, each starting with "- ".
  - complianceText → PC&PNDT compliance for OB scans (null otherwise)

Everything else in the template — the standard procedure intro sentence ("High resolution ultrasound of the neck was done using a linear high frequency transducer.", "This study was carried out per ALARA guidelines.", etc.), the signature block, "Dr. K Valli Manasa, MD" / "Consultant radiologist" — is BAKED INTO the template and rendered automatically by the .docx generator.

CRITICAL: do NOT put the standard procedure-description intro line into body[]. Do NOT put the signature line or doctor's name into body[]. Start body[] from the first per-patient FINDING (e.g., "Right lobe of thyroid  :  2.6 x 1.2 x 1.6 cm"), not from the procedure-description intro.

WORKED EXAMPLE (thyroid neck — illustrative, not literal):
  body: [
    "Right lobe of thyroid  :  2.6 x 1.2 x 1.6 cm",
    "Left lobe of thyroid  :  2.6 x 1.2 x 1.6 cm",
    "Isthmus measures  :  2 mm",
    "Both lobes of thyroid gland appear normal in size, shape and echotexture. No obvious retrosternal extension seen.",
    "Well defined heteroechoic solid nodule Ms. 12 x 8mm noted in the left lobe of thyroid with peripheral hypoechoic halo, showing peripheral vascularity-TIRADS-IV-Suggested FNAC.",
    "Bilateral submandibular and parotid glands appear normal in size, shape and echotexture.",
    "Bilateral carotid arteries and internal jugular veins appear normal.",
    "No obvious e/o cervical adenopathy seen",
    "IMPRESSION:",
    "- Heteroechoic solid nodule (12 x 8mm) in the left lobe of thyroid-TIRADS-IV-Suggested FNAC."
  ]

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
5. The IMPRESSION section lists only abnormal findings the radiologist identified, phrased like the reference examples. Include it as paragraphs inside body[] — first an "IMPRESSION:" header line, then one bullet per finding starting with "- ".
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

OUTPUT FORMAT:
Return a single JSON object matching the provided schema. No preamble. No markdown fences. No commentary.`;

/** Zod schema for the ReportJSON shape. Drives Claude's structured output
 *  (`zodOutputFormat`). The legacy `sections` / `impression` / `verifyFlags`
 *  fields from the old schema are removed from the AI's output contract —
 *  body[] now carries the entire per-patient report content including the
 *  IMPRESSION section. Old Firestore documents with the legacy shape are
 *  handled at render time (flattened to body in the export route + review
 *  screen). */
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
  body: z.array(z.string()),
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

/** Per-request volatile content: patient header + radiologist's shorthand,
 *  plus an optional AI-learning block. This is the NON-cached suffix — learning
 *  text goes here (not in the cached static block) so per-case learning never
 *  poisons the prompt cache key. When `hasImages` is true, the block tells the
 *  model that the photos above contain handwritten findings to read. */
export function buildVolatileBlock(
  c: CaseDoc,
  hasImages = false,
  learningContext = "",
): string {
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
    learningContext.trim() ? learningContext.trim() : null,
    learningContext.trim() ? "" : null,
    "Generate the formal report as JSON per the system prompt rules.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

/** Volatile block for an AI Revise pass: the current report + the radiologist's
 *  correction note. The model re-emits the FULL revised report as JSON, keeping
 *  the same format and applying only the requested change. */
export function buildReviseBlock(
  c: CaseDoc,
  currentReportText: string,
  comment: string,
  learningContext = "",
): string {
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
    "CURRENT REPORT (the radiologist is reviewing this draft):",
    "<<<",
    currentReportText,
    ">>>",
    "",
    "RADIOLOGIST'S CORRECTION (apply exactly this change; leave everything else unchanged):",
    "<<<",
    comment,
    ">>>",
    "",
    learningContext.trim() ? learningContext.trim() : null,
    learningContext.trim() ? "" : null,
    "Re-emit the COMPLETE revised report as JSON per the system prompt rules — same scanTitle/body[] structure, same phrasing conventions, only the requested correction applied.",
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

// `flattenReportBody` lives in `lib/report-body.ts` (a client-safe file with
// no fs/path imports). The export route and the review screen both import
// it from there.
export { flattenReportBody } from "./report-body";

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
