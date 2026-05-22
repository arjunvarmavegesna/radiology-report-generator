/**
 * Anthropic Claude implementation of the report generator. The system prompt,
 * source-template map, message builders, and ReportJSON Zod schema live in
 * lib/ai-shared.ts — this file is just the Anthropic-specific wiring.
 *
 * Prompt caching: the template + reference examples sit in their own content
 * block with a `cache_control` breakpoint, so the (large, stable) static
 * prefix is cached at ~0.1x the per-token cost on hits. The volatile suffix
 * (patient details + the radiologist's shorthand) is a second block with no
 * marker, so it doesn't poison the cache key.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  buildStaticBlock,
  buildVolatileBlock,
  reportJsonSchema,
  SYSTEM_PROMPT,
  type ProviderResult,
} from "./ai-shared";
import type { CaseDoc, ReportJSON } from "./types";

export async function generateReport(c: CaseDoc): Promise<ProviderResult> {
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
          {
            type: "text",
            text: staticBlock,
            cache_control: { type: "ephemeral" },
          },
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
