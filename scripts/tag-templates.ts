/**
 * Generalized tagger — produces docxtemplater-tagged copies of all 21 scan-type
 * source templates in `Templates/`, writing them to `data/templates-tagged/`.
 *
 * What this script does (in order):
 *   1. Moves two misplaced patient reports out of `Templates/` and into the
 *      appropriate `Approved  data/` category folders.
 *   2. Extracts the bilingual PC&PNDT compliance fragment from
 *      `Templates/growth template.docx` once, in memory.
 *   3. Iterates every entry in TEMPLATE_CONFIGS. For each: reads the source
 *      .docx, optionally splices the compliance fragment in (for the two
 *      early-pregnancy templates whose sources lack it), locates the
 *      "preserved tail" (signature for non-OB; compliance + signature for OB)
 *      by trying each anchor in order, captures the tail byte-for-byte, and
 *      prepends a freshly built body of placeholder paragraphs.
 *   4. For each written file, runs an inline render-test with dummy data
 *      (any docxtemplater error throws). For OB templates, additionally
 *      asserts that "Sex Determination" and "PNDT" survived in the output.
 *
 * Source `.docx` files in `Templates/` are NEVER modified on disk — the
 * compliance injection happens only in memory during tagging.
 *
 * Usage: npx tsx scripts/tag-templates.ts
 */
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

// ============================================================================
// Types & per-template configs
// ============================================================================

interface TemplateConfig {
  scanType: string;
  sourceFile: string;
  scanTitle: string;
  /** Methodology sentence printed under the title, or null to omit entirely. */
  methodology: string | null;
  /** Ordered list of contiguous XML substrings to try as the preserved-tail anchor. */
  preservedAnchors: string[];
  isObstetric: boolean;
  /** Inject the compliance fragment from growth before tagging (early-pregnancy). */
  prependComplianceFromGrowth?: boolean;
}

const NON_OB_ANCHORS = ["Dr.K", "K.ValliManasa"];
// For OB templates, prefer the start of the compliance block; fall back to
// signature anchors so a degraded template still tags (rather than throws).
const OB_ANCHORS = ["Sex Determination", "PC &amp; PNDT", "Dr.K", "K.ValliManasa"];

const OB_METHODOLOGY =
  "Real time B mode ultrasound examination of the gravid uterus revealed:";
const THYROID_METHODOLOGY =
  "High resolution ultrasound of the neck was done using a linear high frequency transducer.";

