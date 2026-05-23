"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, X, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAuth } from "@/lib/auth-context";
import { createCase } from "@/lib/cases";
import { SCAN_TYPES } from "@/lib/scan-types";
import { todayInputDate, inputDateToDDMMYYYY } from "@/lib/format";
import type { Gender } from "@/lib/types";

const MAX_PHOTOS = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_MIME = /^image\/(jpeg|jpg|png|webp|gif)$/i;

/** sessionStorage key for in-progress form state.
 *
 *  Why this exists: on Android Chrome, launching the camera via
 *  `<input capture="environment">` puts the browser process in the background.
 *  On low-memory devices the tab gets killed, and when the user returns from
 *  the camera the page is reloaded — React state vanishes and the form looks
 *  blank. Persisting the text fields to sessionStorage and restoring on mount
 *  fixes "I filled the form, opened the camera, and lost everything."
 *
 *  Photos themselves can't easily survive a reload (File objects don't
 *  serialize and base64 versions blow past sessionStorage's ~5 MB ceiling on
 *  mobile), so the photo array stays ephemeral. In practice that's fine — the
 *  user just took the photo, so re-taking is one tap. */
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

export default function CapturePage() {
  const router = useRouter();
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
  const [phase, setPhase] = useState<"idle" | "uploading" | "generating">(
    "idle",
  );
  // Don't write to sessionStorage until the restore-from-storage effect has
  // run; otherwise the first render persists the empty initial state and
  // wipes the saved draft.
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
        const saved = JSON.parse(raw) as Partial<DraftFields>;
        if (saved.patientName) setPatientName(saved.patientName);
        if (saved.age) setAge(saved.age);
        if (saved.gender) setGender(saved.gender);
        if (saved.mrNumber) setMrNumber(saved.mrNumber);
        if (saved.date) setDate(saved.date);
        if (saved.refDoctor) setRefDoctor(saved.refDoctor);
        if (saved.scanType) setScanType(saved.scanType);
        if (saved.radiologistNotes) setRadiologistNotes(saved.radiologistNotes);
      }
    } catch {
      /* malformed JSON — ignore */
    }
    setHydrated(true);
  }, []);

  // Persist text-field state on every change. Photos are NOT persisted (see
  // note on DRAFT_KEY); on mobile, if the page reloads after the camera
  // intent, the user re-taps "Add photo" — text fields are already restored.
  useEffect(() => {
    if (!hydrated) return;
    if (typeof window === "undefined") return;
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
      /* quota exceeded etc. — non-fatal */
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

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) {
      toast.error("Not signed in.");
      return;
    }
    if (
      !patientName.trim() ||
      !age.trim() ||
      !gender ||
      !mrNumber.trim() ||
      !scanType
    ) {
      toast.error("Please fill in all required fields.");
      return;
    }
    if (!radiologistNotes.trim() && photos.length === 0) {
      toast.error(
        "Add typed notes OR upload at least one photo of handwritten notes.",
      );
      return;
    }

    setPhase("uploading");
    let caseId: string;
    try {
      caseId = await createCase(
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create case.");
      setPhase("idle");
      return;
    }

    // Form successfully submitted — clear the saved draft so the next visit
    // starts fresh.
    clearDraft();

    setPhase("generating");
    try {
      const token = await user.getIdToken();
      const resp = await fetch(`/api/generate/${caseId}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `AI generation failed (${resp.status})`);
      }
      toast.success("Draft ready — opening for review.");
      router.push(`/review/${caseId}`);
    } catch (err) {
      // Case exists in Firestore even if AI failed. Send the user to /review
      // anyway so they can retry generation.
      toast.error(
        err instanceof Error
          ? err.message
          : "AI generation failed — opening case to retry.",
      );
      router.push(`/review/${caseId}`);
    } finally {
      setPhase("idle");
    }
  }

  const submitting = phase !== "idle";
  const submitLabel =
    phase === "uploading"
      ? "Uploading photos…"
      : phase === "generating"
        ? "AI drafting report…"
        : "Capture & Send to Review";

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Case</CardTitle>
        <CardDescription>
          Fill in patient details, pick the scan type, and snap a photo of the
          handwritten findings. Claude reads the photo and drafts the report —
          you review it next.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="patientName">
                Patient Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="patientName"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="Full name"
                disabled={submitting}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="age">
                Age <span className="text-red-500">*</span>
              </Label>
              <Input
                id="age"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="e.g. 32 yrs or 6 months"
                disabled={submitting}
              />
            </div>

            <div className="space-y-1">
              <Label>
                Gender <span className="text-red-500">*</span>
              </Label>
              <RadioGroup
                value={gender}
                onValueChange={(v) => setGender(v as Gender)}
                className="flex gap-6"
                disabled={submitting}
              >
                {(["Male", "Female"] as Gender[]).map((g) => (
                  <div key={g} className="flex items-center gap-2">
                    <RadioGroupItem id={`gender-${g}`} value={g} />
                    <Label htmlFor={`gender-${g}`}>{g}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div className="space-y-1">
              <Label htmlFor="mrNumber">
                MR Number <span className="text-red-500">*</span>
              </Label>
              <Input
                id="mrNumber"
                value={mrNumber}
                onChange={(e) => setMrNumber(e.target.value)}
                placeholder="e.g. MR-00123"
                disabled={submitting}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="dateOfExam">
                Date of Examination <span className="text-red-500">*</span>
              </Label>
              <Input
                id="dateOfExam"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="refDoctor">Referring Doctor</Label>
              <Input
                id="refDoctor"
                value={refDoctor}
                onChange={(e) => setRefDoctor(e.target.value)}
                placeholder="Dr. Name"
                disabled={submitting}
              />
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="scanType">
                Scan Type <span className="text-red-500">*</span>
              </Label>
              <Select
                value={scanType}
                onValueChange={setScanType}
                disabled={submitting}
              >
                <SelectTrigger id="scanType">
                  <SelectValue placeholder="Select scan type" />
                </SelectTrigger>
                <SelectContent>
                  {SCAN_TYPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="notesPhotos">
                Photos of Handwritten Notes{" "}
                <span className="text-muted-foreground text-xs">
                  (up to {MAX_PHOTOS}, JPEG / PNG / WebP, ≤ 5 MB each)
                </span>
              </Label>

              <div className="flex flex-wrap items-start gap-3">
                {previewUrls.map((url, i) => (
                  <div
                    key={url}
                    className="relative h-24 w-24 rounded-md border border-input overflow-hidden bg-muted"
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
                      disabled={submitting}
                      className="absolute top-1 right-1 rounded-full bg-background/80 hover:bg-background p-0.5 text-foreground shadow disabled:opacity-50"
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
                    disabled={submitting}
                    className="h-24 w-24 rounded-md border-2 border-dashed border-input bg-muted/40 hover:bg-muted text-muted-foreground flex flex-col items-center justify-center gap-1 text-xs disabled:opacity-50"
                    aria-label="Add a photo"
                  >
                    <ImagePlus className="h-5 w-5" />
                    <span>Add photo</span>
                  </button>
                )}
              </div>

              <input
                ref={fileInputRef}
                id="notesPhotos"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                capture="environment"
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
                disabled={submitting}
              />

              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Camera className="h-3 w-3" />
                On mobile, this opens the camera. Snap the radiologist&apos;s
                handwritten findings — Claude reads them.
              </p>
            </div>

            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="radiologistNotes">
                Typed Shorthand Notes{" "}
                <span className="text-muted-foreground text-xs">
                  (optional if photo uploaded)
                </span>
              </Label>
              <Textarea
                id="radiologistNotes"
                value={radiologistNotes}
                onChange={(e) => setRadiologistNotes(e.target.value)}
                rows={6}
                className="font-mono"
                placeholder="e.g. RT lobe 2.5x1.2x1.2, hyperechoic nodule 7x7mm TIRADS-III follow up"
                disabled={submitting}
              />
            </div>

            <div className="sm:col-span-2 flex items-center justify-end gap-3">
              {submitting && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              <Button type="submit" disabled={submitting || !user}>
                {submitLabel}
              </Button>
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
