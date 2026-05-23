"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ReportJSON, ReportSection } from "@/lib/types";

/**
 * Structured editor for a ReportJSON. Legacy — the live review screen at
 * /review/[caseId] now uses a single Textarea bound to body[] (one
 * paragraph per line) instead of this per-section editor. This component
 * is kept compilable against the new optional-field ReportJSON shape in
 * case someone wants to bring back the structured editing UI; it operates
 * on the legacy `sections` + `impression` fields with empty-array fallbacks.
 */
export function ReportEditor({
  report,
  onChange,
  disabled = false,
  showCompliance = true,
}: {
  report: ReportJSON;
  onChange: (r: ReportJSON) => void;
  disabled?: boolean;
  showCompliance?: boolean;
}) {
  const sections = report.sections ?? [];
  const impression = report.impression ?? [];

  function set<K extends keyof ReportJSON>(key: K, value: ReportJSON[K]) {
    onChange({ ...report, [key]: value });
  }
  function updateSection(i: number, patch: Partial<ReportSection>) {
    set(
      "sections",
      sections.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );
  }
  function addSection() {
    set("sections", [...sections, { label: "", body: "" }]);
  }
  function removeSection(i: number) {
    if (sections.length <= 1) return;
    set(
      "sections",
      sections.filter((_, idx) => idx !== i),
    );
  }
  function updateImpression(i: number, v: string) {
    set(
      "impression",
      impression.map((s, idx) => (idx === i ? v : s)),
    );
  }
  function addImpression() {
    set("impression", [...impression, ""]);
  }
  function removeImpression(i: number) {
    if (impression.length <= 1) return;
    set(
      "impression",
      impression.filter((_, idx) => idx !== i),
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Label htmlFor="scanTitle">Scan Title</Label>
        <Input
          id="scanTitle"
          value={report.scanTitle}
          onChange={(e) => set("scanTitle", e.target.value)}
          disabled={disabled}
        />
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Sections (organ-by-organ findings)</Label>
          {!disabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addSection}
            >
              + Add section
            </Button>
          )}
        </div>
        {sections.map((s, i) => (
          <div key={i} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Input
                className="max-w-xs"
                placeholder="Section label (e.g. Liver)"
                value={s.label}
                onChange={(e) => updateSection(i, { label: e.target.value })}
                disabled={disabled}
              />
              {!disabled && sections.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeSection(i)}
                >
                  Remove
                </Button>
              )}
            </div>
            <Textarea
              rows={4}
              placeholder="Findings…"
              value={s.body}
              onChange={(e) => updateSection(i, { body: e.target.value })}
              disabled={disabled}
            />
          </div>
        ))}
      </div>

      <Separator />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Impression</Label>
          {!disabled && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addImpression}
            >
              + Add line
            </Button>
          )}
        </div>
        {impression.map((imp, i) => (
          <div key={i} className="flex items-start gap-2">
            <Textarea
              rows={2}
              placeholder="Abnormal finding…"
              value={imp}
              onChange={(e) => updateImpression(i, e.target.value)}
              disabled={disabled}
            />
            {!disabled && impression.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeImpression(i)}
              >
                Remove
              </Button>
            )}
          </div>
        ))}
      </div>

      {showCompliance && (
        <>
          <Separator />
          <div className="space-y-1">
            <Label htmlFor="complianceText">
              Compliance text (OB scans — paste verbatim from the template)
            </Label>
            <Textarea
              id="complianceText"
              rows={4}
              value={report.complianceText ?? ""}
              onChange={(e) =>
                set("complianceText", e.target.value || null)
              }
              disabled={disabled}
            />
          </div>
        </>
      )}
    </div>
  );
}
