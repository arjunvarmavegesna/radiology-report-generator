/**
 * Server-only Anthropic client + the radiology-report generator.
 *
 * Builds the system prompt + structured user message per Section 6 of the
 * project brief, calls Claude Sonnet 4.6 with strict JSON output enforcement
 * (Zod-validated structured outputs), and returns a typed ReportJSON.
 *
 * Prompt caching: the template + reference examples sit in their own content
 * block with a `cache_control` breakpoint, so the (large, stable) static
 * prefix is cached at ~0.1x the per-token cost. The variable suffix (patient
 * details + the radiologist's shorthand) is a second block with no marker,
 * so it doesn't poison the cache key.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { extractDocxText } from "./extract-docx-text";
import { getReferenceReports } from "./reference-corpus";
import { SCAN_TYPES, scanTypeLabel } from "./scan-types";
import type { CaseDoc, ReportJSON } from "./types";

// Same template paths as the export route's TAGGED_TEMPLATES — but for the AI
// we want the ORIGINAL (untagged) template's plain text so the model sees the
// boilerplate + section structure exactly as the clinic writes it.
const SOURCE_TEMPLATES: Record<string, string> = Object.fromEntries(
  SCAN_TYPES.map((s) => {
    // Map scan_type → original template file in Templates/.
    // Keep this small and explicit so it's easy to audit against the brief.
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

// System prompt — verbatim from Section 6 of the build brief.
const SYSTEM_PROMPT = `You are a medical report drafting assistant for an ultrasound/radiology clinic. Your only job is to take a radiologist's shorthand findings and expand them into a formal report using the provided template and reference examples. You are NOT a diagnostic system. You are a writing assistant.

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

OUTPUT FORMAT:
Return a single JSON object matching the provided schema, nothing else. No preamble. No markdown fences. No commentary.`;

const reportJsonSchema = z.object({
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

function buildStaticBlock(c: CaseDoc): string {
  // Resolve template path.
  const tplRel = SOURCE_TEMPLATES[c.scanType];
  if (!tplRel) {
    throw new Error(`No source template configured for scan type "${c.scanType}".`);
  }
  const tplAbs = resolve(process.cwd(), tplRel);
  if (!existsSync(tplAbs)) {
    throw new Error(`Source template missing on disk: ${tplRel}`);
  }
  const templateText = extractDocxText(tplAbs);

  // Reference examples (up to 5, deterministic order — see lib/reference-corpus.ts).
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

function buildVolatileBlock(c: CaseDoc): string {
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
    "RADIOLOGIST'S SHORTHAND NOTES:",
    "<<<",
    c.radiologistNotes,
    ">>>",
    "",
    "Generate the formal report as JSON per the system prompt rules.",
  ].join("\n");
}

export interface GenerationUsage {
  inputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
}

export interface GenerationResult {
  report: ReportJSON;
  usage: GenerationUsage;
}

export async function generateReport(c: CaseDoc): Promise<GenerationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local for local dev, or to apphosting.yaml as a Secret Manager reference for production.",
    );
  }

  const staticBlock = buildStaticBlock(c);
  const volatileBlock = buildVolatileBlock(c);

  const client = new Anthropic({ apiKey });
  const response = await client.messages.parse({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    temperature: 0.2,
    thinking: { type: "disabled" },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          // Static prefix: template + references. Cache breakpoint here lets
          // subsequent requests with the same scan_type read at ~0.1x cost.
          {
            type: "text",
            text: staticBlock,
            cache_control: { type: "ephemeral" },
          },
          // Volatile suffix: patient + radiologist notes. No cache marker.
          { type: "text", text: volatileBlock },
        ],
      },
    ],
    output_config: {
      format: zodOutputFormat(reportJsonSchema),
      effort: "low",
    },
  });

  if (!response.parsed_output) {
    throw new Error(
      `Anthropic returned a non-parseable response (stop_reason=${response.stop_reason}).`,
    );
  }

  return {
    report: response.parsed_output as ReportJSON,
    usage: {
      inputTokens: response.usage.input_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      outputTokens: response.usage.output_tokens,
    },
  };
}
