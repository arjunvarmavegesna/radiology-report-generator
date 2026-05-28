/**
 * Office protocol handlers: `ms-word:` (and friends) tell Windows to launch
 * the Office desktop app on the supplied URL. The verb after `ms-word:` picks
 * the mode:
 *   `ofe|u|<URL>` = open for editing
 *   `ofv|u|<URL>` = open read-only
 *   `nft|u|<URL>` = new from template
 *
 * Word does its own HTTP GET against the URL — Content-Disposition headers,
 * query strings, signed-URL auth params are all preserved. Falls back
 * silently on machines without Word installed (the protocol handler just
 * isn't registered — the click is a no-op).
 */

/** Build a `ms-word:ofe|u|...` URI for the given docx URL. */
export function wordOpenForEditUri(docxUrl: string): string {
  return `ms-word:ofe|u|${docxUrl}`;
}

/**
 * Launch Word on the given docx URL. Uses a programmatic anchor click rather
 * than `window.location.href` because some browsers block direct location
 * navigation to non-http schemes.
 */
export function openInWord(docxUrl: string): void {
  const a = document.createElement("a");
  a.href = wordOpenForEditUri(docxUrl);
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Trigger a browser download of the docx at the given URL. The signed URL is
 * already issued with `responseDisposition: attachment; filename=...`, so the
 * browser will save the file with the correct name.
 */
export function downloadDocx(docxUrl: string): void {
  const a = document.createElement("a");
  a.href = docxUrl;
  a.rel = "noopener noreferrer";
  // download attribute is a hint; the response's Content-Disposition wins.
  a.setAttribute("download", "");
  document.body.appendChild(a);
  a.click();
  a.remove();
}
