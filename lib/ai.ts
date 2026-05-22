/**
 * AI provider dispatcher. Picks Claude or Gemini at request time based on the
 * AI_PROVIDER env var, falling back to whichever key is configured. The two
 * implementations (lib/anthropic.ts, lib/gemini.ts) honor the same
 * ProviderResult contract, so the route is provider-agnostic.
 *
 * Selection rules (highest priority first):
 *   1. AI_PROVIDER=claude  → use Claude (errors if ANTHROPIC_API_KEY missing).
 *   2. AI_PROVIDER=gemini  → use Gemini (errors if GEMINI_API_KEY missing).
 *   3. AI_PROVIDER unset:
 *      a. ANTHROPIC_API_KEY is set → Claude.
 *      b. GEMINI_API_KEY (or GOOGLE_API_KEY) is set → Gemini.
 *      c. Neither is set → falls through to Claude, whose error message is the
 *         most directly actionable ("ANTHROPIC_API_KEY is not set...").
 */
import { generateReport as generateWithClaude } from "./anthropic";
import { generateReport as generateWithGemini } from "./gemini";
import type { GenerationUsage } from "./ai-shared";
import type { CaseDoc, ReportJSON } from "./types";

export type AIProvider = "claude" | "gemini";

export interface GenerationResult {
  report: ReportJSON;
  usage: GenerationUsage;
  provider: AIProvider;
}

/** Resolves which provider this request will use. Exported so the route can
 *  echo it in the response (useful for the UI to label drafts by provider). */
export function pickProvider(): AIProvider {
  const explicit = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (explicit === "gemini" || explicit === "google") return "gemini";
  if (explicit === "claude" || explicit === "anthropic") return "claude";

  if (process.env.ANTHROPIC_API_KEY) return "claude";
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return "gemini";
  return "claude"; // surface Claude's "key not set" error — clearest signal.
}

export async function generateReport(c: CaseDoc): Promise<GenerationResult> {
  const provider = pickProvider();
  const result =
    provider === "gemini"
      ? await generateWithGemini(c)
      : await generateWithClaude(c);
  return { ...result, provider };
}
