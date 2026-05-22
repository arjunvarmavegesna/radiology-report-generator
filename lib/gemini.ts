/**
 * Google Gemini implementation of the report generator. Same input/output
 * contract as lib/anthropic.ts so the dispatcher (lib/ai.ts) can swap them.
 *
 * Differences from the Anthropic path:
 *   - Strict JSON output via `responseSchema` (Gemini's equivalent of Claude's
 *     structured outputs). We post-validate with the shared Zod schema for
 *     defense in depth.
 *   - No prompt caching on the free tier (it's a paid-tier feature). The
 *     static/volatile two-block message structure is preserved anyway —
 *     harmless on Gemini, and stays in lock-step with the Anthropic path.
 *   - System prompt goes in `config.systemInstruction`, not as a `system`
 *     parameter on the message.
 */
import { GoogleGenAI, Type } from "@google/genai";
import {
  buildStaticBlock,
  buildVolatileBlock,
  reportJsonSchema,
  SYSTEM_PROMPT,
  type ProviderResult,
} from "./ai-shared";
import type { CaseDoc, ReportJSON } from "./types";

/** Gemini's responseSchema. Mirrors the Zod schema in lib/ai-shared.ts.
 *  Kept manually in sync — duplication is small and the explicit shape is
 *  easier to debug if Gemini rejects something. */
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    patientDetails: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING },
        age: { type: Type.STRING },
        gender: { type: Type.STRING },
        mrNumber: { type: Type.STRING },
        date: { type: Type.STRING },
        refDoctor: { type: Type.STRING },
      },
      required: ["name", "age", "gender", "mrNumber", "date", "refDoctor"],
      propertyOrdering: [
        "name",
        "age",
        "gender",
        "mrNumber",
        "date",
        "refDoctor",
      ],
    },
    scanTitle: { type: Type.STRING },
    sections: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          body: { type: Type.STRING },
        },
        required: ["label", "body"],
        propertyOrdering: ["label", "body"],
      },
    },
    impression: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    verifyFlags: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    complianceText: {
      type: Type.STRING,
      nullable: true,
    },
  },
  required: [
    "patientDetails",
    "scanTitle",
    "sections",
    "impression",
    "verifyFlags",
    "complianceText",
  ],
  propertyOrdering: [
    "patientDetails",
    "scanTitle",
    "sections",
    "impression",
    "verifyFlags",
    "complianceText",
  ],
};

export async function generateReport(c: CaseDoc): Promise<ProviderResult> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local for local dev, or to apphosting.yaml as a Secret Manager reference for production.",
    );
  }

  // Default to gemini-2.5-flash: generous free tier (10 RPM, 250 RPD on most
  // accounts) and strong enough for the brief's structured-writing task.
  // gemini-2.5-pro is also supported but requires billing enabled on the GCP
  // project — without it Pro returns a 429 with limit: 0. Override via the
  // GEMINI_MODEL env var if you've enabled billing and want Pro.
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

  const staticBlock = buildStaticBlock(c);
  const volatileBlock = buildVolatileBlock(c);

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [{ text: staticBlock }, { text: volatileBlock }],
      },
    ],
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned no text in response.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const head = text.slice(0, 200);
    throw new Error(
      `Gemini returned non-JSON output (first 200 chars: ${head})`,
    );
  }

  // Defense in depth: validate via Zod even though responseSchema should have
  // enforced the shape. Catches the rare case where Gemini drops a required
  // field under tight token budgets, before the bad shape reaches the typist.
  const validated = reportJsonSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error(
      `Gemini output failed schema validation: ${validated.error.message}`,
    );
  }

  const usage = response.usageMetadata;
  return {
    report: validated.data as ReportJSON,
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      // Gemini's "cachedContentTokenCount" is populated only when explicit
      // context caching is enabled (paid-tier feature). On free tier it's 0.
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: usage?.cachedContentTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
    },
  };
}
