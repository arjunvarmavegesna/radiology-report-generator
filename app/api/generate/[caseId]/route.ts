import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase-admin";
import { generateReport, type GenerationImage } from "@/lib/ai";
import { getLearningContext } from "@/lib/learning-server";
import type { CaseDoc } from "@/lib/types";

/** Pull every image at case.notesImagePaths from Storage and base64-encode it
 *  for the vision-capable AI provider. Each path is "<caseId>/<filename>"
 *  under the default bucket. Missing/unreadable images are skipped (logged),
 *  so a partial set of photos still produces a report rather than failing. */
async function loadCaseImages(
  paths: string[] | undefined,
): Promise<GenerationImage[]> {
  if (!paths || paths.length === 0) return [];
  const bucket = adminStorage().bucket();
  const out: GenerationImage[] = [];
  for (const path of paths) {
    try {
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) {
        console.warn(`Skipping missing notes image: ${path}`);
        continue;
      }
      const [buf] = await file.download();
      const [meta] = await file.getMetadata();
      const mime =
        typeof meta.contentType === "string" && meta.contentType.length > 0
          ? meta.contentType
          : "image/jpeg";
      out.push({ data: buf.toString("base64"), mimeType: mime });
    } catch (err) {
      console.warn(`Failed to load notes image ${path}:`, err);
    }
  }
  return out;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/generate/[caseId]
 *
 * Headers: Authorization: Bearer <Firebase ID token> (typist or radiologist).
 *
 * Pulls the case, calls Claude with the template + reference examples + the
 * radiologist's shorthand notes, persists the result as `case.draftReport`,
 * and returns the structured report to the client.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { caseId: string } },
) {
  const { caseId } = params;

  // --- Auth ---
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

  // Single-role app — any signed-in user may generate. Role-based gating
  // was removed when the three-role workflow collapsed into one.

  // --- Load case ---
  const caseRef = adminDb().collection("cases").doc(caseId);
  const snap = await caseRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  const data = snap.data() as Omit<CaseDoc, "id">;
  const c: CaseDoc = { id: snap.id, ...data };

  // --- Generate ---
  const images = await loadCaseImages(c.notesImagePaths);
  const learningContext = await getLearningContext(c.scanType);
  let result;
  try {
    result = await generateReport(c, images, learningContext);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json(
      { error: `AI generation failed: ${msg}` },
      { status: 500 },
    );
  }

  // --- Persist draft ---
  // The flow is: Capture → AI generates the draft → the typist edits it on the
  // Capture screen and explicitly Submits (submitToReviewer → pending_review) →
  // /review shows it for the radiologist → Approve renders the .docx via
  // /api/export and marks the case approved.
  //   - pending_typing (new case / regenerate on Capture) → STAY pending_typing,
  //     just store the draft; the case is not surfaced in the review queue
  //     until the typist submits.
  //   - approved (regenerate from queue) → reset to pending_review, clear
  //     finalReport + finalDocxPath so the user re-approves a fresh draft
  //   - pending_review (regenerate from review) → keep status, just refresh draft
  try {
    const updates: Record<string, unknown> = {
      draftReport: result.report,
      editedReport: null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (c.status === "pending_typing") {
      // Record who drafted it, but do NOT advance the status — Submit does that.
      updates.typistId = decoded.uid;
    } else if (c.status === "approved") {
      updates.status = "pending_review";
      updates.finalReport = null;
      updates.finalDocxPath = null;
      updates.reviewerId = null;
      updates.reviewerApprovedAt = null;
      updates.typistSubmittedAt = FieldValue.serverTimestamp();
    }
    await caseRef.update(updates);
  } catch (err) {
    // Generation succeeded; persistence is best-effort. Return the report so
    // the client can still work with it.
    console.error("Persist draftReport failed:", err);
  }

  return NextResponse.json({
    report: result.report,
    usage: result.usage,
    provider: result.provider,
  });
}
