/**
 * Programmatically tag the Thyroid neck template with docxtemplater placeholders.
 *
 * Strategy: keep the original signature block verbatim (located by the unique
 * text "Dr. K Valli Manasa"); rebuild every paragraph BEFORE it with placeholder
 * paragraphs that match the original styling (Times New Roman, size 24, bold
 * for headers, centered+underlined for the scan title). The result is a
 * functional template ready for docxtemplater — open in Word if the visual
 * alignment of the patient header needs tweaking.
 *
 * Usage: npx tsx scripts/tag-thyroid.ts
 */
import PizZip from "pizzip";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const ORIGINAL = "Templates/Ultra sound thyroid neck.docx";
const OUT_DIR = "data/templates-tagged";
const OUT_FILE = `${OUT_DIR}/thyroid_neck.tagged.docx`;
// Anchor for the signature paragraph. Word fragments "Dr. K Valli Manasa"
// across multiple <w:r> runs, but "Dr. K" survives as a contiguous substring
// and only appears in the signature, so it's a safe needle.
const SIG_NEEDLE = "Dr. K";

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
function pBoldHeader(text: string): string {
  return `<w:p>${pprHeader}<w:r>${rprBold}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}
function pBold(text: string): string {
  return `<w:p>${pprBody}<w:r>${rprBold}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}
function pNormal(text: string): string {
  return `<w:p>${pprBody}<w:r>${rprNormal}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}
function pTitle(text: string): string {
  return `<w:p>${pprCenter}<w:r>${rprBoldUnderline}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}
function pEmpty(): string {
  return `<w:p>${pprBody}</w:p>`;
}

function buildBodyXml(): string {
  return [
    // Patient header — one field per line (clean baseline; refine in Word for
    // the two-column look if you prefer).
    pBoldHeader("Patient Name:  {patientName}"),
    pBoldHeader("Age / Gender:  {age} / {gender}"),
    pBoldHeader("MR Number:  {mrNumber}"),
    pBoldHeader("Date of Examination:  {date}"),
    pBoldHeader("Ref. Doctor:  {refDoctor}"),
    pEmpty(),
    // Scan title (centered, bold, underlined)
    pTitle("{scanTitle}"),
    pEmpty(),
    // Methodology — fixed
    pNormal(
      "High resolution ultrasound of the neck was done using a linear high frequency transducer.",
    ),
    pEmpty(),
    // Sections loop (multi-paragraph: open & close markers on their own paras)
    pNormal("{#sections}"),
    pBold("{label}"),
    pNormal("{body}"),
    pEmpty(),
    pNormal("{/sections}"),
    // Impression heading + multi-paragraph loop (one paragraph per item)
    pBold("IMPRESSION:"),
    pNormal("{#impression}"),
    pNormal("- {.}"),
    pNormal("{/impression}"),
    pEmpty(),
    // Padding before the (preserved) signature block
    pEmpty(),
    pEmpty(),
  ].join("\n");
}

function main(): void {
  if (!existsSync(ORIGINAL)) {
    throw new Error(`Original template not found: ${ORIGINAL}`);
  }
  const zip = new PizZip(readFileSync(ORIGINAL));
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("word/document.xml not found in original");
  const xml = docXmlFile.asText();

  const bodyOpen = xml.indexOf("<w:body>");
  if (bodyOpen < 0) throw new Error("<w:body> not found");
  const bodyOpenEnd = bodyOpen + "<w:body>".length;

  const sectPrIdx = xml.indexOf("<w:sectPr", bodyOpenEnd);
  const bodyEnd =
    sectPrIdx > 0 ? sectPrIdx : xml.indexOf("</w:body>", bodyOpenEnd);
  if (bodyEnd < 0) throw new Error("Could not locate body end");

  // Find the signature paragraph by walking backward from the SIG_NEEDLE text.
  const sigTextIdx = xml.indexOf(SIG_NEEDLE);
  if (sigTextIdx < 0) {
    throw new Error(`Signature text "${SIG_NEEDLE}" not found in template`);
  }
  const sigParaStart = xml.lastIndexOf("<w:p ", sigTextIdx);
  if (sigParaStart < 0 || sigParaStart > sigTextIdx) {
    throw new Error("Could not locate signature paragraph start");
  }
  // Keep everything from the signature paragraph to the end of the body
  // (this includes "Dr. K Valli Manasa, MD" + "Consultant radiologist" + any
  // trailing blank paragraphs) verbatim — preserving original alignment.
  const signatureBlock = xml.substring(sigParaStart, bodyEnd);

  const newBody = buildBodyXml() + "\n" + signatureBlock;
  const newXml =
    xml.substring(0, bodyOpenEnd) +
    "\n" +
    newBody +
    "\n" +
    xml.substring(bodyEnd);

  zip.file("word/document.xml", newXml);
  const out = zip.generate({ type: "nodebuffer" }) as Buffer;

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, out);
  console.log(`OK: wrote ${OUT_FILE} (${out.length} bytes)`);
  console.log(
    "Signature block preserved verbatim from the original. Open the .tagged.docx in Word to fine-tune the patient header alignment if needed.",
  );
}

main();
