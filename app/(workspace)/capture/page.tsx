"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Camera, X, ImagePlus, FileText } from "lucide-react";
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
import { Modal } from "@/components/ui/modal";
import { DictateButton } from "@/components/dictate-button";
import { useAuth } from "@/lib/auth-context";
import { createCase, submitToReviewer, getSentBackQueue } from "@/lib/cases";
import { scanTypeLabel } from "@/lib/scan-types";
import { todayInputDate, inputDateToDDMMYYYY, formatTimestamp } from "@/lib/format";
import { reportToText, textToBody, emptyReport } from "@/lib/report-text";
import {
  recordCorrection,
  getLearningStats,
  listLearning,
  clearLearning,
  type LearningEntry,
  type LearningStats,
} from "@/lib/learning";
import { loadPersona, type Persona } from "@/lib/persona";
import { compressImage } from "@/lib/image";
import type { CaseDoc, Gender, ReportJSON } from "@/lib/types";

const MAX_PHOTOS = 3;
const MAX_BYTES = 5 * 1024 * 1024;

const REPORTING_RADIOLOGISTS = [
  "Dr. K. Valli Manasa, MD",
  "Dr. Anitha Reddy, MD",
  "Dr. Suresh Babu, MD",
];

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

const DRAFT_KEY = "rrg.capture.draft.v1";

interface DraftFields {
  patientName: string;
  age: string;
  gender: Gender;
  mrNumber: string;
  date: string;
  refDoctor: string;
  speciality: string;
  reportingRadiologist: string;
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
  const [speciality, setSpeciality] = useState("");
  const [reportingRadiologist, setReportingRadiologist] = useState(
    REPORTING_RADIOLOGISTS[0],
  );
  const [scanType, setScanType] = useState("");
  const [radiologistNotes, setRadiologistNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);

  const [phase, setPhase] = useState<
    "idle" | "uploading" | "generating" | "submitting"
  >("idle");
  const [caseId, setCaseId] = useState<string | null>(null);
  const [draftReport, setDraftReport] = useState<ReportJSON | null>(null);
  const [draftText, setDraftText] = useState("");
  const [edited, setEdited] = useState(false);

  // Sent-back correction mode: when set, the page edits an existing case the
  // radiologist returned, rather than capturing a new one.
  const [loadedCase, setLoadedCase] = useState<CaseDoc | null>(null);
  const [sentBack, setSentBack] = useState<CaseDoc[]>([]);

  // AI learning bar.
  const [learnStats, setLearnStats] = useState<LearningStats>({
    corrections: 0,
    approvals: 0,
  });
  const [learnEntries, setLearnEntries] = useState<LearningEntry[] | null>(null);

  const [persona, setPersona] = useState<Persona>("typist");
  const [hydrated, setHydrated] = useState(false);

  const busy = phase !== "idle";
  const inputsLocked = busy || caseId !== null;

