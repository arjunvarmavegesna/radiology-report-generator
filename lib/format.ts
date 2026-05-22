import type { Timestamp } from "firebase/firestore";
import type { CaseStatus } from "./types";

/** yyyy-mm-dd, for an <input type="date"> default value. */
export function todayInputDate(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Convert an <input type="date"> value (yyyy-mm-dd) to clinic format dd/mm/yyyy. */
export function inputDateToDDMMYYYY(value: string): string {
  if (!value) return "";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

/** Human-friendly date-time from a Firestore Timestamp. */
export function formatTimestamp(ts: Timestamp | null | undefined): string {
  if (!ts) return "—";
  try {
    return ts.toDate().toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** Badge label + tailwind classes for each case status. */
export const STATUS_META: Record<CaseStatus, { label: string; className: string }> = {
  pending_typing: {
    label: "Pending typing",
    className: "bg-amber-100 text-amber-800 hover:bg-amber-100",
  },
  pending_review: {
    label: "Pending review",
    className: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  },
  approved: {
    label: "Approved",
    className: "bg-green-100 text-green-800 hover:bg-green-100",
  },
};
