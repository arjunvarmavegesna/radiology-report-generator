"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { getCase, saveReviewerDraft } from "@/lib/cases";
import { SCAN_TYPES, scanTypeLabel } from "@/lib/scan-types";
import { STATUS_META, formatTimestamp } from "@/lib/format";
import { openInWord } from "@/lib/office-url";
import { flattenReportBody } from "@/lib/report-body";
import type { CaseDoc, ReportJSON } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function isObstetric(scanType: string): boolean {
  return SCAN_TYPES.find((s) => s.value === scanType)?.isObstetric ?? false;
}

function emptyReport(c: CaseDoc): ReportJSON {
  return {
    patientDetails: {
      name: c.patientName,
      age: c.age,
      gender: c.gender,
      mrNumber: c.mrNumber,
      date: c.dateOfExam,
      refDoctor: c.refDoctor,
    },
    scanTitle: scanTypeLabel(c.scanType).toUpperCase(),
    body: [],
    complianceText: isObstetric(c.scanType) ? "" : null,
  };
}

/** Turn the report's body[] (new shape) — or sections+impression (legacy
 *  approved cases) — into a single editable text blob, one paragraph per
 *  line. The reviewer edits this freely; on save we split back to body[]. */
function reportToText(r: ReportJSON): string {
  const paragraphs = flattenReportBody(r);
  return paragraphs.join("\n");
}

/** Reverse of reportToText. Each non-empty line becomes one paragraph in
 *  body[]; empty lines are kept (so the user can insert blank lines for
 *  visual spacing in the .docx). */
function textToBody(text: string): string[] {
  // Preserve the user's line breaks verbatim. Trim trailing-only blanks
  // so the docx doesn't end with random empty paragraphs.
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }
  return lines;
}

export default function ReviewDetailPage() {
  const params = useParams<{ caseId: string }>();
  const id = params.caseId;
  const router = useRouter();
  const { user } = useAuth();

  const [c, setC] = useState<CaseDoc | null>(null);
  const [scanTitle, setScanTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [complianceText, setComplianceText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "save" | "approve" | "generate">(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getCase(id);
    setC(data);
    if (data) {
      const src =
        data.finalReport ?? data.editedReport ?? data.draftReport ?? emptyReport(data);
      setScanTitle(src.scanTitle ?? "");
      setBodyText(reportToText(src));
      setComplianceText(src.complianceText ?? null);
    } else {
      setScanTitle("");
      setBodyText("");
      setComplianceText(null);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const isApproved = !!c && c.status === "approved";
  const canEdit = !!c && !isApproved;

  function buildReport(): ReportJSON | null {
    if (!c) return null;
    return {
      patientDetails: {
        name: c.patientName,
        age: c.age,
        gender: c.gender,
        mrNumber: c.mrNumber,
        date: c.dateOfExam,
        refDoctor: c.refDoctor,
      },
      scanTitle: scanTitle.trim(),
      body: textToBody(bodyText),
      complianceText:
        complianceText && complianceText.trim() ? complianceText : null,
    };
  }

  async function handleRegenerate() {
    if (!user || !c) return;
    setBusy("generate");
    try {
      const token = await user.getIdToken();
      const resp = await fetch(`/api/generate/${id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await resp.json()) as {
        report?: ReportJSON;
        error?: string;
      };
      if (!resp.ok || !data.report) {
        throw new Error(data.error || `Generation failed (${resp.status})`);
      }
      setScanTitle(data.report.scanTitle ?? "");
      setBodyText(reportToText(data.report));
      setComplianceText(data.report.complianceText ?? null);
      toast.success("Draft refreshed.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "AI generation failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    if (!user) return;
    const report = buildReport();
    if (!report) return;
    setBusy("save");
    try {
      await saveReviewerDraft(id, report, user.uid);
      toast.success("Edits saved.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setBusy(null);
    }
  }

  async function handleApprove() {
    if (!user) return;
    const report = buildReport();
    if (!report) return;
    if (!report.scanTitle) {
      toast.error("Scan title is required.");
      return;
    }
    if (report.body.length === 0) {
      toast.error("Report body is empty.");
      return;
    }

    setBusy("approve");
    try {
      const token = await user.getIdToken();
      const resp = await fetch(`/api/export/${id}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ report }),
      });
      const data = (await resp.json()) as {
        downloadUrl?: string;
        error?: string;
      };
      if (!resp.ok || !data.downloadUrl) {
        throw new Error(data.error || `Export failed (${resp.status})`);
      }
      openInWord(data.downloadUrl);
      toast.success("Approved — opening in Word and adding to Print Queue.");
      router.push("/queue");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to approve & export.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/review">← Back to review list</Link>
      </Button>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !c ? (
        <p className="text-muted-foreground">Case not found.</p>
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
                      ["Captured", formatTimestamp(c.createdAt)],
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

            {c.radiologistNotes && (
              <Card>
                <CardHeader>
                  <CardTitle>Typed Shorthand</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap font-mono text-sm">
                    {c.radiologistNotes}
                  </p>
                </CardContent>
              </Card>
            )}

            {c.notesImagePaths && c.notesImagePaths.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Photos</CardTitle>
                  <CardDescription>
                    {c.notesImagePaths.length} attached — Claude read these
                    when generating the draft.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {c.notesImagePaths.map((p) => (
                      <li key={p}>
                        <code>{p.split("/").pop()}</code>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Report</CardTitle>
                    <CardDescription>
                      {isApproved
                        ? "This case is approved. To re-export, open it from the Print Queue."
                        : "Edit the entire report as plain text — one paragraph per line. Click Approve when ready to render the .docx."}
                    </CardDescription>
                  </div>
                  {canEdit && (
                    <Button
                      onClick={handleRegenerate}
                      disabled={busy !== null}
                      variant="outline"
                      size="sm"
                    >
                      {busy === "generate"
                        ? "Regenerating…"
                        : "Regenerate from photo"}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Label htmlFor="scanTitle">Scan Title</Label>
                  <Input
                    id="scanTitle"
                    value={scanTitle}
                    onChange={(e) => setScanTitle(e.target.value)}
                    disabled={!canEdit}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="bodyText">Report Body</Label>
                  <Textarea
                    id="bodyText"
                    value={bodyText}
                    onChange={(e) => setBodyText(e.target.value)}
                    disabled={!canEdit}
                    rows={24}
                    className="font-mono text-sm leading-relaxed"
                    placeholder="Each line becomes one paragraph in the Word document."
                  />
                  <p className="text-xs text-muted-foreground">
                    One paragraph per line. Include the IMPRESSION section
                    inline (header + dashed bullets) — see the AI draft for
                    the conventional layout.
                  </p>
                </div>

                {isObstetric(c.scanType) && (
                  <div className="space-y-1">
                    <Label htmlFor="complianceText">
                      PC&amp;PNDT Compliance Text
                    </Label>
                    <Textarea
                      id="complianceText"
                      value={complianceText ?? ""}
                      onChange={(e) => setComplianceText(e.target.value)}
                      disabled={!canEdit}
                      rows={6}
                      className="font-mono text-xs leading-relaxed"
                    />
                  </div>
                )}

                {canEdit && (
                  <div className="flex justify-end gap-2 pt-2">
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
                      {busy === "approve"
                        ? "Approving…"
                        : "Approve & send to Print Queue"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
