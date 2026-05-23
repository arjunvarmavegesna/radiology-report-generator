/**
 * AI report-generation entry point. Single-provider (Claude Opus 4.7) —
 * no dispatcher. The implementation in lib/anthropic.ts honors the
 * GenerationResult contract below; the route is provider-agnostic.
 *
 * Historical note: this module used to dispatch between Claude and Gemini
 * based on env vars. Gemini was removed when the clinic standardized on
 * Opus 4.7 for accuracy on handwritten notes + vision input.
 */
import { generateReport as generateWithClaude } from "./anthropic";
import type { GenerationImage, GenerationUsage } from "./ai-shared";
import type { CaseDoc, ReportJSON } from "./types";

export type { GenerationImage } from "./ai-shared";

export interface GenerationResult {
  report: ReportJSON;
  usage: GenerationUsage;
  /** Always "claude" — kept for response/log stability across the codebase. */
  provider: "claude";
}

export async function generateReport(
  c: CaseDoc,
  images: GenerationImage[] = [],
): Promise<GenerationResult> {
  const result = await generateWithClaude(c, images);
  return { ...result, provider: "claude" };
}
