import {
  addDoc,
  collection,
  getDocs,
  limit as fbLimit,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";

/**
 * AI Learning store (client SDK). Captures typist edits, radiologist
 * corrections, and approved reports in a shared `learning` collection so they
 * can be fed back into future generation/revise prompts (server-side read in
 * lib/learning-server.ts). All writes are best-effort — learning must never
 * block the clinical workflow.
 */
const LEARNING = "learning";

export interface CorrectionInput {
  scanType: string;
  aiText: string;
  correctedText: string;
  comment: string;
  byRole: "typist" | "radiologist";
}

export async function recordCorrection(input: CorrectionInput): Promise<void> {
  try {
    await addDoc(collection(db, LEARNING), {
      kind: "correction",
      ...input,
      createdAt: serverTimestamp(),
    });
  } catch {
    /* best-effort */
  }
}

export async function recordApproval(input: {
  scanType: string;
  text: string;
}): Promise<void> {
  try {
    await addDoc(collection(db, LEARNING), {
      kind: "approval",
      ...input,
      createdAt: serverTimestamp(),
    });
  } catch {
    /* best-effort */
  }
}

export interface LearningStats {
  corrections: number;
  approvals: number;
}

export async function getLearningStats(): Promise<LearningStats> {
  let corrections = 0;
  let approvals = 0;
  try {
    const snap = await getDocs(collection(db, LEARNING));
    snap.forEach((d) => {
      const kind = (d.data() as { kind?: string }).kind;
      if (kind === "correction") corrections++;
      else if (kind === "approval") approvals++;
    });
  } catch {
    /* ignore */
  }
  return { corrections, approvals };
}

export interface LearningEntry {
  id: string;
  kind: "correction" | "approval";
  scanType: string;
  comment?: string;
  byRole?: string;
  text?: string;
}

export async function listLearning(max = 20): Promise<LearningEntry[]> {
  try {
    const snap = await getDocs(
      query(collection(db, LEARNING), orderBy("createdAt", "desc"), fbLimit(max)),
    );
    return snap.docs.map(
      (d) => ({ id: d.id, ...(d.data() as Omit<LearningEntry, "id">) }),
    );
  } catch {
    return [];
  }
}

export async function clearLearning(): Promise<void> {
  const snap = await getDocs(collection(db, LEARNING));
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}