const TEMPLATE_CONFIGS: TemplateConfig[] = [
  // --- Non-OB (12) ---
  {
    scanType: "abdomen_male",
    sourceFile: "Templates/abdomen male format.docx",
    scanTitle: "ULTRASOUND WHOLE ABDOMEN",
    methodology: null,
    preservedAnchors: NON_OB_ANCHORS,
    isObstetric: false,
  },
  {
    scanType: "abdomen_female",
    sourceFile: "Templates/empty abdomen report female.docx",
    scanTitle: "ULTRASOUND WHOLE ABDOMEN",
    methodology: null,
    preservedAnchors: NON_OB_ANCHORS,
    isObstetric: false,
  },
  {
    scanType: "thyroid_neck",
    sourceFile: "Templates/Ultra sound thyroid neck.docx",
    scanTitle: "ULTRASOUND NECK",
    methodology: THYROID_METHODOLOGY,
    // Thyroid template uses "Dr. K" (with space) — list it first; fall back to non-OB anchors.
    preservedAnchors: ["Dr. K", ...NON_OB_ANCHORS],
    isObstetric: false,
  },
  {
    scanType: "breast",
    sourceFile: "Templates/Breast scan template.docx",
    scanTitle: "ULTRASOUND BOTH BREASTS",
    methodology: null,
    preservedAnchors: NON_OB_ANCHORS,
    isObstetric: false,
  },
  {
    scanType: "venous_doppler",
    sourceFile: "Templates/Venous doppler template.docx",
    scanTitle:
      "ULTRASOUND DOPPLER STUDY – BILATERAL LOWER LIMB VENOUS DOPPLER",
    methodology: null,
    preservedAnchors: NON_OB_ANCHORS,
    isObstetric: false,
  },
  {
    scanType: "venous_doppler_single",
    sourceFile: "Templates/single limb venous doppler.docx",
    scanTitle: "ULTRASOUND DOPPLER STUDY – LOWER LIMB VENOUS DOPPLER",
    methodology: null,
    preservedAnchors: NON_OB_ANCHORS,
    isObstetric: false,
  },
  {
    scanType: "arteries_doppler",
    sourceFile: "Templates/Arteries doppler Template.docx",
    scanTitle: "ULTRASOUND DOPPLER STUDY – BILATERAL LOWER LIMB ARTERIES",
    methodology: null,
    preservedAnchors: NON_OB_ANCHORS,
    isObstetric: false,
  },
  {
    scanType: "carotid_doppler",
    sourceFile: "Templates/carotid doppler Template.docx",
    scanTitle: "ULTRASOUND REPORT CAROTID DOPPLER",
    methodology: null,
    preservedAnchors: NON_OB_ANCHORS,
    isObstetric: false,
  },
  {
    scanType: "renal_artery_doppler",
    sourceFile: "Templates/Renal artery doppler template.docx",
    scanTitle: "RENAL ARTERY DOPPLER",
    methodology: null,
    preservedAnchors: NON_OB_ANCHORS,
    isObstetric: false,
  },
  {
    scanType: "soft_parts",
    sourceFile: "Templates/soft parts.docx",
    scanTitle: "ULTRASOUND SOFT PARTS",
    methodology: null,
    preservedAnchors: NON_OB_ANCHORS,
    isObstetric: false,
  },
  {
    scanType: "scrotum",
    sourceFile: "Templates/Scrotum template.docx",
    scanTitle: "USG SCROTUM",
    methodology: null,
    preservedAnchors: ["Dr. K", ...NON_OB_ANCHORS],
    isObstetric: false,
  },
  {
    scanType: "pelvis",
    sourceFile: "Templates/Ultra sound pelvis template.docx",
    scanTitle: "ULTRASOUND PELVIS",
    methodology: null,
    preservedAnchors: NON_OB_ANCHORS,
    isObstetric: false,
  },

  // --- OB with compliance in source (7) ---
  {
    scanType: "nt_scan",
    sourceFile: "Templates/nt scan template.docx",
    scanTitle: "ULTRASONOGRAPHY – NT SCAN",
    methodology: OB_METHODOLOGY,
    preservedAnchors: OB_ANCHORS,
    isObstetric: true,
  },
  {
    scanType: "nt_twins",
    sourceFile: "Templates/NT Twins template.docx",
    scanTitle: "ULTRASONOGRAPHY – NT SCAN (TWINS)",
    methodology: OB_METHODOLOGY,
    preservedAnchors: OB_ANCHORS,
    isObstetric: true,
  },
  {
    scanType: "tiffa",
    sourceFile: "Templates/TIFFA TEMPLATE.docx",
    scanTitle: "TIFFA",
    methodology: OB_METHODOLOGY,
    preservedAnchors: OB_ANCHORS,
    isObstetric: true,
  },
  {
    scanType: "tiffa_twins",
    sourceFile: "Templates/Twins TIFFA.docx",
    scanTitle: "TIFFA (TWINS)",
    methodology: OB_METHODOLOGY,
    preservedAnchors: OB_ANCHORS,
    isObstetric: true,
  },
  {
    scanType: "growth",
    sourceFile: "Templates/growth template.docx",
    scanTitle: "ULTRASONOGRAPHY – OBSTETRICS GROWTH",
    methodology: OB_METHODOLOGY,
    preservedAnchors: OB_ANCHORS,
    isObstetric: true,
  },
  {
    scanType: "growth_twins",
    sourceFile: "Templates/twins growth.docx",
    scanTitle: "ULTRASONOGRAPHY – GROWTH SCAN (TWINS)",
    methodology: OB_METHODOLOGY,
    preservedAnchors: OB_ANCHORS,
    isObstetric: true,
  },
  {
    scanType: "fetal_echo",
    sourceFile: "Templates/Fetal echo template.docx",
    scanTitle: "OBSTETRIC ULTRASONOGRAPHY FETAL ECHO",
    methodology: null,
    preservedAnchors: OB_ANCHORS,
    isObstetric: true,
  },

  // --- OB without compliance in source (2) — compliance injected from growth ---
  {
    scanType: "early_pregnancy",
    sourceFile: "Templates/Early pregnancy template.docx",
    scanTitle: "ULTRASOUND - EARLY PREGNANCY",
    methodology: null,
    preservedAnchors: OB_ANCHORS,
    isObstetric: true,
    prependComplianceFromGrowth: true,
  },
  {
    scanType: "early_pregnancy_no_fhr",
    sourceFile: "Templates/Early pregnancy no FHR.docx",
    scanTitle: "ULTRASOUND - EARLY PREGNANCY (No FHR)",
    methodology: null,
    preservedAnchors: OB_ANCHORS,
    isObstetric: true,
    prependComplianceFromGrowth: true,
  },
];

