"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { getReviewQueue } from "@/lib/cases";
import { scanTypeLabel } from "@/lib/scan-types";
import { formatTimestamp, STATUS_META } from "@/lib/format";
import type { CaseDoc } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ReviewListPage() {
  const [cases, setCases] = useState<CaseDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await getReviewQueue();
      setCases(items);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load review list.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Review</CardTitle>
            <CardDescription>
              AI-drafted reports waiting for your review. Open a case to edit
              and approve it.
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
            Nothing waiting to review. Capture a new case to get started.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>MR</TableHead>
                <TableHead>Scan</TableHead>
                <TableHead>Drafted</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.patientName}
                    <div className="text-xs text-muted-foreground">
                      <Badge className={STATUS_META[c.status].className}>
                        {STATUS_META[c.status].label}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell>{c.mrNumber}</TableCell>
                  <TableCell>{scanTypeLabel(c.scanType)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatTimestamp(c.typistSubmittedAt ?? c.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Button asChild size="sm">
                      <Link href={`/review/${c.id}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
