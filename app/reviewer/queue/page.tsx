"use client";

import { useState, useEffect, useCallback } from "react";
import { getReviewQueue } from "@/lib/cases";
import { scanTypeLabel } from "@/lib/scan-types";
import { formatTimestamp } from "@/lib/format";
import type { CaseDoc } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export default function ReviewQueuePage() {
  const [cases, setCases] = useState<CaseDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getReviewQueue();
      setCases(data);
    } catch {
      setError("Failed to load review queue. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Review Queue</CardTitle>
          <CardDescription>Cases awaiting final review, oldest first.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>MR No.</TableHead>
              <TableHead>Scan Type</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {error}
                </TableCell>
              </TableRow>
            ) : cases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No cases awaiting review.
                </TableCell>
              </TableRow>
            ) : (
              cases.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-bold">{c.patientName}</TableCell>
                  <TableCell>{c.mrNumber}</TableCell>
                  <TableCell>{scanTypeLabel(c.scanType)}</TableCell>
                  <TableCell>{formatTimestamp(c.typistSubmittedAt)}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" disabled>
                      Open (Phase 2)
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
