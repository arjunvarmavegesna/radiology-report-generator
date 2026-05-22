import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { extractDocxText } from "./extract-docx-text";

/**
 * Map each scan_type to the `Approved  data/` folders + filename keywords that
 * identify matching example reports. Folders are intentionally written with
 * their actual on-disk names (including double spaces) so they match.
 *
 * Why alphabetical ordering, not "most recent": the brief says "5 most recent
 * from the same category folder" but mtime-based ordering rotates the top-5
 * on every new approval and invalidates the AI request's cached prefix. The
 * top-5 alphabetical set is stable for a scan type until source files are
 * renamed, so prompt caching actually works. Phase 3 swaps this for
 * embedding-based retrieval anyway.
 */
interface CorpusSource {
  folder: string;
  /** Case-insensitive substring filter on the filename. ANY match keeps the file. */
  filenameKeywords?: string[];
}

const SOURCES: Record<string, CorpusSource[]> = {
  abdomen_male: [{ folder: "Approved  data/Abdomens Male & female  & pelvis, KUB" }],
  abdomen_female: [{ folder: "Approved  data/Abdomens Male & female  & pelvis, KUB" }],
  pelvis: [{ folder: "Approved  data/Abdomens Male & female  & pelvis, KUB" }],

  thyroid_neck: [{ folder: "Approved  data/Thyroid neck" }],
  breast: [{ folder: "Approved  data/Breast" }],
  soft_parts: [{ folder: "Approved  data/soft parts" }],
  scrotum: [{ folder: "Approved  data/scrotum" }],

  fetal_echo: [
    { folder: "Approved  data/Fetal echo" },
    {
      folder: "Approved  data/NT , growth , TIFFA  , early pregnancy ,fetal echo",
      filenameKeywords: ["fetal echo"],
    },
  ],

  nt_scan: [
    {
      folder: "Approved  data/NT , growth , TIFFA  , early pregnancy ,fetal echo",
      filenameKeywords: ["NT scan", "NT"],
    },
  ],
  nt_twins: [
    {
      folder: "Approved  data/NT , growth , TIFFA  , early pregnancy ,fetal echo",
      filenameKeywords: ["NT", "twins"],
    },
  ],
  tiffa: [
    {
      folder: "Approved  data/NT , growth , TIFFA  , early pregnancy ,fetal echo",
      filenameKeywords: ["TIFFA"],
    },
  ],
  tiffa_twins: [
    {
      folder: "Approved  data/NT , growth , TIFFA  , early pregnancy ,fetal echo",
      filenameKeywords: ["TIFFA"],
    },
  ],
  growth: [
    {
      folder: "Approved  data/NT , growth , TIFFA  , early pregnancy ,fetal echo",
      filenameKeywords: ["Growth"],
    },
  ],
  growth_twins: [
    {
      folder: "Approved  data/NT , growth , TIFFA  , early pregnancy ,fetal echo",
      filenameKeywords: ["Growth", "twins"],
    },
  ],
  early_pregnancy: [
    {
      folder: "Approved  data/NT , growth , TIFFA  , early pregnancy ,fetal echo",
      filenameKeywords: ["Early pregnancy", "Early"],
    },
  ],
  early_pregnancy_no_fhr: [
    {
      folder: "Approved  data/NT , growth , TIFFA  , early pregnancy ,fetal echo",
      filenameKeywords: ["Early pregnancy", "Early"],
    },
  ],

  venous_doppler: [
    { folder: "Approved  data/dopplers", filenameKeywords: ["venous"] },
  ],
  venous_doppler_single: [
    { folder: "Approved  data/dopplers", filenameKeywords: ["venous"] },
  ],
  arteries_doppler: [
    { folder: "Approved  data/dopplers", filenameKeywords: ["arterial", "arteries"] },
  ],
  carotid_doppler: [
    { folder: "Approved  data/dopplers", filenameKeywords: ["carotid"] },
  ],
  renal_artery_doppler: [
    { folder: "Approved  data/dopplers", filenameKeywords: ["renal"] },
  ],
};

export interface ReferenceReport {
  filename: string;
  text: string;
}

export function getReferenceReports(
  scanType: string,
  limit = 5,
): ReferenceReport[] {
  const sources = SOURCES[scanType] ?? [];
  const seen = new Set<string>();
  const candidates: { path: string; filename: string }[] = [];

  for (const source of sources) {
    const dirPath = resolve(process.cwd(), source.folder);
    if (!existsSync(dirPath)) continue;
    let files: string[];
    try {
      files = readdirSync(dirPath);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.toLowerCase().endsWith(".docx")) continue;
      if (f.startsWith("~$")) continue; // Word lock files
      if (source.filenameKeywords) {
        const lower = f.toLowerCase();
        if (
          !source.filenameKeywords.some((kw) => lower.includes(kw.toLowerCase()))
        ) {
          continue;
        }
      }
      const full = join(dirPath, f);
      if (seen.has(full)) continue;
      seen.add(full);
      candidates.push({ path: full, filename: f });
    }
  }

  // Alphabetical (deterministic) — see file-level comment for the caching rationale.
  candidates.sort((a, b) => a.filename.localeCompare(b.filename));

  const top = candidates.slice(0, limit);
  return top.map((c) => {
    try {
      return { filename: c.filename, text: extractDocxText(c.path) };
    } catch (err) {
      // One bad reference shouldn't sink the whole generation — return a stub.
      const msg = err instanceof Error ? err.message : "unknown";
      return {
        filename: c.filename,
        text: `[Reference unreadable: ${msg}]`,
      };
    }
  });
}