const OUT_DIR = "data/templates-tagged";
const GROWTH_TEMPLATE = "Templates/growth template.docx";

// ============================================================================
// XML emit helpers (lifted from the original scripts/tag-thyroid.ts)
// ============================================================================

const FONT = `<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>`;
const SZ = `<w:sz w:val="24"/><w:szCs w:val="24"/>`;
const rprBold = `<w:rPr>${FONT}<w:b/>${SZ}</w:rPr>`;
const rprNormal = `<w:rPr>${FONT}${SZ}</w:rPr>`;
const rprBoldUnderline = `<w:rPr>${FONT}<w:b/>${SZ}<w:u w:val="single"/></w:rPr>`;

const pprBody = `<w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr>`;
const pprHeader = `<w:pPr><w:pStyle w:val="NoSpacing"/><w:spacing w:line="360" w:lineRule="auto"/></w:pPr>`;
const pprCenter = `<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>`;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function pBoldHeader(t: string): string {
  return `<w:p>${pprHeader}<w:r>${rprBold}<w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r></w:p>`;
}
function pBold(t: string): string {
  return `<w:p>${pprBody}<w:r>${rprBold}<w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r></w:p>`;
}
function pNormal(t: string): string {
  return `<w:p>${pprBody}<w:r>${rprNormal}<w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r></w:p>`;
}
function pTitle(t: string): string {
  return `<w:p>${pprCenter}<w:r>${rprBoldUnderline}<w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r></w:p>`;
}
function pEmpty(): string {
  return `<w:p>${pprBody}</w:p>`;
}

// ============================================================================
// File moves
// ============================================================================

function safeMove(from: string, to: string): void {
  if (!existsSync(from)) {
    console.log(`  [skip] source missing (already moved?): ${from}`);
    return;
  }
  const toDir = dirname(to);
  if (!existsSync(toDir)) {
    console.log(`  [skip] destination dir missing: ${toDir}`);
    return;
  }
  if (existsSync(to)) {
    console.log(`  [skip] destination already exists: ${to}`);
    return;
  }
  try {
    renameSync(from, to);
  } catch {
    // Cross-volume fallback
    copyFileSync(from, to);
    unlinkSync(from);
  }
  console.log(`  moved: ${from}  ->  ${to}`);
}

function moveMisplacedTemplates(): void {
  console.log("--- Moving misplaced patient reports out of Templates/ ---");
  safeMove(
    "Templates/M. Nagadurga  NT scan.docx",
    "Approved  data/NT , growth , TIFFA  , early pregnancy ,fetal echo/M. Nagadurga NT scan.docx",
  );
  safeMove(
    "Templates/Ultrasound neck.docx",
    "Approved  data/Thyroid neck/Ultrasound neck (ENT referral).docx",
  );
}

// ============================================================================
// XML location helpers
// ============================================================================

function findFirstAnchor(
  xml: string,
  anchors: string[],
): { idx: number; needle: string } | null {
  for (const needle of anchors) {
    const idx = xml.indexOf(needle);
    if (idx >= 0) return { idx, needle };
  }
  return null;
}

/**
 * Walk back from `anchorIdx` and return the start position of the enclosing
 * `<w:p` or `<w:tbl` element — whichever is closer to the anchor and still
 * inside the body region. Returns -1 if neither is found.
 */
function findEnclosingBlockStart(
  xml: string,
  anchorIdx: number,
  bodyOpenEnd: number,
): number {
  const candidates = [
    xml.lastIndexOf("<w:p ", anchorIdx),
    xml.lastIndexOf("<w:p>", anchorIdx),
    xml.lastIndexOf("<w:tbl ", anchorIdx),
    xml.lastIndexOf("<w:tbl>", anchorIdx),
  ].filter((i) => i >= bodyOpenEnd);
  if (candidates.length === 0) return -1;
  return Math.max(...candidates);
}

