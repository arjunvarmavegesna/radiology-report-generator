import type { ReportJSON } from "./types";

/**
 * Flatten a report into the new `body: string[]` shape regardless of its
 * origin. New AI generations already produce `body`. Legacy approved cases
 * in Firestore have `sections[]` + `impression[]` instead — for those, this
 * helper renders each section as a paragraph ("Label  :  Body" if label is
 * present, otherwise just the body) and appends the IMPRESSION block as
 * paragraphs (header line + dashed bullets).
 *
 * Used by /api/export (server-side .docx render) AND the /review screen
 * (client-side textarea load). Lives in its own file (no Node imports) so
 * client bundles can import it without pulling in lib/ai-shared.ts's
 * server-only fs/path dependencies.
 */
export function flattenReportBody(report: ReportJSON): string[] {
  if (Array.isArray(report.body) && report.body.length > 0) {
    return report.body;
  }
  const out: string[] = [];
  for (const s of report.sections ?? []) {
    const label = (s.label ?? "").trim();
    const body = (s.body ?? "").trim();
    if (!label && !body) continue;
    out.push(label ? `${label}  :  ${body}` : body);
  }
  const imp = (report.impression ?? []).map((i) => i.trim()).filter(Boolean);
  if (imp.length > 0) {
    out.push("IMPRESSION:");
    for (const line of imp) out.push(`- ${line}`);
  }
  return out;
}
