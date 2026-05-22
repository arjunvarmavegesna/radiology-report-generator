import PizZip from "pizzip";
import { readFileSync } from "node:fs";

/**
 * Pull plain text out of a .docx file. Used both for templates (handed to the
 * AI as the "structure to follow") and for reference reports (handed to the AI
 * as style/phrasing examples).
 *
 * Caches per file path in memory — extraction is cheap but runs many times per
 * request (template + 5 refs), and the file contents never change at runtime,
 * so caching keeps the AI route latency-stable.
 */
const cache = new Map<string, string>();

export function extractDocxText(filePath: string): string {
  const cached = cache.get(filePath);
  if (cached !== undefined) return cached;

  const zip = new PizZip(readFileSync(filePath));
  const docXml = zip.file("word/document.xml")?.asText();
  if (!docXml) throw new Error(`word/document.xml missing in ${filePath}`);

  const text = docXml
    .replace(/<w:p\b[^>]*\/>/g, "\n")
    .replace(/<w:p\b[^>]*>/g, "")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  cache.set(filePath, text);
  return text;
}