function getDocumentXml(file: string): { zip: PizZip; xml: string } {
  const zip = new PizZip(readFileSync(file));
  const f = zip.file("word/document.xml");
  if (!f) throw new Error(`word/document.xml not found in ${file}`);
  return { zip, xml: f.asText() };
}

// ============================================================================
// Compliance fragment extraction (one-shot from growth template)
// ============================================================================

/**
 * Reads the growth template and captures the XML between the "Sex Determination"
 * paragraph and the signature paragraph — i.e., the bilingual PC&PNDT compliance
 * block (plus any "I have not disclosed…" footer). The captured XML is later
 * spliced into the early-pregnancy templates just before their signature.
 */
function extractComplianceFragment(growthFile: string): string {
  const { xml } = getDocumentXml(growthFile);
  const bodyOpenEnd = xml.indexOf("<w:body>") + "<w:body>".length;

  const startMatch = findFirstAnchor(xml, [
    "Sex Determination",
    "PC &amp; PNDT",
  ]);
  if (!startMatch) {
    throw new Error(`Could not find compliance start in ${growthFile}`);
  }
  const fragStart = findEnclosingBlockStart(
    xml,
    startMatch.idx,
    bodyOpenEnd,
  );
  if (fragStart < 0) {
    throw new Error(
      `Could not locate enclosing paragraph for compliance start in ${growthFile}`,
    );
  }

  // Find the signature that follows the compliance block.
  const sigSearchFrom = startMatch.idx + startMatch.needle.length;
  let sigIdx = xml.indexOf("Dr.K", sigSearchFrom);
  if (sigIdx < 0) sigIdx = xml.indexOf("K.ValliManasa", sigSearchFrom);
  if (sigIdx < 0) {
    throw new Error(
      `Could not find signature after compliance in ${growthFile}`,
    );
  }
  const sigParaStart = findEnclosingBlockStart(xml, sigIdx, bodyOpenEnd);
  if (sigParaStart < 0) {
    throw new Error(
      `Could not locate enclosing paragraph for signature in ${growthFile}`,
    );
  }

  return xml.substring(fragStart, sigParaStart);
}

// ============================================================================
// Body builder
// ============================================================================

function buildBodyXml(cfg: TemplateConfig): string {
  const parts: string[] = [
    pBoldHeader("Patient Name:  {patientName}"),
    pBoldHeader("Age / Gender:  {age} / {gender}"),
    pBoldHeader("MR Number:  {mrNumber}"),
    pBoldHeader("Date of Examination:  {date}"),
    pBoldHeader("Ref. Doctor:  {refDoctor}"),
    pEmpty(),
    pTitle("{scanTitle}"),
    pEmpty(),
  ];
  if (cfg.methodology) {
    parts.push(pNormal(cfg.methodology));
    parts.push(pEmpty());
  }
  // Body loop: one paragraph per string in body[]. The AI (and the human
  // editing on /review) writes the full report content — findings + IMPRESSION
  // header + impression bullets — as a single flat array of paragraph strings.
  // docxtemplater unrolls one paragraph per iteration, so each body entry
  // becomes its own paragraph in the .docx.
  parts.push(
    pNormal("{#body}"),
    pNormal("{.}"),
    pNormal("{/body}"),
    pEmpty(),
  );
  return parts.join("\n");
}

// ============================================================================
// Tag one template
// ============================================================================

