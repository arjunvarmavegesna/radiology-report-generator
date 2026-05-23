"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, RotateCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getApprovedCases } from "@/lib/cases";
import { scanTypeLabel } from "@/lib/scan-types";
import { formatTimestamp } from "@/lib/format";
import { openInWord } from "@/lib/office-url";
import type { CaseDoc } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function PrintQueuePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [cases, setCases] = useState<CaseDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"open" | "regen" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await getApprovedCases();
      setCases(items);
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

  /** Re-export to mint a fresh signed URL (the URL stored at approval time
   *  expires after 7 days), then hand it to Word via the ms-word: handler. */
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
      const data = (await resp.json()) as {
        downloadUrl?: string;
        error?: string;
      };
      if (!resp.ok || !data.downloadUrl) {
        throw new Error(data.error || `Open failed (${resp.status})`);
      }
      openInWord(data.downloadUrl);
      toast.success("Opening in Word…");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to open in Word.",
      );
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  /** Re-run AI on the case's stored photos. Server resets status to
   *  pending_review and clears the approval bookkeeping. */
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
        const body = (await resp.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Regenerate failed (${resp.status})`);
      }
      toast.success("New draft ready — opening for review.");
      router.push(`/review/${c.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to regenerate.",
      );
      setBusyId(null);
      setBusyAction(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Print Queue</CardTitle>
            <CardDescription>
              Approved reports. Open in Word to print or tweak; Regenerate
              re-runs Claude on the original photos and sends the case back to
              Review.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : cases.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No approved reports yet. Approve a case in Review to add it here.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>MR</TableHead>
                <TableHead>Scan</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead className="w-72"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c) => {
                const busy = busyId === c.id;
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      {c.patientName}
                    </TableCell>
                    <TableCell>{c.mrNumber}</TableCell>
                    <TableCell>{scanTypeLabel(c.scanType)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatTimestamp(c.reviewerApprovedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleOpenInWord(c)}
                          disabled={busy}
                        >
                          <FileText className="mr-1.5 h-4 w-4" />
                          {busy && busyAction === "open"
                            ? "Opening…"
                            : "Open in Word"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRegenerate(c)}
                          disabled={busy}
                        >
                          <RotateCw className="mr-1.5 h-4 w-4" />
                          {busy && busyAction === "regen"
                            ? "Regenerating…"
                            : "Regenerate"}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
