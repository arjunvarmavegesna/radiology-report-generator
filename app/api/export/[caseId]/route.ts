import { NextRequest, NextResponse } from "next/server";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase-admin";
import { SCAN_TYPES } from "@/lib/scan-types";
import type { ReportJSON } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Scan type → path (relative to project root) of the tagged docx template.
 * Derived from SCAN_TYPES so adding a new scan type only requires adding the
 * value there + dropping the tagged file at the expected path.
 */
const TAGGED_TEMPLATES: Record<string, string> = Object.fromEntries(
  SCAN_TYPES.map((s) => [s.value, `data/templates-tagged/${s.value}.tagged.docx`]),
);

function sanitize(s: string): string {
  return (s || "report").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

/**
 * POST /api/export/[caseId]
 *
 * Body: { report: ReportJSON }
 * Headers: Authorization: Bearer <Firebase ID token>
 *
 * Verifies the caller is a reviewer, fills the tagged DOCX template with the
 * supplied finalReport, uploads the result to Firebase Storage, marks the
 * case approved, and returns a signed download URL.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { caseId: string } },
) {
  const { caseId } = params;

  // --- Authenticate the caller ---
  const authHeader = req.headers.get("authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  if (!idToken) {
    return NextResponse.json(
      { error: "Missing bearer token" },
      { status: 401 },
    );
  }

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(idToken);
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Reviewer claim required (fall back to users/{uid}.role if the claim is
  // missing, matching the client-side auth context).
  let role: string | undefined =
    typeof decoded.role === "string" ? decoded.role : undefined;
  if (!role) {
    const userSnap = await adminDb()
      .collection("users")
      .doc(decoded.uid)
      .get();
    role = (userSnap.data()?.role as string | undefined) ?? undefined;
  }
  if (role !== "reviewer") {
    return NextResponse.json(
      { error: "Reviewer role required" },
      { status: 403 },
    );
  }

  // --- Parse the body ---
  let body: { report?: ReportJSON };
  try {
    body = (await req.json()) as { report?: ReportJSON };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const report = body.report;
  if (!report || !report.patientDetails) {
    return NextResponse.json(
      { error: "Missing report.patientDetails in body" },
      { status: 400 },
    );
  }

  // --- Load the case (for scanType) ---
  const caseRef = adminDb().collection("cases").doc(caseId);
  const caseSnap = await caseRef.get();
  if (!caseSnap.exists) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  const scanType = (caseSnap.data()?.scanType as string | undefined) ?? "";

  // --- Resolve the tagged template ---
  const relPath = TAGGED_TEMPLATES[scanType];
  if (!relPath) {
    return NextResponse.json(
      {
        error: `No tagged template configured for scan type "${scanType}". Phase 1 ships only thyroid_neck.`,
      },
      { status: 400 },
    );
  }
  const tplPath = resolve(process.cwd(), relPath);
  if (!existsSync(tplPath)) {
    return NextResponse.json(
      { error: `Tagged template missing on server: ${relPath}` },
      { status: 500 },
    );
  }

  // --- Render the DOCX ---
  let outBuf: Buffer;
  try {
    const zip = new PizZip(readFileSync(tplPath));
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });
    doc.render({
      patientName: report.patientDetails.name ?? "",
      age: report.patientDetails.age ?? "",
      gender: report.patientDetails.gender ?? "",
      mrNumber: report.patientDetails.mrNumber ?? "",
      date: report.patientDetails.date ?? "",
      refDoctor: report.patientDetails.refDoctor ?? "",
      scanTitle: report.scanTitle ?? "",
      sections: (report.sections ?? []).map((s) => ({
        label: s.label,
        body: s.body,
      })),
      impression: report.impression ?? [],
      complianceText: report.complianceText ?? null,
    });
    outBuf = doc.getZip().generate({ type: "nodebuffer" }) as Buffer;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "render failed";
    return NextResponse.json(
      { error: `DOCX render failed: ${msg}` },
      { status: 500 },
    );
  }

  // --- Upload to Firebase Storage ---
  const safe = sanitize(report.patientDetails.name);
  const filename = `${safe}_${scanType}.docx`;
  const storagePath = `final/${caseId}/${filename}`;
  const file = adminStorage().bucket().file(storagePath);
  try {
    await file.save(outBuf, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      resumable: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "upload failed";
    return NextResponse.json(
      { error: `Storage upload failed: ${msg}` },
      { status: 500 },
    );
  }

  // Signed read URL, valid 7 days. responseDisposition forces a download with a
  // sensible filename, regardless of how the client navigates to it — so popup
  // blockers can't silently swallow the open.
  const [downloadUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    responseDisposition: `attachment; filename="${filename}"`,
  });

  // --- Mark case approved + persist final report ---
  await caseRef.update({
    finalReport: report,
    finalDocxPath: storagePath,
    status: "approved",
    reviewerId: decoded.uid,
    reviewerApprovedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ downloadUrl, storagePath });
}
