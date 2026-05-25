"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, X, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectLabel,
  SelectItem,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/lib/auth-context";
import { createCase, submitToReviewer } from "@/lib/cases";
import { scanTypeLabel } from "@/lib/scan-types";
import { todayInputDate, inputDateToDDMMYYYY } from "@/lib/format";
import { reportToText, textToBody } from "@/lib/report-text";
import type { Gender, ReportJSON } from "@/lib/types";

const MAX_PHOTOS = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIME = /^image\/(jpeg|jpg|png|webp|gif)$/i;

/** The 21 canonical scan types, grouped for the dropdown (values unchanged). */
const SCAN_GROUPS: { label: string; values: string[] }[] = [
  { label: "Abdomen / Pelvis", values: ["abdomen_male", "abdomen_female", "pelvis"] },
  { label: "Breast / Small Parts", values: ["breast", "soft_parts", "scrotum"] },
  { label: "Thyroid / Neck", values: ["thyroid_neck"] },
  {
    label: "Obstetrics",
    values: [
      "early_pregnancy",
      "early_pregnancy_no_fhr",
      "nt_scan",
      "nt_twins",
      "tiffa",
      "tiffa_twins",
      "growth",
      "growth_twins",
      "fetal_echo",
    ],
  },
  {
    label: "Doppler Studies",
    values: [
      "venous_doppler",
      "venous_doppler_single",
      "arteries_doppler",
      "renal_artery_doppler",
      "carotid_doppler",
    ],
  },
];

/** See note in the original capture page: persists text fields across the
 *  Android camera-intent reload. Photos stay ephemeral. */
const DRAFT_KEY = "rrg.capture.draft.v1";

interface DraftFields {
  patientName: string;
  age: string;
  gender: Gender;
  mrNumber: string;
  date: string;
  refDoctor: string;
  scanType: string;
  radiologistNotes: string;
}

const SECTION_LABEL =
  "mb-3 text-[11px] font-bold uppercase tracking-wider text-[#8591A8]";
const CARD = "rounded-[14px] border border-border bg-card p-4 shadow-sm";

