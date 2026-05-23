import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb, adminStorage } from "@/lib/firebase-admin";
import { generateReport, type GenerationImage } from "@/lib/ai";
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
  try {
    await adminAuth().verifyIdToken(idToken);
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
  let result;
  try {
    result = await generateReport(c, images);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json(
      { error: `AI generation failed: ${msg}` },
      { status: 500 },
    );
  }

  // --- Persist draft ---
  // No status mutation here. The client is expected to call /api/export
  // immediately after generate to render the .docx and mark the case approved.
  // For Regenerate, the existing finalReport stays in place until the new
  // export succeeds — if export fails, the user still has the prior approved
  // version intact.
  try {
    await caseRef.update({
      draftReport: result.report,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // Generation succeeded; persistence is best-effort. Return the report so
    // the client can still call /api/export with it.
    console.error("Persist draftReport failed:", err);
  }

  return NextResponse.json({
    report: result.report,
    usage: result.usage,
    provider: result.provider,
  });
}
