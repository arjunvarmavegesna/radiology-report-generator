"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { ReportJSON, ReportSection } from "@/lib/types";

/**
 * Structured editor for a ReportJSON. Used by the typist (Phase 1: manual
 * entry) and the reviewer (Phase 1: final edits before approval). Phase 2
 * will replace this with Tiptap + AI-generated content + [VERIFY] flags.
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
  function set<K extends keyof ReportJSON>(key: K, value: ReportJSON[K]) {
    onChange({ ...report, [key]: value });
  }
  function updateSection(i: number, patch: Partial<ReportSection>) {
    set(
      "sections",
      report.sections.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );
  }
  function addSection() {
    set("sections", [...report.sections, { label: "", body: "" }]);
  }
  function removeSection(i: number) {
    if (report.sections.length <= 1) return;
    set(
      "sections",
      report.sections.filter((_, idx) => idx !== i),
    );
  }
  function updateImpression(i: number, v: string) {
    set(
      "impression",
      report.impression.map((s, idx) => (idx === i ? v : s)),
    );
  }
  function addImpression() {
    set("impression", [...report.impression, ""]);
  }
  function removeImpression(i: number) {
    if (report.impression.length <= 1) return;
    set(
      "impression",
      report.impression.filter((_, idx) => idx !== i),
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
        {report.sections.map((s, i) => (
          <div key={i} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Input
                className="max-w-xs"
                placeholder="Section label (e.g. Liver)"
                value={s.label}
                onChange={(e) => updateSection(i, { label: e.target.value })}
                disabled={disabled}
              />
              {!disabled && report.sections.length > 1 && (
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
        {report.impression.map((imp, i) => (
          <div key={i} className="flex items-start gap-2">
            <Textarea
              rows={2}
              placeholder="Abnormal finding…"
              value={imp}
              onChange={(e) => updateImpression(i, e.target.value)}
              disabled={disabled}
            />
            {!disabled && report.impression.length > 1 && (
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
