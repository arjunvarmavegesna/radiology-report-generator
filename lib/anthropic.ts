/**
 * Anthropic Claude implementation of the report generator. The system prompt,
 * source-template map, message builders, and ReportJSON Zod schema live in
 * lib/ai-shared.ts — this file is just the Anthropic-specific wiring.
 *
 * Model: claude-opus-4-7 (single-provider — no dispatcher). Adaptive thinking
 * is disabled; structured outputs handle the JSON shape. High-resolution
 * vision is automatic on Opus 4.7 (handles photos up to 2576px long edge).
 *
 * Prompt caching: the template + reference examples sit in their own content
 * block with a `cache_control` breakpoint, so the (large, stable) static
 * prefix is cached at ~0.1x the per-token cost on hits. The volatile suffix
 * (patient details + the radiologist's shorthand + per-case photos) follows
 * with no marker, so per-case content doesn't poison the cache key. Opus 4.7
 * requires ≥4096 tokens of cacheable prefix — the template + 5 reference
 * reports easily exceed this on every scan type.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  buildStaticBlock,
  buildVolatileBlock,
  reportJsonSchema,
  SYSTEM_PROMPT,
  type GenerationImage,
  type ProviderResult,
} from "./ai-shared";
import type { CaseDoc, ReportJSON } from "./types";

type ClaudeImageMedia = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function normalizeMedia(mime: string): ClaudeImageMedia {
  switch (mime) {
    case "image/jpeg":
    case "image/png":
    case "image/gif":
    case "image/webp":
      return mime;
    default:
      // Phones occasionally label JPEGs as "image/jpg". Treat as JPEG.
      return "image/jpeg";
  }
}

export async function generateReport(
  c: CaseDoc,
  images: GenerationImage[] = [],
): Promise<ProviderResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local for local dev, or to apphosting.yaml as a Secret Manager reference for production.",
    );
  }

  const staticBlock = buildStaticBlock(c);
  const volatileBlock = buildVolatileBlock(c, images.length > 0);

  // Image blocks are interleaved BEFORE the volatile text so the model has
  // seen the photos by the time it reads the "ATTACHED PHOTOS: ..." pointer.
  const imageBlocks = images.map((img) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: normalizeMedia(img.mimeType),
      data: img.data,
    },
  }));

  const client = new Anthropic({ apiKey });
  const response = await client.messages.parse({
    // Opus 4.7 — most capable model, high-res vision (matters for the
    // handwritten-notes photos), and stronger structured-output adherence
    // than Sonnet 4.6.
    model: "claude-opus-4-7",
    // 16K (up from 8K) — Opus 4.7 counts tokens differently than Sonnet 4.6;
    // headroom guards against truncation. Reports are well under this in
    // practice; this is the per-response ceiling, not a target.
    max_tokens: 16000,
    // No temperature: sampling parameters (temperature/top_p/top_k) are
    // removed on Opus 4.7 and return a 400. Determinism for medical wording
    // comes from the system prompt + reference examples, not sampling.
    //
    // Adaptive thinking: Claude decides how much to think per request. For
    // photo-of-handwriting cases this lets it transcribe carefully before
    // drafting; for typed-only cases it stays light. `display: "omitted"`
    // is the default — we don't surface reasoning to the user, just the
    // final structured report.
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: staticBlock,
            cache_control: { type: "ephemeral" },
          },
          ...imageBlocks,
          { type: "text", text: volatileBlock },
        ],
      },
    ],
    output_config: {
      format: zodOutputFormat(reportJsonSchema),
      // Effort bumped low → high. Opus 4.7 respects effort levels more
      // strictly than prior models, and the migration guide recommends a
      // minimum of `high` for intelligence-sensitive work. Medical report
      // drafting from photos of handwritten notes qualifies — accuracy
      // matters more than per-case cost.
      effort: "high",
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