  // Restore saved draft + load sidebars on mount.
  useEffect(() => {
    setPersona(loadPersona());
    if (typeof window !== "undefined") {
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
          if (s.speciality) setSpeciality(s.speciality);
          if (s.reportingRadiologist)
            setReportingRadiologist(s.reportingRadiologist);
          if (s.scanType) setScanType(s.scanType);
          if (s.radiologistNotes) setRadiologistNotes(s.radiologistNotes);
        }
      } catch {
        /* ignore */
      }
    }
    setHydrated(true);
    void refreshSidebars();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshSidebars() {
    try {
      setSentBack(await getSentBackQueue());
    } catch {
      /* ignore */
    }
    try {
      setLearnStats(await getLearningStats());
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!hydrated || typeof window === "undefined" || loadedCase) return;
    try {
      const draft: DraftFields = {
        patientName,
        age,
        gender,
        mrNumber,
        date,
        refDoctor,
        speciality,
        reportingRadiologist,
        scanType,
        radiologistNotes,
      };
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [
    hydrated,
    loadedCase,
    patientName,
    age,
    gender,
    mrNumber,
    date,
    refDoctor,
    speciality,
    reportingRadiologist,
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

  async function addFiles(incoming: FileList | null) {
    if (!incoming || incoming.length === 0) return;

    const slotsLeft = MAX_PHOTOS - photos.length;
    if (slotsLeft <= 0) {
      toast.error(`Up to ${MAX_PHOTOS} photos per case.`);
      return;
    }
    const picked = Array.from(incoming).slice(0, slotsLeft);
    if (picked.length < incoming.length) {
      toast.error(`Up to ${MAX_PHOTOS} photos per case.`);
    }

    const added: File[] = [];
    for (const f of picked) {
      if (!f.type.startsWith("image/")) {
        toast.error(`${f.name}: not an image file.`);
        continue;
      }
      // Downscale phone photos so large captures (5–12 MB is normal) upload
      // fine; falls back to the original File if the browser can't re-encode.
      const file = await compressImage(f);
      if (file.size > MAX_BYTES) {
        toast.error(`${f.name}: still over 5 MB after resizing — try again.`);
        continue;
      }
      added.push(file);
    }
    if (added.length) {
      setPhotos((prev) => [...prev, ...added].slice(0, MAX_PHOTOS));
    }
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
            speciality,
            reportingRadiologist,
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
    setSpeciality("");
    setReportingRadiologist(REPORTING_RADIOLOGISTS[0]);
    setScanType("");
    setRadiologistNotes("");
    setPhotos([]);
    setCaseId(null);
    setDraftReport(null);
    setDraftText("");
    setEdited(false);
    setLoadedCase(null);
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
      const patientDetails = loadedCase
        ? draftReport.patientDetails
        : {
            name: patientName,
            age,
            gender,
            mrNumber,
            date: inputDateToDDMMYYYY(date),
            refDoctor,
          };
      const report: ReportJSON = {
        patientDetails,
        scanTitle: draftReport.scanTitle,
        body: textToBody(draftText),
        complianceText: draftReport.complianceText,
      };
      await submitToReviewer(caseId, report, user.uid);
      if (edited) {
        const st = loadedCase?.scanType ?? scanType;
        await recordCorrection({
          scanType: st,
          aiText: reportToText(draftReport),
          correctedText: draftText,
          comment: "Typist edited the draft before submission",
          byRole: "typist",
        });
      }
      toast.success(
        `Report for ${patientDetails.name} submitted for radiologist review.`,
      );
      resetAll();
      await refreshSidebars();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit.");
    } finally {
      setPhase("idle");
    }
  }

  function openSentBack(c: CaseDoc) {
    const src =
      c.finalReport ?? c.editedReport ?? c.draftReport ?? emptyReport(c);
    setLoadedCase(c);
    setCaseId(c.id ?? null);
    setDraftReport(src);
    setDraftText(reportToText(src));
    setEdited(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function loadDemo() {
    setPatientName("G. Lakshmi Narasamma");
    setAge("52");
    setGender("Female");
    setMrNumber("26001924");
    setRefDoctor("Dr. Vikranth Chunduri");
    setSpeciality("Gastroenterologist");
    setScanType("abdomen_female");
    setRadiologistNotes(
      "Liver 13.8cm. GB pld wall normal no calculi. Pancreas H and b normal. Spleen 9.2cm. RK 9.4x4.7cm normal. LK 9.9x5.1cm normal. UB adequately distended wall normal. Uterus anteverted 7x3.5x3cm EE 6mm normal. BL ovaries normal. No free fluid. OLPH Nil.",
    );
    toast.info("Demo patient loaded — click Generate Report.");
  }

  async function openLearnDetail() {
    setLearnEntries(await listLearning(20));
  }

  async function doClearLearning() {
    if (!window.confirm("Clear all AI learning data? This cannot be undone.")) {
      return;
    }
    try {
      await clearLearning();
      toast.info("AI learning data cleared.");
      await refreshSidebars();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear.");
    }
  }

  const learnTotal = learnStats.corrections + learnStats.approvals;
  const radiologistPersona = persona === "radiologist";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[820px] space-y-3 p-4">
        {loadedCase ? (
          /* ---------- Sent-back correction mode ---------- */
          <div className={CARD}>
            <div className="mb-2 flex items-center justify-between">
              <div className={SECTION_LABEL + " mb-0"}>
                Correcting sent-back report
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={resetAll}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
            <div className="text-[15px] font-semibold">
              {loadedCase.patientName}
            </div>
            <div className="text-[11px] text-[#8591A8]">
              {scanTypeLabel(loadedCase.scanType)} · {loadedCase.age} ·{" "}
              {loadedCase.gender} · MR {loadedCase.mrNumber}
            </div>
            {loadedCase.comments && loadedCase.comments.length > 0 && (
              <div className="mt-3 rounded-[10px] border border-[#FCA5A5] bg-[#FEE2E2] p-3">
                <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#7F1D1D]">
                  Radiologist&apos;s notes
                </div>
                {loadedCase.comments.map((cm, i) => (
                  <p key={i} className="text-xs text-[#7F1D1D]">
                    {cm.text}
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Radiologist Direct banner */}
            {radiologistPersona && (
              <div className="rounded-[14px] bg-gradient-to-br from-[#1B5E8C] to-[#2878B5] p-4 text-white shadow-sm">
                <div className="text-[13px] font-semibold">
                  Radiologist Direct Mode
                </div>
                <div className="text-[11px] opacity-90">
                  Typist unavailable — dictate the findings yourself, generate
                  the report, and submit it straight to your own Review queue.
                </div>
              </div>
            )}

            {/* Sent-back worklist */}
            {sentBack.length > 0 && (
              <div className={CARD}>
                <div className={SECTION_LABEL}>
                  Sent back for correction ({sentBack.length})
                </div>
                <div className="space-y-1.5">
                  {sentBack.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => openSentBack(c)}
                      className="flex w-full items-center justify-between rounded-[10px] border border-border bg-[#FFF7F7] px-3 py-2 text-left hover:border-ring"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold">
                          {c.patientName}
                        </span>
                        <span className="block truncate text-[11px] text-[#8591A8]">
                          {scanTypeLabel(c.scanType)} · {formatTimestamp(c.updatedAt)}
                        </span>
                      </span>
                      <span className="ml-2 shrink-0 rounded-full border border-[#FCA5A5] bg-[#FEE2E2] px-2 py-0.5 text-[10px] font-semibold text-[#7F1D1D]">
                        Fix &amp; resubmit
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

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
                <Field label="Speciality">
                  <Input
                    value={speciality}
                    onChange={(e) => setSpeciality(e.target.value)}
                    placeholder="e.g. Gastroenterologist"
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
                <Field label="Reporting Radiologist">
                  <Select
                    value={reportingRadiologist}
                    onValueChange={setReportingRadiologist}
                    disabled={inputsLocked}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REPORTING_RADIOLOGISTS.map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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

              <div className="grid grid-cols-3 gap-2.5">
                <UploadButton
                  icon={<Camera className="h-6 w-6" />}
                  title="Camera"
                  hint="Take photo"
                  capture
                  disabled={inputsLocked}
                  onFiles={addFiles}
                />
                <UploadButton
                  icon={<ImagePlus className="h-6 w-6" />}
                  title="Gallery"
                  hint="From photos"
                  disabled={inputsLocked}
                  onFiles={addFiles}
                />
                <UploadButton
                  icon={<FileText className="h-6 w-6" />}
                  title="Files"
                  hint="Browse"
                  disabled={inputsLocked}
                  onFiles={addFiles}
                />
              </div>

              {previewUrls.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-3">
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
                </div>
              )}

              <div className="mt-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-[#8591A8]">
                    Or dictate / type raw readings
                  </div>
                  <DictateButton
                    label="Dictate Findings"
                    onAppend={(t) =>
                      setRadiologistNotes((prev) => (prev ? `${prev} ${t}` : t))
                    }
                  />
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
                  partially distended, mld = minimally distended, c = with, H
                  and b = head and body, OLPH = no other lesions
                </p>
              </div>
            </div>

            {/* AI Learning bar */}
            {learnTotal > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-border bg-secondary px-3.5 py-2.5 text-xs text-primary">
                <span>
                  {"\u{1F9E0}"} <b>AI Learning Active</b> —{" "}
                  {learnStats.corrections} corrections + {learnStats.approvals}{" "}
                  approvals learned
                </span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={openLearnDetail}>
                    View Details
                  </Button>
                  <Button variant="outline" size="sm" onClick={doClearLearning}>
                    Clear Learning
                  </Button>
                </span>
              </div>
            )}

            {/* Actions (before a draft exists) */}
            {!draftReport && (
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={loadDemo}
                  disabled={busy}
                  className="w-full sm:w-auto"
                >
                  Load Demo Patient
                </Button>
                <Button
                  onClick={runGenerate}
                  disabled={busy}
                  className="w-full sm:w-auto"
                >
                  {phase === "uploading"
                    ? "Uploading photos…"
                    : phase === "generating"
                      ? "Generating…"
                      : "Generate Report with AI"}
                </Button>
              </div>
            )}
          </>
        )}

        {/* Generated / loaded report editor (shared by both modes) */}
        {draftReport && (
          <div className={CARD}>
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#8591A8]">
                  {loadedCase ? "Report (correcting)" : "Generated Report"}
                </span>
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                  AI · clinic format
                </span>
              </div>
              {!loadedCase && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRegenerate}
                  disabled={busy}
                >
                  {phase === "generating" ? "Regenerating…" : "Regenerate"}
                </Button>
              )}
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

            <div className="mt-2.5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {!loadedCase && (
                <Button
                  variant="outline"
                  onClick={handleDiscard}
                  disabled={busy}
                  className="w-full sm:w-auto"
                >
                  Discard
                </Button>
              )}
              <Button
                onClick={handleSubmit}
                disabled={busy}
                className="w-full sm:w-auto"
              >
                {phase === "submitting"
                  ? "Submitting…"
                  : loadedCase
                    ? "Resubmit to Radiologist"
                    : radiologistPersona
                      ? "Submit (review yourself)"
                      : "Submit for Radiologist Review"}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Learning details modal */}
      <Modal open={learnEntries !== null} onClose={() => setLearnEntries(null)}>
        <div className="mb-3 text-sm font-semibold">AI Learning Log</div>
        {learnEntries && learnEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No learning data yet.</p>
        ) : (
          <div className="space-y-1.5">
            {learnEntries?.map((e) => (
              <div
                key={e.id}
                className={
                  "rounded-[8px] p-2.5 text-[11px] " +
                  (e.kind === "approval"
                    ? "bg-[#D1FAE5] text-[#155E3A]"
                    : "bg-secondary text-foreground")
                }
              >
                <b>
                  {e.kind === "approval" ? "Approved" : "Correction"} ·{" "}
                  {scanTypeLabel(e.scanType)}
                </b>
                <div className="mt-0.5 line-clamp-2">
                  {e.kind === "approval"
                    ? (e.text ?? "").slice(0, 160)
                    : e.comment}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end border-t border-border pt-3">
          <Button variant="outline" onClick={() => setLearnEntries(null)}>
            Close
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** One of the three Camera / Gallery / Files upload tiles. */
function UploadButton({
  icon,
  title,
  hint,
  capture,
  disabled,
  onFiles,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  capture?: boolean;
  disabled?: boolean;
  onFiles: (files: FileList | null) => void;
}) {
  return (
    <label
      className={
        "flex cursor-pointer flex-col items-center gap-1 rounded-[10px] border border-border bg-card p-3 text-center transition-colors hover:border-ring hover:bg-secondary " +
        (disabled ? "pointer-events-none opacity-50" : "")
      }
    >
      <input
        type="file"
        accept="image/*"
        {...(capture ? { capture: "environment" as const } : {})}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <span className="text-primary">{icon}</span>
      <span className="text-xs font-semibold text-primary">{title}</span>
      <span className="text-[10px] text-[#8591A8]">{hint}</span>
    </label>
  );
}

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
