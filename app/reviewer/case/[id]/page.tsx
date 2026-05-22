"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { approveCase, getCase, saveReviewerDraft } from "@/lib/cases";
import { SCAN_TYPES, scanTypeLabel } from "@/lib/scan-types";
import { STATUS_META, formatTimestamp } from "@/lib/format";
import type { CaseDoc, ReportJSON } from "@/lib/types";
import { ReportEditor } from "@/components/report-editor";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function isObstetric(scanType: string): boolean {
  return SCAN_TYPES.find((s) => s.value === scanType)?.isObstetric ?? false;
}

function cleanReport(r: ReportJSON): ReportJSON {
  return {
    ...r,
    sections: r.sections.filter((s) => s.label.trim() || s.body.trim()),
    impression: r.impression.map((s) => s.trim()).filter(Boolean),
    complianceText:
      r.complianceText && r.complianceText.trim() ? r.complianceText : null,
  };
}

export default function ReviewerCasePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { user } = useAuth();

  const [c, setC] = useState<CaseDoc | null>(null);
  const [report, setReport] = useState<ReportJSON | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "save" | "approve">(null);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getCase(id);
    setC(data);
    setReport(
      data
        ? data.finalReport ?? data.editedReport ?? data.draftReport ?? null
        : null,
    );
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const canEdit = !!c && c.status === "pending_review";

  async function handleSave() {
    if (!user || !report) return;
    setBusy("save");
    try {
      await saveReviewerDraft(id, cleanReport(report), user.uid);
      toast.success("Edits saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setBusy(null);
    }
  }

  async function handleApprove() {
    if (!user || !report) return;
    const cleaned = cleanReport(report);
    if (!cleaned.scanTitle.trim()) {
      toast.error("Scan title is required.");
      return;
    }
    if (cleaned.sections.length === 0) {
      toast.error("Add at least one section.");
      return;
    }
    if (cleaned.impression.length === 0) {
      toast.error("Add at least one impression line.");
      return;
    }
    setBusy("approve");
    try {
      await approveCase(id, cleaned, user.uid);
      toast.success("Approved. (DOCX export is the next milestone.)");
      router.push("/reviewer/queue");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/reviewer/queue">← Back to review queue</Link>
      </Button>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !c ? (
        <p className="text-muted-foreground">Case not found.</p>
      ) : !report ? (
        <p className="text-muted-foreground">
          No report on this case yet — the typist hasn&apos;t drafted it.
        </p>
      ) : (
        <div className="grid md:grid-cols-3 gap-6">
          <div className="md:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Patient</CardTitle>
                  <Badge className={STATUS_META[c.status].className}>
                    {STATUS_META[c.status].label}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  {(
                    [
                      ["Name", c.patientName],
                      ["Age", c.age],
                      ["Gender", c.gender],
                      ["MR No.", c.mrNumber],
                      ["Date of Exam", c.dateOfExam],
                      ["Ref. Doctor", c.refDoctor || "—"],
                      ["Scan Type", scanTypeLabel(c.scanType)],
                      ["Submitted", formatTimestamp(c.typistSubmittedAt)],
                    ] as [string, string][]
                  ).map(([label, value]) => (
                    <div key={label} className="flex flex-col">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Radiologist&apos;s Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap font-mono text-sm">
                  {c.radiologistNotes}
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="md:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Final Review</CardTitle>
                <CardDescription>
                  Edit if needed, then approve. DOCX export is wired up next.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <ReportEditor
                  report={report}
                  onChange={setReport}
                  disabled={!canEdit}
                  showCompliance={isObstetric(c.scanType)}
                />
                {canEdit ? (
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={handleSave}
                      disabled={busy !== null}
                    >
                      {busy === "save" ? "Saving…" : "Save edits"}
                    </Button>
                    <Button
                      onClick={handleApprove}
                      disabled={busy !== null}
                    >
                      {busy === "approve" ? "Approving…" : "Approve & close"}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Case is {STATUS_META[c.status].label.toLowerCase()};
                    editing is disabled.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
