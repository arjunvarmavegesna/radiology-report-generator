"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, RotateCw, Printer, Check } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getApprovedCases, markPrinted } from "@/lib/cases";
import { scanTypeLabel } from "@/lib/scan-types";
import { formatTimestamp, CHIP } from "@/lib/format";
import { openInWord } from "@/lib/office-url";
import { reportToText } from "@/lib/report-text";
import type { CaseDoc } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

type Filter = "all" | "ready" | "printed";

export default function PrintQueuePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [cases, setCases] = useState<CaseDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"open" | "regen" | "print" | null>(
    null,
  );
  const [preview, setPreview] = useState<CaseDoc | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCases(await getApprovedCases());
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load print queue.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Re-export to mint a fresh signed URL (the one stored at approval expires
   *  after 7 days), then hand it to Word via the ms-word: handler. */
  async function handleOpenInWord(c: CaseDoc) {
    if (!user || !c.id) return;
    if (!c.finalReport) {
      toast.error("This case has no final report yet.");
      return;
    }
    setBusyId(c.id);
    setBusyAction("open");
    try {
      const token = await user.getIdToken();
      const resp = await fetch(`/api/export/${c.id}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ report: c.finalReport }),
      });
      const data = (await resp.json()) as { downloadUrl?: string; error?: string };
      if (!resp.ok || !data.downloadUrl) {
        throw new Error(data.error || `Open failed (${resp.status})`);
      }
      openInWord(data.downloadUrl);
      toast.success("Opening in Word…");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open in Word.");
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  /** Re-run AI on the case's stored photos → resets to pending_review and
   *  opens it in the review workspace. */
  async function handleRegenerate(c: CaseDoc) {
    if (!user || !c.id) return;
    setBusyId(c.id);
    setBusyAction("regen");
    try {
      const token = await user.getIdToken();
      const resp = await fetch(`/api/generate/${c.id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Regenerate failed (${resp.status})`);
      }
      toast.success("New draft ready — opening for review.");
      router.push(`/review/${c.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to regenerate.");
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  async function handleMarkPrinted(c: CaseDoc) {
    if (!c.id) return;
    setBusyId(c.id);
    setBusyAction("print");
    try {
      await markPrinted(c.id);
      toast.success("Marked as printed.");
      setPreview(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to mark printed.");
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  const filtered = cases.filter((c) => {
    if (filter === "ready") return !c.printedAt;
    if (filter === "printed") return !!c.printedAt;
    return true;
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[780px] p-4">
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold">Approved Reports</div>
            <div className="mt-0.5 text-[11px] text-[#8591A8]">
              Print-ready reports
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              className="rounded-md border border-input bg-card px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-ring"
              aria-label="Filter reports"
            >
              <option value="all">All</option>
              <option value="ready">Ready</option>
              <option value="printed">Printed</option>
            </select>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="mt-16 text-center text-muted-foreground">
            <Printer className="mx-auto mb-3 h-8 w-8 opacity-40" />
            <h3 className="text-sm font-medium text-foreground/70">
              No reports here yet
            </h3>
            <p className="text-xs">Approved reports appear in this queue.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((c) => {
              const printed = !!c.printedAt;
              const busy = busyId === c.id;
              return (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-[10px] border border-border bg-card p-3"
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[7px]",
                      printed
                        ? "bg-[#EDF0F4] text-[#48516A]"
                        : "bg-[#D1FAE5] text-[#155E3A]",
                    )}
                  >
                    {printed ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Printer className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold">
                      {c.patientName}
                    </div>
                    <div className="truncate text-[11px] text-[#8591A8]">
                      {scanTypeLabel(c.scanType)} · MR {c.mrNumber} ·{" "}
                      {formatTimestamp(c.reviewerApprovedAt)}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                        printed ? CHIP.gray : CHIP.green,
                      )}
                    >
                      {printed ? "Printed" : "Ready"}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRegenerate(c)}
                      disabled={busy}
                    >
                      <RotateCw className="mr-1 h-3.5 w-3.5" />
                      {busy && busyAction === "regen" ? "…" : "Regenerate"}
                    </Button>
                    <Button size="sm" onClick={() => setPreview(c)} disabled={busy}>
                      <Printer className="mr-1 h-3.5 w-3.5" />
                      Print
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Print preview */}
      <Modal open={!!preview} onClose={() => setPreview(null)}>
        {preview && (
          <>
            <div className="mb-3.5 text-sm font-semibold">Print Preview</div>
            <div className="print-area font-mono text-xs">
              <div className="mb-3 border-b-2 border-primary pb-2.5">
                <h2 className="font-sans text-sm font-bold text-primary">
                  RADIOLOGY REPORTS
                </h2>
                <p className="font-sans text-[10px] text-[#8591A8]">
                  Ultrasound Report
                </p>
              </div>
              <table className="mb-2.5 w-full border-collapse text-[11.5px]">
                <tbody>
                  <tr>
                    <td className="w-[18%] py-0.5 align-top font-medium text-[#8591A8]">
                      Patient
                    </td>
                    <td className="w-[32%] py-0.5 align-top">
                      <b>{preview.patientName}</b>
                    </td>
                    <td className="w-[18%] py-0.5 align-top font-medium text-[#8591A8]">
                      MR Number
                    </td>
                    <td className="py-0.5 align-top">{preview.mrNumber}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 align-top font-medium text-[#8591A8]">
                      Age / Gender
                    </td>
                    <td className="py-0.5 align-top">
                      {preview.age} / {preview.gender}
                    </td>
                    <td className="py-0.5 align-top font-medium text-[#8591A8]">
                      Date
                    </td>
                    <td className="py-0.5 align-top">{preview.dateOfExam}</td>
                  </tr>
                  <tr>
                    <td className="py-0.5 align-top font-medium text-[#8591A8]">
                      Ref Doctor
                    </td>
                    <td className="py-0.5 align-top">
                      {preview.refDoctor || "—"}
                    </td>
                    <td className="py-0.5 align-top font-medium text-[#8591A8]">
                      Scan Type
                    </td>
                    <td className="py-0.5 align-top">
                      {scanTypeLabel(preview.scanType)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <hr className="my-2 border-border" />
              <div className="whitespace-pre-wrap leading-[2]">
                {preview.finalReport
                  ? reportToText(preview.finalReport)
                  : "No final report on this case."}
              </div>
              {preview.finalReport?.complianceText && (
                <div className="mt-3 whitespace-pre-wrap text-[10px] leading-relaxed text-[#8591A8]">
                  {preview.finalReport.complianceText}
                </div>
              )}
              <div className="mt-7 flex justify-end">
                <div className="w-52 text-center">
                  <div className="mb-1 h-8 border-b border-border" />
                  <div className="font-sans text-xs font-semibold">
                    Consultant Radiologist
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
              <Button variant="outline" onClick={() => setPreview(null)}>
                Close
              </Button>
              <Button
                variant="outline"
                onClick={() => window.print()}
                disabled={busyId === preview.id}
              >
                <Printer className="mr-1.5 h-4 w-4" />
                Print
              </Button>
              {!preview.printedAt && (
                <Button
                  variant="outline"
                  onClick={() => handleMarkPrinted(preview)}
                  disabled={busyId === preview.id}
                >
                  {busyId === preview.id && busyAction === "print"
                    ? "Marking…"
                    : "Mark as printed"}
                </Button>
              )}
              <Button
                onClick={() => handleOpenInWord(preview)}
                disabled={busyId === preview.id}
              >
                <FileText className="mr-1.5 h-4 w-4" />
                {busyId === preview.id && busyAction === "open"
                  ? "Opening…"
                  : "Open in Word"}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
