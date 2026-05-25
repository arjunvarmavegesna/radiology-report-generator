import { adminDb } from "./firebase-admin";

/**
 * Server-side read of the AI Learning store, formatted for prompt injection.
 * Pulls the most recent corrections + approved examples for a scan type and
 * renders them as a text block that the generate/revise routes append to the
 * VOLATILE message block (never the cached static block, so prompt caching is
 * preserved).
 *
 * Best-effort: any error (e.g. empty collection) returns "" so generation
 * proceeds without learning rather than failing. Filters by a single equality
 * (`scanType`) and sorts in memory, so no composite Firestore index is needed.
 */
interface LearningDoc {
  kind?: string;
  scanType?: string;
  comment?: string;
  correctedText?: string;
  text?: string;
  byRole?: string;
  createdAt?: { toMillis?: () => number } | null;
}

export async function getLearningContext(scanType: string): Promise<string> {
  try {
    const snap = await adminDb()
      .collection("learning")
      .where("scanType", "==", scanType)
      .get();
    const docs = snap.docs.map((d) => d.data() as LearningDoc);
    const ms = (d: LearningDoc) =>
      d.createdAt && typeof d.createdAt.toMillis === "function"
        ? d.createdAt.toMillis()
        : 0;

    const corrections = docs
      .filter((d) => d.kind === "correction")
      .sort((a, b) => ms(b) - ms(a))
      .slice(0, 5);
    const approvals = docs
      .filter((d) => d.kind === "approval")
      .sort((a, b) => ms(b) - ms(a))
      .slice(0, 3);

    if (corrections.length === 0 && approvals.length === 0) return "";

    const parts: string[] = [];
    if (corrections.length > 0) {
      parts.push(
        "LESSONS FROM PAST CORRECTIONS (apply these silently — never mention them in the report):",
      );
      for (const c of corrections) {
        const note = c.comment?.trim();
        if (note) parts.push(`- ${note}`);
      }
      parts.push("");
    }
    if (approvals.length > 0) {
      parts.push(
        "RECENTLY APPROVED REPORTS FOR THIS SCAN TYPE (match this exact style and phrasing):",
      );
      approvals.forEach((a, i) => {
        const text = a.text?.trim();
        if (text) parts.push(`--- Approved example ${i + 1} ---\n${text.slice(0, 800)}`);
      });
      parts.push("");
    }
    return parts.join("\n");
  } catch {
    return "";
  }
}