function tagOne(cfg: TemplateConfig, complianceFragment: string): void {
  if (!existsSync(cfg.sourceFile)) {
    throw new Error(`Source template not found: ${cfg.sourceFile}`);
  }
  const { zip, xml: originalXml } = getDocumentXml(cfg.sourceFile);
  let xml = originalXml;

  // (a) If this template needs the compliance block grafted in (early-pregnancy),
  //     splice it in just before the signature paragraph BEFORE we look for the
  //     preserved-tail anchor — that way the OB anchor "Sex Determination" will
  //     hit inside the freshly injected fragment.
  if (cfg.prependComplianceFromGrowth) {
    const bodyOpenEnd0 = xml.indexOf("<w:body>") + "<w:body>".length;
    const sigMatch = findFirstAnchor(xml, ["Dr.K", "Dr. K", "K.ValliManasa"]);
    if (!sigMatch) {
      throw new Error(
        `Could not find signature in ${cfg.sourceFile} for compliance splice`,
      );
    }
    const sigParaStart = findEnclosingBlockStart(
      xml,
      sigMatch.idx,
      bodyOpenEnd0,
    );
    if (sigParaStart < 0) {
      throw new Error(
        `Could not find signature paragraph in ${cfg.sourceFile} for compliance splice`,
      );
    }
    xml =
      xml.substring(0, sigParaStart) +
      complianceFragment +
      xml.substring(sigParaStart);
  }

  // (b) Locate body region.
  const bodyOpenEnd = xml.indexOf("<w:body>") + "<w:body>".length;
  const sectPrIdx = xml.indexOf("<w:sectPr", bodyOpenEnd);
  const bodyEnd =
    sectPrIdx > 0 ? sectPrIdx : xml.indexOf("</w:body>", bodyOpenEnd);
  if (bodyEnd < 0) {
    throw new Error(`Could not locate body end in ${cfg.sourceFile}`);
  }

  // (c) Locate the preserved-tail anchor.
  const anchorMatch = findFirstAnchor(xml, cfg.preservedAnchors);
  if (!anchorMatch) {
    throw new Error(
      `No preserved anchor matched in ${cfg.sourceFile}. Tried: ${cfg.preservedAnchors.join(", ")}`,
    );
  }
  const tailStart = findEnclosingBlockStart(
    xml,
    anchorMatch.idx,
    bodyOpenEnd,
  );
  if (tailStart < 0) {
    throw new Error(
      `Could not locate enclosing paragraph for anchor "${anchorMatch.needle}" in ${cfg.sourceFile}`,
    );
  }

  // (d) Compose the new body and write the file.
  const preservedTail = xml.substring(tailStart, bodyEnd);
  const newBody = buildBodyXml(cfg) + "\n" + preservedTail;
  const newXml =
    xml.substring(0, bodyOpenEnd) +
    "\n" +
    newBody +
    "\n" +
    xml.substring(bodyEnd);

  zip.file("word/document.xml", newXml);
  const outBuf = zip.generate({ type: "nodebuffer" }) as Buffer;

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const outFile = `${OUT_DIR}/${cfg.scanType}.tagged.docx`;
  writeFileSync(outFile, outBuf);

  // (e) Verify.
  renderTest(outFile, cfg);
  if (cfg.isObstetric) assertCompliancePreserved(outFile, cfg);

  console.log(
    `  ${cfg.scanType.padEnd(24)}  anchor="${anchorMatch.needle.padEnd(20)}"  ${outBuf.length.toString().padStart(6)} bytes`,
  );
}

// ============================================================================
// Inline verifiers
// ============================================================================

function renderTest(outFile: string, cfg: TemplateConfig): void {
  const buf = readFileSync(outFile);
  const zip = new PizZip(buf);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });
  doc.render({
    patientName: "Test Patient",
    age: "30",
    gender: "Female",
    mrNumber: "MR-TEST",
    date: "01/01/2025",
    refDoctor: "Dr. Test",
    scanTitle: cfg.scanTitle,
    body: [
      "Findings within normal limits.",
      "IMPRESSION:",
      "- Normal study.",
    ],
    complianceText: null,
  });
  doc.getZip().generate({ type: "nodebuffer" });
}

function assertCompliancePreserved(outFile: string, cfg: TemplateConfig): void {
  const zip = new PizZip(readFileSync(outFile));
  const xml = zip.file("word/document.xml")?.asText() ?? "";
  for (const needle of ["Sex Determination", "PNDT"]) {
    if (xml.indexOf(needle) < 0) {
      throw new Error(
        `OB compliance check failed for ${cfg.scanType}: "${needle}" not found in ${outFile}`,
      );
    }
  }
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  console.log("=== Tagging 21 scan-type templates ===\n");

  moveMisplacedTemplates();

  console.log("\n--- Extracting compliance fragment from growth template ---");
  const complianceFragment = extractComplianceFragment(GROWTH_TEMPLATE);
  console.log(`  fragment length: ${complianceFragment.length} chars\n`);

  console.log("--- Tagging templates ---");
  let ok = 0;
  for (const cfg of TEMPLATE_CONFIGS) {
    try {
      tagOne(cfg, complianceFragment);
      ok++;
    } catch (err) {
      console.error(
        `\nFAIL  ${cfg.scanType}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      throw err;
    }
  }
  console.log(`\nOK: tagged ${ok}/${TEMPLATE_CONFIGS.length}`);
}

main();
