"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { CaseDoc } from "@/lib/types";
import { getCase } from "@/lib/cases";
import { scanTypeLabel } from "@/lib/scan-types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function TypistCasePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [c, setC] = useState<CaseDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCase(id)
      .then((data) => setC(data))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/typist/queue">← Back to queue</Link>
      </Button>

      {loading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : !c ? (
        <p className="text-muted-foreground">Case not found.</p>
      ) : (
        <div className="grid md:grid-cols-3 gap-6">
          {/* LEFT */}
          <div className="md:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Patient</CardTitle>
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

          {/* RIGHT */}
          <div className="md:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>Report</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  <p>AI report generation arrives in Phase 2.</p>
                  <div className="mt-4">
                    <Button disabled>Generate Report (Phase 2)</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
