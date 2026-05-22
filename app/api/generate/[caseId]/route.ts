import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { generateReport } from "@/lib/anthropic";
import type { CaseDoc } from "@/lib/types";

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

  let role: string | undefined =
    typeof decoded.role === "string" ? decoded.role : undefined;
  if (!role) {
    const userSnap = await adminDb()
      .collection("users")
      .doc(decoded.uid)
      .get();
    role = (userSnap.data()?.role as string | undefined) ?? undefined;
  }
  if (role !== "typist" && role !== "radiologist") {
    return NextResponse.json(
      { error: "Typist or radiologist role required" },
      { status: 403 },
    );
  }

  // --- Load case ---
  const caseRef = adminDb().collection("cases").doc(caseId);
  const snap = await caseRef.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  const data = snap.data() as Omit<CaseDoc, "id">;
  const c: CaseDoc = { id: snap.id, ...data };

  // --- Generate ---
  let result;
  try {
    result = await generateReport(c);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed";
    return NextResponse.json(
      { error: `AI generation failed: ${msg}` },
      { status: 500 },
    );
  }

  // --- Persist draft + claim as typist if applicable ---
  try {
    const updates: Record<string, unknown> = {
      draftReport: result.report,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (role === "typist" && !c.typistId) {
      updates.typistId = decoded.uid;
    }
    await caseRef.update(updates);
  } catch (err) {
    // Generation succeeded; persistence is best-effort. Return the report so
    // the client can still work with it; the typist's Save will retry the write.
    console.error("Persist draftReport failed:", err);
  }

  return NextResponse.json({
    report: result.report,
    usage: result.usage,
  });
}
