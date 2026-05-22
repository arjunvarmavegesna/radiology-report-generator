"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { getCase, saveTypistDraft, submitToReviewer } from "@/lib/cases";
import { SCAN_TYPES, scanTypeLabel } from "@/lib/scan-types";
import { STATUS_META } from "@/lib/format";
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
import { Label } from "@/components/ui/label";

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
    sections: [{ label: "", body: "" }],
    impression: [""],
    verifyFlags: [],
    complianceText: isObstetric(c.scanType) ? "" : null,
  };
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

export default function TypistCasePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { user } = useAuth();

  const [c, setC] = useState<CaseDoc | null>(null);
  const [report, setReport] = useState<ReportJSON | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<null | "save" | "submit" | "generate">(
    null,
  );
  const [resolvedFlags, setResolvedFlags] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    const data = await getCase(id);
    setC(data);
    if (data) {
      setReport(
        data.editedReport ?? data.draftReport ?? emptyReport(data),
      );
    } else {
      setReport(null);
    }
    // Always reset resolved-flags on (re)load — the typist must re-confirm.
    setResolvedFlags(new Set());
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const locked = !c || c.status !== "pending_typing";
  const hasAIDraft = !!c?.draftReport;
  const verifyFlags = report?.verifyFlags ?? [];
  const allFlagsResolved =
    verifyFlags.length === 0 || resolvedFlags.size === verifyFlags.length;

  async function handleGenerate() {
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
        throw new Error(
          data.error || `Generation failed (${resp.status})`,
        );
      }
      setReport(data.report);
      setResolvedFlags(new Set());
      const flagCount = data.report.verifyFlags.length;
      toast.success(
        flagCount > 0
          ? `Draft ready. Resolve ${flagCount} verify flag${flagCount === 1 ? "" : "s"} before submitting.`
          : "Draft ready.",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "AI generation failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    if (!user || !report) return;
    setBusy("save");
    try {
      await saveTypistDraft(id, cleanReport(report), user.uid);
      toast.success("Draft saved.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save draft.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleSubmit() {
    if (!user || !report) return;
    if (!allFlagsResolved) {
      toast.error("Resolve all verify flags before submitting.");
      return;
    }
    const cleaned = cleanReport(report);
    if (!cleaned.scanTitle.trim()) {
      toast.error("Scan title is required.");
      return;
    }
    if (cleaned.sections.length === 0) {
      toast.error("Add at least one section with findings.");
      return;
    }
    if (cleaned.impression.length === 0) {
      toast.error("Add at least one impression line.");
      return;
    }
    setBusy("submit");
    try {
      await submitToReviewer(id, cleaned, user.uid);
      toast.success("Submitted to reviewer.");
      router.push("/typist/queue");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to submit.",
      );
    } finally {
      setBusy(null);
    }
  }

  function toggleFlag(idx: number, checked: boolean) {
    setResolvedFlags((prev) => {
      const next = new Set(prev);
      if (checked) next.add(idx);
      else next.delete(idx);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/typist/queue">← Back to queue</Link>
      </Button>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !c || !report ? (
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

          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Report</CardTitle>
                    <CardDescription>
                      {hasAIDraft
                        ? "AI-drafted from the radiologist's notes; review, edit, and resolve any verify flags."
                        : "Click Generate to draft from the radiologist's notes with Claude, or write it manually."}
                    </CardDescription>
                  </div>
                  {!locked && (
                    <Button
                      onClick={handleGenerate}
                      disabled={busy !== null}
                      variant={hasAIDraft ? "outline" : "default"}
                      size="sm"
                    >
                      {busy === "generate"
                        ? hasAIDraft
                          ? "Regenerating…"
                          : "Generating…"
                        : hasAIDraft
                          ? "Regenerate"
                          : "Generate report"}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {verifyFlags.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                    <p className="mb-2 text-sm font-medium text-amber-900">
                      Verify ({resolvedFlags.size}/{verifyFlags.length}) —
                      resolve all before submitting.
                    </p>
                    <ul className="space-y-1.5">
                      {verifyFlags.map((flag, idx) => (
                        <li
                          key={idx}
                          className="flex items-start gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            id={`vf-${idx}`}
                            checked={resolvedFlags.has(idx)}
                            onChange={(e) => toggleFlag(idx, e.target.checked)}
                            disabled={locked}
                            className="mt-1"
                          />
                          <Label
                            htmlFor={`vf-${idx}`}
                            className={
                              resolvedFlags.has(idx)
                                ? "text-amber-700 line-through"
                                : "text-amber-900"
                            }
                          >
                            {flag}
                          </Label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <ReportEditor
                  report={report}
                  onChange={setReport}
                  disabled={locked}
                  showCompliance={isObstetric(c.scanType)}
                />

                {!locked ? (
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={handleSave}
                      disabled={busy !== null}
                    >
                      {busy === "save" ? "Saving…" : "Save draft"}
                    </Button>
                    <Button
                      onClick={handleSubmit}
                      disabled={busy !== null || !allFlagsResolved}
                      title={
                        !allFlagsResolved
                          ? "Resolve all verify flags first"
                          : undefined
                      }
                    >
                      {busy === "submit"
                        ? "Submitting…"
                        : "Submit to reviewer"}
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    This case is no longer pending typing — it&apos;s{" "}
                    {STATUS_META[c.status].label.toLowerCase()}. Editing is
                    disabled.
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
