import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { reviseReport } from "@/lib/ai";
import { getLearningContext } from "@/lib/learning-server";
import { flattenReportBody } from "@/lib/report-body";
import type { CaseDoc, ReportJSON } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/revise/[caseId]
 *
 * Body: { report: ReportJSON, comment: string }
 * Headers: Authorization: Bearer <Firebase ID token>
 *
 * The radiologist supplies the current report + a correction note; Claude
 * re-drafts the full report applying the change. The route persists the
 * revised report + appends the comment to the case thread + records a
 * correction for AI learning (both best-effort), then returns the revision.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { caseId: string } },
) {
  const { caseId } = params;

  // --- Auth ---
  const authHeader = req.headers.get("authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // --- Body ---
  let body: { report?: ReportJSON; comment?: string };
  try {
    body = (await req.json()) as { report?: ReportJSON; comment?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const report = body.report;
  const comment = (body.comment ?? "").trim();
  if (!report || !report.patientDetails) {
    return NextResponse.json(
      { error: "Missing report.patientDetails in body" },
      { status: 400 },
    );
  }
  if (!comment) {
    return NextResponse.json({ error: "Missing comment" }, { status: 400 });
  }

  // --- Load case ---
  const caseRef = adminDb().collection("cases").doc(caseId);
  const snap = await caseRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  const c: CaseDoc = { id: snap.id, ...(snap.data() as Omit<CaseDoc, "id">) };

  // --- Revise ---
  const currentText = flattenReportBody(report).join("\n");
  const learningContext = await getLearningContext(c.scanType);
  let result;
  try {
    result = await reviseReport(c, currentText, comment, learningContext);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Revision failed";
    return NextResponse.json(
      { error: `AI revision failed: ${msg}` },
      { status: 500 },
    );
  }
  const revisedText = flattenReportBody(result.report).join("\n");

  // --- Persist revised report + append the comment (best-effort) ---
  try {
    await caseRef.update({
      finalReport: result.report,
      // Timestamp.now() (not serverTimestamp) — sentinels aren't allowed
      // inside arrayUnion elements.
      comments: FieldValue.arrayUnion({
        text: comment,
        byRole: "radiologist",
        byUid: decoded.uid,
        at: Timestamp.now(),
      }),
      reviewerId: decoded.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn("Persist revised report failed:", err);
  }

  // --- Record the correction for AI learning (best-effort) ---
  try {
    await adminDb().collection("learning").add({
      kind: "correction",
      scanType: c.scanType,
      aiText: currentText.slice(0, 4000),
      correctedText: revisedText.slice(0, 4000),
      comment,
      byRole: "radiologist",
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn("Record correction for learning failed:", err);
  }

  return NextResponse.json({
    report: result.report,
    usage: result.usage,
    provider: result.provider,
  });
}
