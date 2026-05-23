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

/** System prompt — verbatim from Section 6 of the build brief, plus a vision
 *  addendum (rule 11) for the photo-of-handwritten-notes input mode. */
export const SYSTEM_PROMPT = `You are a medical report drafting assistant for an ultrasound/radiology clinic. Your only job is to take a radiologist's shorthand findings and expand them into a formal report using the provided template and reference examples. You are NOT a diagnostic system. You are a writing assistant.

ABSOLUTE RULES:
1. NEVER invent findings the radiologist did not write. If the radiologist wrote nothing about an organ or section, copy the standard "normal" boilerplate from the template verbatim.
2. NEVER invent or modify measurements. If a measurement seems missing where one is expected, add "[VERIFY: measurement needed for <X>]" inline and list it in verifyFlags.
3. NEVER change patient details. Copy them exactly as provided in the user message.
4. ALWAYS match the writing style of the reference examples — same sentence structure, same terminology (TIRADS, BIRADS, grading like Grade-I fatty liver, "Ms." for measurement notation), same phrasing patterns for impressions.
5. The IMPRESSION section lists only abnormal findings the radiologist mentioned, phrased as in reference examples.
6. Preserve the section order and structure of the template exactly.
7. For prenatal scans (NT, TIFFA, Growth, Early pregnancy, Fetal echo), include the PC & PNDT Act compliance statement from the template verbatim in complianceText. The Telugu text must be preserved exactly.
8. If anything in the radiologist's notes is ambiguous, unclear, contradicts the template, or could be interpreted multiple ways, add a [VERIFY: ...] inline marker AND add it to verifyFlags. When in doubt, flag it. The typist will resolve flags before the report moves forward.
9. Do not include the doctor's signature block in your output — that's handled by the DOCX generator.
10. Do not include "Typed by:" — that's handled by the DOCX generator.
11. PHOTOS of handwritten radiologist notes may be attached. Treat them as additional input alongside any typed shorthand. Read the handwriting carefully and extract findings, measurements, and impressions exactly as written. If handwriting is illegible, partially visible, or ambiguous, add a [VERIFY: handwriting unclear — <what you think it says>] marker AND list it in verifyFlags rather than guessing. If both typed shorthand and photos are provided and they conflict, flag the conflict in verifyFlags rather than silently picking one.

OUTPUT FORMAT:
Return a single JSON object matching the provided schema, nothing else. No preamble. No markdown fences. No commentary.`;

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

  const refs = getReferenceReports(c.scanType, 5);
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
