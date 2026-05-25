"use client";

import { useCallback, useEffect, useState } from "react";
import { Timestamp } from "firebase/firestore";
import { toast } from "sonner";
import { FileText, ChevronLeft } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  getReviewQueue,
  getCase,
  saveReviewerDraft,
  sendBackToTypist,
} from "@/lib/cases";
import { scanTypeLabel, isObstetricScan } from "@/lib/scan-types";
import { formatTimestamp, STATUS_META } from "@/lib/format";
import { openInWord } from "@/lib/office-url";
import { reportToText, buildReport, emptyReport } from "@/lib/report-text";
import type { CaseDoc, ReportJSON } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DictateButton } from "@/components/dictate-button";
import { cn } from "@/lib/utils";

/** Two-pane radiologist review: pending queue on the left, an editable report
 *  + approve actions on the right. Used by both /review (nothing selected) and
 *  /review/[caseId] (deep-linked, pre-selected). Reuses the existing
 *  Firestore + export contracts unchanged. */
export function ReviewWorkspace({ initialCaseId }: { initialCaseId?: string }) {
  const { user } = useAuth();

  const [queue, setQueue] = useState<CaseDoc[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(
    initialCaseId ?? null,
  );
  const [c, setC] = useState<CaseDoc | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [scanTitle, setScanTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [complianceText, setComplianceText] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState<
    null | "save" | "approve" | "generate" | "revise" | "sendback"
  >(null);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      setQueue(await getReviewQueue());
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load review queue.",
      );
    } finally {
      setQueueLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Load the selected case's detail and seed the editable fields.
  useEffect(() => {
    if (!selectedId) {
      setC(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    (async () => {
      try {
        const data = await getCase(selectedId);
        if (!active) return;
        setC(data);
        setComment("");
        if (data) {
          const src =
            data.finalReport ??
            data.editedReport ??
            data.draftReport ??
            emptyReport(data);
          setScanTitle(src.scanTitle ?? "");
          setBodyText(reportToText(src));
          setComplianceText(src.complianceText ?? null);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to load case.",
        );
      } finally {
        if (active) setDetailLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedId]);

  function makeReport(): ReportJSON | null {
    if (!c) return null;
    return buildReport(c, scanTitle, bodyText, complianceText);
  }

  async function handleRegenerate() {
    if (!user || !c?.id) return;
    setBusy("generate");
    try {
      const token = await user.getIdToken();
      const resp = await fetch(`/api/generate/${c.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await resp.json().catch(() => ({}))) as {
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
      toast.error(err instanceof Error ? err.message : "AI generation failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSave() {
    if (!user) return;
    const report = makeReport();
    if (!report || !c?.id) return;
    setBusy("save");
    try {
      await saveReviewerDraft(c.id, report, user.uid);
      toast.success("Edits saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRevise() {
    if (!user || !c?.id) return;
    const note = comment.trim();
    if (!note) {
      toast.error("Add a correction note first.");
      return;
    }
    const report = makeReport();
    if (!report) return;
    setBusy("revise");
    try {
      const token = await user.getIdToken();
      const resp = await fetch(`/api/revise/${c.id}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ report, comment: note }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        report?: ReportJSON;
        error?: string;
      };
      if (!resp.ok || !data.report) {
        throw new Error(data.error || `Revision failed (${resp.status})`);
      }
      setScanTitle(data.report.scanTitle ?? "");
      setBodyText(reportToText(data.report));
      setComplianceText(data.report.complianceText ?? null);
      setComment("");
      // Refresh the case so the new comment shows in the history (the revise
      // route appended it server-side).
      setC(await getCase(c.id));
      toast.success("Report revised with your correction.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI revision failed.");
    } finally {
      setBusy(null);
    }
  }

  async function handleSendBack() {
    if (!user || !c?.id) return;
    const note = comment.trim();
    if (!note) {
      toast.error("Add a comment before sending back.");
      return;
    }
    setBusy("sendback");
    try {
      await sendBackToTypist(
        c.id,
        {
          text: note,
          byRole: "radiologist",
          byUid: user.uid,
          at: Timestamp.now(),
        },
        user.uid,
      );
      toast.success("Sent back to the typist for correction.");
      setSelectedId(null);
      setC(null);
      await loadQueue();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send back.");
    } finally {
      setBusy(null);
    }
  }

  async function handleApprove() {
    if (!user) return;
    const report = makeReport();
    if (!report || !c?.id) return;
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
      const resp = await fetch(`/api/export/${c.id}`, {
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
      toast.success("Approved — opening in Word and moved to Print Queue.");
      setSelectedId(null);
      setC(null);
      await loadQueue();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to approve & export.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full">
      {/* Queue — full width on mobile, fixed sidebar from md up. On a phone it
          hides once a case is open (master-detail), so the report gets the
          whole screen. */}
      <aside
        className={cn(
          "overflow-y-auto bg-muted p-3 md:w-[280px] md:flex-shrink-0 md:border-r md:border-border",
          selectedId ? "hidden w-full md:block" : "block w-full",
        )}
      >
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[13px] font-semibold">Pending Review</span>
          <span className="rounded-full border border-[#FCD34D] bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-semibold text-[#7C3E0B]">
            {queue.length}
          </span>
        </div>

        {queueLoading ? (
          <p className="px-1 py-4 text-xs text-muted-foreground">Loading…</p>
        ) : queue.length === 0 ? (
          <p className="px-1 py-4 text-xs text-muted-foreground">
            No reports pending review.
          </p>
        ) : (
          queue.map((q) => (
            <button
              key={q.id}
              onClick={() => setSelectedId(q.id ?? null)}
              className={cn(
                "mb-1.5 flex w-full items-center gap-2.5 rounded-[10px] border bg-card p-2.5 text-left transition-colors",
                selectedId === q.id
                  ? "border-primary shadow-[0_0_0_3px_rgba(27,94,140,0.1)]"
                  : "border-border hover:border-ring",
              )}
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[7px] bg-secondary text-primary">
                <FileText className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">
                  {q.patientName}
                </span>
                <span className="block truncate text-[11px] text-[#8591A8]">
                  {scanTypeLabel(q.scanType)}
                </span>
                <span className="block truncate text-[11px] text-[#8591A8]">
                  {q.age} · {q.gender} · {formatTimestamp(q.typistSubmittedAt)}
                </span>
              </span>
            </button>
          ))
        )}
      </aside>

      {/* Detail */}
      <section
        className={cn(
          "flex-1 overflow-y-auto p-4",
          selectedId ? "block" : "hidden md:block",
        )}
      >
        {!selectedId ? (
          <EmptyDetail
            title="Select a report to review"
            subtitle="Reports submitted by the typist appear on the left."
          />
        ) : detailLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !c ? (
          <EmptyDetail title="Case not found" subtitle="It may have moved on." />
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            <button
              onClick={() => setSelectedId(null)}
              className="-ml-1 mb-1 flex items-center gap-1 text-xs font-medium text-primary md:hidden"
            >
              <ChevronLeft className="h-4 w-4" /> Back to queue
            </button>
            <div>
              <div className="mb-1 text-[15px] font-semibold">
                {c.patientName}
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                    STATUS_META[c.status].className,
                  )}
                >
                  {STATUS_META[c.status].label}
                </span>
                <span className="text-[11px] text-[#8591A8]">
                  {scanTypeLabel(c.scanType)} · {c.age} · {c.gender} · MR{" "}
                  {c.mrNumber}
                </span>
              </div>
            </div>

            {c.radiologistNotes && (
              <div className="rounded-[10px] border border-border bg-card p-3">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#8591A8]">
                  Typist shorthand
                </div>
                <p className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                  {c.radiologistNotes}
                </p>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="scanTitle">Scan Title</Label>
              <Input
                id="scanTitle"
                value={scanTitle}
                onChange={(e) => setScanTitle(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="bodyText">Report Body</Label>
              <Textarea
                id="bodyText"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={22}
                className="font-mono text-xs leading-relaxed"
                placeholder="Each line becomes one paragraph in the Word document."
              />
              <p className="text-xs text-muted-foreground">
                One paragraph per line. Include the IMPRESSION section inline
                (header + dashed bullets).
              </p>
            </div>

            {isObstetricScan(c.scanType) && (
              <div className="space-y-1">
                <Label htmlFor="complianceText">
                  PC&amp;PNDT Compliance Text
                </Label>
                <Textarea
                  id="complianceText"
                  value={complianceText ?? ""}
                  onChange={(e) => setComplianceText(e.target.value)}
                  rows={6}
                  className="font-mono text-xs leading-relaxed"
                />
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label htmlFor="comment">Comments / Corrections</Label>
                <DictateButton
                  label="Voice Note"
                  onAppend={(t) =>
                    setComment((p) => (p ? `${p} ${t}` : t))
                  }
                />
              </div>
              <Textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                placeholder="Type or dictate a correction. 'AI Revise' rewrites the draft from this note; 'Send Back' returns the case to the typist with it."
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerate}
                disabled={busy !== null}
              >
                {busy === "generate" ? "Regenerating…" : "Regenerate"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevise}
                disabled={busy !== null}
              >
                {busy === "revise" ? "Revising…" : "AI Revise with Comments"}
              </Button>
              <Button
                variant="warning"
                size="sm"
                onClick={handleSendBack}
                disabled={busy !== null}
              >
                {busy === "sendback" ? "Sending…" : "Send Back to Typist"}
              </Button>
              <Button
                variant="outline"
                onClick={handleSave}
                disabled={busy !== null}
              >
                {busy === "save" ? "Saving…" : "Save edits"}
              </Button>
              <Button
                variant="success"
                onClick={handleApprove}
                disabled={busy !== null}
              >
                {busy === "approve"
                  ? "Approving…"
                  : "Approve & send to Print Queue"}
              </Button>
            </div>

            {c.comments && c.comments.length > 0 && (
              <div className="rounded-[10px] border border-border bg-card p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[#8591A8]">
                  Comment History
                </div>
                <div className="space-y-1.5">
                  {c.comments.map((cm, i) => (
                    <div
                      key={i}
                      className="rounded-[8px] bg-secondary p-2 text-[11px]"
                    >
                      <b className="capitalize">{cm.byRole}</b>{" "}
                      <span className="text-[#8591A8]">
                        {formatTimestamp(cm.at)}
                      </span>
                      <div className="whitespace-pre-wrap">{cm.text}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyDetail({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mt-16 text-center text-muted-foreground">
      <FileText className="mx-auto mb-3 h-8 w-8 opacity-40" />
      <h3 className="text-sm font-medium text-foreground/70">{title}</h3>
      <p className="text-xs">{subtitle}</p>
    </div>
  );
}
