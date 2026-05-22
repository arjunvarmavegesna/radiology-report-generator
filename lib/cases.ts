import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import type { CaseDoc, NewCaseInput, ReportJSON } from "./types";

const CASES = "cases";

function tsMillis(t: Timestamp | null): number {
  return t ? t.toMillis() : 0;
}

function mapCase(id: string, data: Record<string, unknown>): CaseDoc {
  return { id, ...(data as Omit<CaseDoc, "id">) };
}

/** Radiologist creates a new case → enters the typist queue. */
export async function createCase(
  input: NewCaseInput,
  radiologistId: string,
): Promise<string> {
  const ref = await addDoc(collection(db, CASES), {
    patientName: input.patientName.trim(),
    age: input.age.trim(),
    gender: input.gender,
    mrNumber: input.mrNumber.trim(),
    dateOfExam: input.dateOfExam,
    refDoctor: input.refDoctor.trim(),
    scanType: input.scanType,

    radiologistId,
    radiologistNotes: input.radiologistNotes.trim(),

    status: "pending_typing",

    draftReport: null,
    editedReport: null,
    finalReport: null,

    typistId: null,
    typistSubmittedAt: null,
    reviewerId: null,
    reviewerApprovedAt: null,

    finalDocxPath: null,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Cases created by a given radiologist, newest first. */
export async function getCasesByRadiologist(
  radiologistId: string,
): Promise<CaseDoc[]> {
  const snap = await getDocs(
    query(collection(db, CASES), where("radiologistId", "==", radiologistId)),
  );
  return snap.docs
    .map((d) => mapCase(d.id, d.data()))
    .sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
}

/** Typist queue: cases awaiting typing, oldest first. */
export async function getTypingQueue(): Promise<CaseDoc[]> {
  const snap = await getDocs(
    query(collection(db, CASES), where("status", "==", "pending_typing")),
  );
  return snap.docs
    .map((d) => mapCase(d.id, d.data()))
    .sort((a, b) => tsMillis(a.createdAt) - tsMillis(b.createdAt));
}

/** Reviewer queue: cases awaiting review, oldest first. */
export async function getReviewQueue(): Promise<CaseDoc[]> {
  const snap = await getDocs(
    query(collection(db, CASES), where("status", "==", "pending_review")),
  );
  return snap.docs
    .map((d) => mapCase(d.id, d.data()))
    .sort(
      (a, b) =>
        tsMillis(a.typistSubmittedAt) - tsMillis(b.typistSubmittedAt),
    );
}

export async function getCase(id: string): Promise<CaseDoc | null> {
  const snap = await getDoc(doc(db, CASES, id));
  return snap.exists() ? mapCase(snap.id, snap.data()) : null;
}

/** Typist: save in-progress edits without changing status. */
export async function saveTypistDraft(
  caseId: string,
  report: ReportJSON,
  typistId: string,
): Promise<void> {
  await updateDoc(doc(db, CASES, caseId), {
    editedReport: report,
    typistId,
    updatedAt: serverTimestamp(),
  });
}

/** Typist: hand off to the reviewer. */
export async function submitToReviewer(
  caseId: string,
  report: ReportJSON,
  typistId: string,
): Promise<void> {
  await updateDoc(doc(db, CASES, caseId), {
    editedReport: report,
    typistId,
    status: "pending_review",
    typistSubmittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Reviewer: save in-progress edits without changing status. */
export async function saveReviewerDraft(
  caseId: string,
  report: ReportJSON,
  reviewerId: string,
): Promise<void> {
  await updateDoc(doc(db, CASES, caseId), {
    finalReport: report,
    reviewerId,
    updatedAt: serverTimestamp(),
  });
}

/** Reviewer: final approval. DOCX export will follow in the next milestone. */
export async function approveCase(
  caseId: string,
  report: ReportJSON,
  reviewerId: string,
): Promise<void> {
  await updateDoc(doc(db, CASES, caseId), {
    finalReport: report,
    reviewerId,
    status: "approved",
    reviewerApprovedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
