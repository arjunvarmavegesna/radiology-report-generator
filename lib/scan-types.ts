/**
 * Canonical scan-type values. These exact strings are stored in
 * `cases.scanType` and map to the tagged DOCX templates.
 */
export interface ScanTypeOption {
  value: string;
  label: string;
  /** OB scans carry the mandatory PC & PNDT Act compliance statement. */
  isObstetric: boolean;
}

export const SCAN_TYPES: ScanTypeOption[] = [
  { value: "abdomen_male", label: "Whole Abdomen (Male)", isObstetric: false },
  { value: "abdomen_female", label: "Whole Abdomen (Female)", isObstetric: false },
  { value: "thyroid_neck", label: "Thyroid / Neck", isObstetric: false },
  { value: "breast", label: "Breast Scan", isObstetric: false },
  { value: "nt_scan", label: "NT Scan", isObstetric: true },
  { value: "nt_twins", label: "NT Scan (Twins)", isObstetric: true },
  { value: "tiffa", label: "TIFFA (Anomaly Scan)", isObstetric: true },
  { value: "tiffa_twins", label: "TIFFA (Twins)", isObstetric: true },
  { value: "growth", label: "Growth Scan", isObstetric: true },
  { value: "growth_twins", label: "Growth Scan (Twins)", isObstetric: true },
  { value: "early_pregnancy", label: "Early Pregnancy", isObstetric: true },
  { value: "early_pregnancy_no_fhr", label: "Early Pregnancy (No FHR)", isObstetric: true },
  { value: "fetal_echo", label: "Fetal Echo", isObstetric: true },
  { value: "venous_doppler", label: "Venous Doppler", isObstetric: false },
  { value: "venous_doppler_single", label: "Venous Doppler (Single Limb)", isObstetric: false },
  { value: "arteries_doppler", label: "Arteries Doppler", isObstetric: false },
  { value: "carotid_doppler", label: "Carotid Doppler", isObstetric: false },
  { value: "renal_artery_doppler", label: "Renal Artery Doppler", isObstetric: false },
  { value: "soft_parts", label: "Soft Parts", isObstetric: false },
  { value: "scrotum", label: "Scrotum", isObstetric: false },
  { value: "pelvis", label: "Pelvis", isObstetric: false },
];

export const SCAN_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  SCAN_TYPES.map((s) => [s.value, s.label]),
);

export function scanTypeLabel(value: string): string {
  return SCAN_TYPE_LABELS[value] ?? value;
}
