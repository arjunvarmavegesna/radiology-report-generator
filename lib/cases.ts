import {
  addDoc,
  arrayUnion,
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
import { ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "./firebase";
import type { CaseComment, CaseDoc, NewCaseInput, ReportJSON } from "./types";

const CASES = "cases";

/** Sanitize a user-supplied filename for use in a Storage path. */
function safeName(name: string, fallback: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
  return cleaned.length > 0 ? cleaned : fallback;
}

async function uploadNotesImages(
  caseId: string,
  files: File[],
): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const filename = safeName(f.name, `photo-${i}.jpg`);
    const path = `cases/${caseId}/notes/${i}-${filename}`;
    await uploadBytes(storageRef(storage, path), f, {
      contentType: f.type || "image/jpeg",
    });
    paths.push(path);
  }
  return paths;
}

function tsMillis(t: Timestamp | null): number {
  return t ? t.toMillis() : 0;
}

function mapCase(id: string, data: Record<string, unknown>): CaseDoc {
  return { id, ...(data as Omit<CaseDoc, "id">) };
}

/** Radiologist creates a new case → enters the typist queue. Optionally
 *  uploads photos of handwritten notes to Storage and stores the paths on the
 *  case doc so the AI generate step can pull them as vision inputs. */
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
    speciality: input.speciality?.trim() ?? "",
    reportingRadiologist: input.reportingRadiologist?.trim() ?? "",

    radiologistId,
    radiologistNotes: input.radiologistNotes.trim(),
    notesImagePaths: [],

    status: "pending_typing",
    comments: [],

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

  const files = input.notesImages ?? [];
  if (files.length > 0) {
    const paths = await uploadNotesImages(ref.id, files);
    await updateDoc(doc(db, CASES, ref.id), {
      notesImagePaths: paths,
      updatedAt: serverTimestamp(),
    });
  }

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

/** Typist queue: cases awaiting typing, oldest first.
 *  Legacy — kept for back-compat with any in-flight cases stuck at
 *  "pending_typing" because their AI draft failed. The new workflow advances
 *  to pending_review as soon as /api/generate succeeds. */
export async function getTypingQueue(): Promise<CaseDoc[]> {
  const snap = await getDocs(
    query(collection(db, CASES), where("status", "==", "pending_typing")),
  );
  return snap.docs
    .map((d) => mapCase(d.id, d.data()))
    .sort((a, b) => tsMillis(a.createdAt) - tsMillis(b.createdAt));
}

/** Review list: cases with an AI draft awaiting human approval. Oldest first
 *  so the user works through them FIFO. */
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

/** Typist worklist: cases the radiologist sent back for correction, oldest
 *  first so the typist clears the backlog FIFO. */
export async function getSentBackQueue(): Promise<CaseDoc[]> {
  const snap = await getDocs(
    query(collection(db, CASES), where("status", "==", "sent_back")),
  );
  return snap.docs
    .map((d) => mapCase(d.id, d.data()))
    .sort((a, b) => tsMillis(a.updatedAt) - tsMillis(b.updatedAt));
}

/** Print queue: approved cases ready to download. Newest first so the most
 *  recently approved case is at the top. */
export async function getApprovedCases(): Promise<CaseDoc[]> {
  const snap = await getDocs(
    query(collection(db, CASES), where("status", "==", "approved")),
  );
  return snap.docs
    .map((d) => mapCase(d.id, d.data()))
    .sort(
      (a, b) =>
        tsMillis(b.reviewerApprovedAt) - tsMillis(a.reviewerApprovedAt),
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

/** Append a comment to a case's review thread (no status change). */
export async function addComment(
  caseId: string,
  comment: CaseComment,
): Promise<void> {
  await updateDoc(doc(db, CASES, caseId), {
    comments: arrayUnion(comment),
    updatedAt: serverTimestamp(),
  });
}

/** Reviewer: send a case back to the typist for correction, with a comment.
 *  Moves it out of the review queue into the typist's sent-back worklist. */
export async function sendBackToTypist(
  caseId: string,
  comment: CaseComment,
  reviewerId: string,
): Promise<void> {
  await updateDoc(doc(db, CASES, caseId), {
    status: "sent_back",
    comments: arrayUnion(comment),
    reviewerId,
    updatedAt: serverTimestamp(),
  });
}

/** Print staff: mark an approved case as printed. Additive — does not change
 *  status (the case stays `approved`); just stamps `printedAt` so the Print
 *  Queue can show a Printed chip and filter on it. */
export async function markPrinted(caseId: string): Promise<void> {
  await updateDoc(doc(db, CASES, caseId), {
    printedAt: serverTimestamp(),
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
