"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CaseDoc } from "@/lib/types";
import { getTypingQueue } from "@/lib/cases";
import { scanTypeLabel } from "@/lib/scan-types";
import { formatTimestamp } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function TypistQueuePage() {
  const router = useRouter();
  const [cases, setCases] = useState<CaseDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTypingQueue();
      setCases(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="space-y-1">
          <CardTitle>Typing Queue</CardTitle>
          <CardDescription>Cases awaiting typing, oldest first.</CardDescription>
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
              <TableHead>Date of Exam</TableHead>
              <TableHead>Ref. Doctor</TableHead>
              <TableHead>Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : error ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  {error}
                </TableCell>
              </TableRow>
            ) : cases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  The queue is empty.
                </TableCell>
              </TableRow>
            ) : (
              cases.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => router.push(`/typist/case/${c.id}`)}
                >
                  <TableCell className="font-bold">{c.patientName}</TableCell>
                  <TableCell>{c.mrNumber}</TableCell>
                  <TableCell>{scanTypeLabel(c.scanType)}</TableCell>
                  <TableCell>{c.dateOfExam}</TableCell>
                  <TableCell>{c.refDoctor}</TableCell>
                  <TableCell>{formatTimestamp(c.createdAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
