import { flattenReportBody } from "./report-body";
import { scanTypeLabel, isObstetricScan } from "./scan-types";
import type { CaseDoc, ReportJSON } from "./types";

/**
 * Shared report ↔ plain-text helpers. The typist (Capture screen) and the
 * radiologist (Review screen) both edit a report as a single text blob — one
 * paragraph per line — so these conversions live in one client-safe module
 * (no Node imports) and are reused by both screens.
 */

/** Turn a report's `body[]` (new shape) — or `sections[]`+`impression[]`
 *  (legacy approved cases) — into a single editable text blob, one paragraph
 *  per line. */
export function reportToText(r: ReportJSON): string {
  return flattenReportBody(r).join("\n");
}

/** Reverse of {@link reportToText}. Each line becomes one `body[]` paragraph;
 *  trailing blank lines are dropped so the .docx doesn't end with empty
 *  paragraphs, but interior blank lines are kept for visual spacing. */
export function textToBody(text: string): string[] {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines;
}

/** Patient header derived from the case doc — identical on every report. */
function patientDetailsOf(c: CaseDoc) {
  return {
    name: c.patientName,
    age: c.age,
    gender: c.gender,
    mrNumber: c.mrNumber,
    date: c.dateOfExam,
    refDoctor: c.refDoctor,
  };
}

/** An empty report shell for a case with no draft yet. */
export function emptyReport(c: CaseDoc): ReportJSON {
  return {
    patientDetails: patientDetailsOf(c),
    scanTitle: scanTypeLabel(c.scanType).toUpperCase(),
    body: [],
    complianceText: isObstetricScan(c.scanType) ? "" : null,
  };
}

/** Assemble a {@link ReportJSON} from the editable fields. */
export function buildReport(
  c: CaseDoc,
  scanTitle: string,
  bodyText: string,
  complianceText: string | null,
): ReportJSON {
  return {
    patientDetails: patientDetailsOf(c),
    scanTitle: scanTitle.trim(),
    body: textToBody(bodyText),
    complianceText:
      complianceText && complianceText.trim() ? complianceText : null,
  };
}
