"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

export function NewCaseForm() {
  const { user } = useAuth();

  const [patientName, setPatientName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender>("Male");
  const [mrNumber, setMrNumber] = useState("");
  const [date, setDate] = useState(todayInputDate());
  const [refDoctor, setRefDoctor] = useState("");
  const [scanType, setScanType] = useState("");
  const [radiologistNotes, setRadiologistNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      !scanType ||
      !radiologistNotes.trim()
    ) {
      toast.error("Please fill in all required fields.");
      return;
    }

    setSubmitting(true);
    try {
      await createCase(
        {
          patientName,
          age,
          gender,
          mrNumber,
          dateOfExam: inputDateToDDMMYYYY(date),
          refDoctor,
          scanType,
          radiologistNotes,
        },
        user.uid,
      );
      toast.success("Case created and sent to the typist queue.");
      setPatientName("");
      setAge("");
      setGender("Male");
      setMrNumber("");
      setDate(todayInputDate());
      setRefDoctor("");
      setScanType("");
      setRadiologistNotes("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create case.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid sm:grid-cols-2 gap-4">
        {/* Patient Name */}
        <div className="space-y-1">
          <Label htmlFor="patientName">
            Patient Name <span className="text-red-500">*</span>
          </Label>
          <Input
            id="patientName"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="Full name"
          />
        </div>

        {/* Age */}
        <div className="space-y-1">
          <Label htmlFor="age">
            Age <span className="text-red-500">*</span>
          </Label>
          <Input
            id="age"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            placeholder="e.g. 32 yrs or 6 months"
          />
        </div>

        {/* Gender */}
        <div className="space-y-1">
          <Label>
            Gender <span className="text-red-500">*</span>
          </Label>
          <RadioGroup
            value={gender}
            onValueChange={(v) => setGender(v as Gender)}
            className="flex gap-6"
          >
            {(["Male", "Female"] as Gender[]).map((g) => (
              <div key={g} className="flex items-center gap-2">
                <RadioGroupItem id={`gender-${g}`} value={g} />
                <Label htmlFor={`gender-${g}`}>{g}</Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* MR Number */}
        <div className="space-y-1">
          <Label htmlFor="mrNumber">
            MR Number <span className="text-red-500">*</span>
          </Label>
          <Input
            id="mrNumber"
            value={mrNumber}
            onChange={(e) => setMrNumber(e.target.value)}
            placeholder="e.g. MR-00123"
          />
        </div>

        {/* Date of Examination */}
        <div className="space-y-1">
          <Label htmlFor="dateOfExam">
            Date of Examination <span className="text-red-500">*</span>
          </Label>
          <Input
            id="dateOfExam"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {/* Referring Doctor */}
        <div className="space-y-1">
          <Label htmlFor="refDoctor">Referring Doctor</Label>
          <Input
            id="refDoctor"
            value={refDoctor}
            onChange={(e) => setRefDoctor(e.target.value)}
            placeholder="Dr. Name"
          />
        </div>

        {/* Scan Type */}
        <div className="space-y-1">
          <Label htmlFor="scanType">
            Scan Type <span className="text-red-500">*</span>
          </Label>
          <Select value={scanType} onValueChange={setScanType}>
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

        {/* Radiologist Notes — full width */}
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="radiologistNotes">
            Radiologist&apos;s Shorthand Notes <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id="radiologistNotes"
            value={radiologistNotes}
            onChange={(e) => setRadiologistNotes(e.target.value)}
            rows={8}
            className="font-mono"
            placeholder="e.g. RT lobe 2.5x1.2x1.2, hyperechoic nodule 7x7mm TIRADS-III follow up"
          />
        </div>

        {/* Submit */}
        <div className="sm:col-span-2 flex justify-end">
          <Button type="submit" disabled={submitting || !user}>
            {submitting ? "Creating…" : "Create Case"}
          </Button>
        </div>
      </div>
    </form>
  );
}
