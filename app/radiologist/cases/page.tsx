"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { getCasesByRadiologist } from "@/lib/cases";
import { formatTimestamp, STATUS_META } from "@/lib/format";
import { scanTypeLabel } from "@/lib/scan-types";
import type { CaseDoc } from "@/lib/types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export default function CasesPage() {
  const { user } = useAuth();
  const [cases, setCases] = useState<CaseDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getCasesByRadiologist(user.uid);
      setCases(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cases.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>My Cases</CardTitle>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>MR No.</TableHead>
              <TableHead>Scan Type</TableHead>
              <TableHead>Date of Exam</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
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
                  No cases yet.
                </TableCell>
              </TableRow>
            ) : (
              cases.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.patientName}</TableCell>
                  <TableCell>{c.mrNumber}</TableCell>
                  <TableCell>{scanTypeLabel(c.scanType)}</TableCell>
                  <TableCell>{c.dateOfExam}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_META[c.status].className}>
                      {STATUS_META[c.status].label}
                    </Badge>
                  </TableCell>
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
