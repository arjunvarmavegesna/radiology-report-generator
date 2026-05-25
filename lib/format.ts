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

/** Clinic status-chip palette (from the Scanning.html reference). */
export const CHIP = {
  amber: "bg-[#FEF3C7] text-[#7C3E0B] border-[#FCD34D] hover:bg-[#FEF3C7]",
  green: "bg-[#D1FAE5] text-[#155E3A] border-[#6EE7B7] hover:bg-[#D1FAE5]",
  gray: "bg-[#EDF0F4] text-[#48516A] border-[#E0E4EC] hover:bg-[#EDF0F4]",
  blue: "bg-[#E8F2FA] text-[#1B5E8C] border-[#9CC3DE] hover:bg-[#E8F2FA]",
  red: "bg-[#FEE2E2] text-[#7F1D1D] border-[#FCA5A5] hover:bg-[#FEE2E2]",
} as const;

/** Badge label + tailwind classes for each case status. */
export const STATUS_META: Record<CaseStatus, { label: string; className: string }> = {
  pending_typing: {
    label: "Drafting",
    className: CHIP.gray,
  },
  pending_review: {
    label: "Pending Review",
    className: CHIP.amber,
  },
  sent_back: {
    label: "Sent back",
    className: CHIP.red,
  },
  approved: {
    label: "Approved",
    className: CHIP.green,
  },
};