export default function CapturePage() {
  const { user } = useAuth();

  const [patientName, setPatientName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender>("Male");
  const [mrNumber, setMrNumber] = useState("");
  const [date, setDate] = useState(todayInputDate());
  const [refDoctor, setRefDoctor] = useState("");
  const [scanType, setScanType] = useState("");
  const [radiologistNotes, setRadiologistNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);

  // Generation lifecycle.
  const [phase, setPhase] = useState<
    "idle" | "uploading" | "generating" | "submitting"
  >("idle");
  const [caseId, setCaseId] = useState<string | null>(null);
  const [draftReport, setDraftReport] = useState<ReportJSON | null>(null);
  const [draftText, setDraftText] = useState("");
  const [edited, setEdited] = useState(false);

  const [hydrated, setHydrated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Restore saved draft on mount (mobile camera-intent recovery).
  useEffect(() => {
    if (typeof window === "undefined") {
      setHydrated(true);
      return;
    }
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<DraftFields>;
        if (s.patientName) setPatientName(s.patientName);
        if (s.age) setAge(s.age);
        if (s.gender) setGender(s.gender);
        if (s.mrNumber) setMrNumber(s.mrNumber);
        if (s.date) setDate(s.date);
        if (s.refDoctor) setRefDoctor(s.refDoctor);
        if (s.scanType) setScanType(s.scanType);
        if (s.radiologistNotes) setRadiologistNotes(s.radiologistNotes);
      }
    } catch {
      /* malformed JSON — ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      const draft: DraftFields = {
        patientName,
        age,
        gender,
        mrNumber,
        date,
        refDoctor,
        scanType,
        radiologistNotes,
      };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* quota — non-fatal */
    }
  }, [
    hydrated,
    patientName,
    age,
    gender,
    mrNumber,
    date,
    refDoctor,
    scanType,
    radiologistNotes,
  ]);

  function clearDraft() {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
  }

  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  useEffect(() => {
    const urls = photos.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [photos]);

  const busy = phase !== "idle";
  // Once a case exists the inputs are frozen (the case was created from them);
  // the typist edits the report instead. Discard to start a fresh case.
  const inputsLocked = busy || caseId !== null;

  function addFiles(incoming: FileList | null) {
    if (!incoming || incoming.length === 0) return;
    const next = [...photos];
    for (const f of Array.from(incoming)) {
      if (!ACCEPTED_MIME.test(f.type)) {
        toast.error(`${f.name}: not a supported image type.`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name}: too large (max 5 MB).`);
        continue;
      }
      if (next.length >= MAX_PHOTOS) {
        toast.error(`Up to ${MAX_PHOTOS} photos per case.`);
        break;
      }
      next.push(f);
    }
    setPhotos(next);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removePhoto(idx: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  }

  function validate(): boolean {
    if (!patientName.trim() || !age.trim() || !gender || !mrNumber.trim() || !scanType) {
      toast.error("Please fill in all required fields.");
      return false;
    }
    if (!radiologistNotes.trim() && photos.length === 0) {
      toast.error(
        "Add typed notes OR upload at least one photo of handwritten notes.",
      );
      return false;
    }
    return true;
  }

  /** Create the case (first time) and run AI generation in place. */
  async function runGenerate() {
    if (!user) {
      toast.error("Not signed in.");
      return;
    }
    if (!validate()) return;
    try {
      let id = caseId;
      if (!id) {
        setPhase("uploading");
        id = await createCase(
          {
            patientName,
            age,
            gender,
            mrNumber,
            dateOfExam: inputDateToDDMMYYYY(date),
            refDoctor,
            scanType,
            radiologistNotes,
            notesImages: photos,
          },
          user.uid,
        );
        setCaseId(id);
        clearDraft();
      }
      setPhase("generating");
      const token = await user.getIdToken();
      const resp = await fetch(`/api/generate/${id}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await resp.json().catch(() => ({}))) as {
        report?: ReportJSON;
        error?: string;
      };
      if (!resp.ok || !data.report) {
        throw new Error(data.error ?? `AI generation failed (${resp.status})`);
      }
      setDraftReport(data.report);
      setDraftText(reportToText(data.report));
      setEdited(false);
      toast.success("Report generated — review, edit, then submit.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setPhase("idle");
    }
  }

  function handleRegenerate() {
    if (edited && !window.confirm("Regenerate will discard your edits. Continue?")) {
      return;
    }
    runGenerate();
  }

  function handleDiscard() {
    if (!window.confirm("Discard this generated report?")) return;
    // The pending_typing case stays in Firestore but is never surfaced (the
    // review queue only shows submitted cases), so this is safe.
    setDraftReport(null);
    setDraftText("");
    setEdited(false);
    setCaseId(null);
  }

  function resetAll() {
    setPatientName("");
    setAge("");
    setGender("Male");
    setMrNumber("");
    setDate(todayInputDate());
    setRefDoctor("");
    setScanType("");
    setRadiologistNotes("");
    setPhotos([]);
    setCaseId(null);
    setDraftReport(null);
    setDraftText("");
    setEdited(false);
    clearDraft();
  }

  async function handleSubmit() {
    if (!user || !caseId || !draftReport) return;
    if (!draftText.trim()) {
      toast.error("Report is empty.");
      return;
    }
    setPhase("submitting");
    try {
      const report: ReportJSON = {
        patientDetails: {
          name: patientName,
          age,
          gender,
          mrNumber,
          date: inputDateToDDMMYYYY(date),
          refDoctor,
        },
        scanTitle: draftReport.scanTitle,
        body: textToBody(draftText),
        complianceText: draftReport.complianceText,
      };
      await submitToReviewer(caseId, report, user.uid);
      toast.success(`Report for ${patientName} submitted for radiologist review.`);
      resetAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit.");
    } finally {
      setPhase("idle");
    }
  }

  function loadDemo() {
    setPatientName("G. Lakshmi Narasamma");
    setAge("52");
    setGender("Female");
    setMrNumber("26001924");
    setRefDoctor("Dr. Vikranth Chunduri");
    setScanType("abdomen_female");
    setRadiologistNotes(
      "Liver 13.8cm. GB pld wall normal no calculi. Pancreas H and b normal. Spleen 9.2cm. RK 9.4x4.7cm normal. LK 9.9x5.1cm normal. UB adequately distended wall normal. Uterus anteverted 7x3.5x3cm EE 6mm normal. BL ovaries normal. No free fluid. OLPH Nil.",
    );
    toast.info("Demo patient loaded — click Generate Report.");
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[820px] space-y-3 p-4">
        {/* Patient Information */}
        <div className={CARD}>
          <div className={SECTION_LABEL}>Patient Information</div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2.5">
            <Field label="Patient Name" required>
              <Input
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="e.g. G. Lakshmi Devi"
                disabled={inputsLocked}
              />
            </Field>
            <Field label="Age" required>
              <Input
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="e.g. 42 Yrs"
                disabled={inputsLocked}
              />
            </Field>
            <Field label="Gender" required>
              <RadioGroup
                value={gender}
                onValueChange={(v) => setGender(v as Gender)}
                className="flex h-10 items-center gap-5"
                disabled={inputsLocked}
              >
                {(["Female", "Male"] as Gender[]).map((g) => (
                  <div key={g} className="flex items-center gap-1.5">
                    <RadioGroupItem id={`gender-${g}`} value={g} />
                    <Label htmlFor={`gender-${g}`}>{g}</Label>
                  </div>
                ))}
              </RadioGroup>
            </Field>
            <Field label="MR Number" required>
              <Input
                value={mrNumber}
                onChange={(e) => setMrNumber(e.target.value)}
                placeholder="e.g. 26002411"
                disabled={inputsLocked}
              />
            </Field>
            <Field label="Referring Doctor">
              <Input
                value={refDoctor}
                onChange={(e) => setRefDoctor(e.target.value)}
                placeholder="e.g. Dr. Vikranth Chunduri"
                disabled={inputsLocked}
              />
            </Field>
            <Field label="Date of Examination" required>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={inputsLocked}
              />
            </Field>
          </div>
        </div>

        {/* Scan Type */}
        <div className={CARD}>
          <div className={SECTION_LABEL}>
            Scan Type <span className="text-[#7F1D1D]">*</span>
          </div>
          <Select
            value={scanType}
            onValueChange={setScanType}
            disabled={inputsLocked}
          >
            <SelectTrigger>
              <SelectValue placeholder="-- Select scan type --" />
            </SelectTrigger>
            <SelectContent>
              {SCAN_GROUPS.map((g) => (
                <SelectGroup key={g.label}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {g.values.map((v) => (
                    <SelectItem key={v} value={v}>
                      {scanTypeLabel(v)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Raw Data Form */}
        <div className={CARD}>
          <div className={SECTION_LABEL}>Raw Data Form</div>

          <div className="flex flex-wrap items-start gap-3">
            {previewUrls.map((url, i) => (
              <div
                key={url}
                className="relative h-24 w-24 overflow-hidden rounded-md border border-input bg-muted"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Notes photo ${i + 1}`}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  disabled={inputsLocked}
                  className="absolute right-1 top-1 rounded-full bg-background/80 p-0.5 text-foreground shadow hover:bg-background disabled:opacity-50"
                  aria-label={`Remove photo ${i + 1}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={inputsLocked}
                className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-[#C4CBDA] bg-muted/40 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                aria-label="Add a photo"
              >
                <ImagePlus className="h-5 w-5" />
                <span>Add photo</span>
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            capture="environment"
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
            disabled={inputsLocked}
          />
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-[#8591A8]">
            <Camera className="h-3 w-3" />
            On mobile this opens the camera — snap the handwritten raw-data form
            (up to {MAX_PHOTOS}, ≤ 5 MB each).
          </p>

          <div className="mt-3">
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8591A8]">
              Or type raw readings manually
            </div>
            <Textarea
              value={radiologistNotes}
              onChange={(e) => setRadiologistNotes(e.target.value)}
              rows={5}
              className="font-mono"
              placeholder="e.g. Liver 14.5cm. GB pld. Pancreas H and b normal. Spleen 8.2cm. RK @ m s he. LK @ m s he. UB empty c review full bladder."
              disabled={inputsLocked}
            />
            <p className="mt-1.5 text-[11px] text-[#8591A8]">
              Shorthand: @ = normal, m s he = normal size and echo, pld =
              partially distended, mld = minimally distended, c = with, H and b
              = head and body, OLPH = no other lesions
            </p>
          </div>
        </div>

        {/* Actions (before a draft exists) */}
        {!draftReport && (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={loadDemo} disabled={busy}>
              Load Demo Patient
            </Button>
            <Button onClick={runGenerate} disabled={busy}>
              {phase === "uploading"
                ? "Uploading photos…"
                : phase === "generating"
                  ? "Generating…"
                  : "Generate Report with AI"}
            </Button>
          </div>
        )}

        {/* Generated Report */}
        {draftReport && (
          <div className={CARD}>
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#8591A8]">
                  Generated Report
                </span>
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                  AI · clinic format
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerate}
                disabled={busy}
              >
                {phase === "generating" ? "Regenerating…" : "Regenerate"}
              </Button>
            </div>

            <div className="overflow-hidden rounded-[10px] border border-border">
              <div className="flex items-center justify-between border-b border-border bg-secondary px-3 py-2">
                <span className="text-xs font-medium text-primary">
                  Editable — modify freely before submitting
                </span>
                <span className="text-[11px] text-[#8591A8]">
                  {edited ? "Edited by typist" : "AI generated"}
                </span>
              </div>
              <textarea
                value={draftText}
                onChange={(e) => {
                  setDraftText(e.target.value);
                  setEdited(true);
                }}
                disabled={busy}
                className="min-h-[340px] w-full resize-y border-none bg-card p-3 font-mono text-xs leading-[1.9] text-foreground outline-none"
              />
            </div>

            <div className="mt-2.5 flex justify-end gap-2">
              <Button variant="outline" onClick={handleDiscard} disabled={busy}>
                Discard
              </Button>
              <Button onClick={handleSubmit} disabled={busy}>
                {phase === "submitting"
                  ? "Submitting…"
                  : "Submit for Radiologist Review"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact labelled form field used across the patient grid. */
function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label>
        {label} {required && <span className="text-[#7F1D1D]">*</span>}
      </Label>
      {children}
    </div>
  );
}
