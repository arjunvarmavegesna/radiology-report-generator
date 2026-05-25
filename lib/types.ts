import type { Timestamp } from "firebase/firestore";

export type Role = "radiologist" | "typist" | "reviewer";

export type CaseStatus = "pending_typing" | "pending_review" | "approved";

export type Gender = "Male" | "Female";

/** Patient header that appears on every report. */
export interface PatientDetails {
  name: string;
  age: string;
  gender: Gender | string;
  mrNumber: string;
  date: string; // dd/mm/yyyy
  refDoctor: string;
}

/** Legacy structured-section shape. Older approved cases in Firestore still
 *  have this; new AI generations use the flat `body: string[]` instead.
 *  Kept on the interface for back-compat reading + on-the-fly flattening. */
export interface ReportSection {
  label: string;
  body: string;
}

/** The report shape the AI emits and humans edit. The primary editable area
 *  is `body` — an array where each string becomes one paragraph in the .docx.
 *  Findings AND IMPRESSION live in `body` so the review screen can edit
 *  everything as one continuous text. The legacy `sections` + `impression` +
 *  `verifyFlags` fields are optional for back-compat with older Firestore
 *  documents and are flattened into `body` when rendering. */
export interface ReportJSON {
  patientDetails: PatientDetails;
  scanTitle: string;
  body: string[];
  complianceText: string | null; // only OB scans

  // --- Legacy fields, optional ---
  sections?: ReportSection[];
  impression?: string[];
  verifyFlags?: string[];
}

/** A case document as stored in Firestore (`cases/{caseId}`). */
export interface CaseDoc {
  id?: string;

  patientName: string;
  age: string;
  gender: Gender;
  mrNumber: string;
  dateOfExam: string; // dd/mm/yyyy
  refDoctor: string;
  scanType: string; // one of SCAN_TYPES[].value

  radiologistId: string;
  radiologistNotes: string; // the shorthand
  /** Storage paths to uploaded photos of the radiologist's handwritten notes.
   *  AI generation will base64-encode each and include it as a vision input. */
  notesImagePaths?: string[];

  status: CaseStatus;

  draftReport: ReportJSON | null; // AI output
  editedReport: ReportJSON | null; // after typist edits
  finalReport: ReportJSON | null; // after reviewer edits

  typistId: string | null;
  typistSubmittedAt: Timestamp | null;
  reviewerId: string | null;
  reviewerApprovedAt: Timestamp | null;

  finalDocxPath: string | null;

  /** Set by the Print Queue when print staff mark an approved case as
   *  printed. Additive — the case stays `approved`; this just flips the
   *  Ready → Printed chip and feeds the queue filter. */
  printedAt?: Timestamp | null;

  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

/** Payload the radiologist's "new case" form submits. */
export interface NewCaseInput {
  patientName: string;
  age: string;
  gender: Gender;
  mrNumber: string;
  dateOfExam: string; // dd/mm/yyyy
  refDoctor: string;
  scanType: string;
  radiologistNotes: string;
  /** Optional photos of handwritten findings. Either notes text or at least
   *  one image must be present. */
  notesImages?: File[];
}

/** A user profile (`users/{uid}`). Role is mirrored into a custom claim. */
export interface UserDoc {
  name: string;
  email: string;
  role: Role;
  active: boolean;
}

/** Immutable audit trail entry. */
export interface AuditLogEntry {
  caseId: string;
  actor: string;
  action: string;
  before: unknown;
  after: unknown;
  timestamp: Timestamp | null;
}
