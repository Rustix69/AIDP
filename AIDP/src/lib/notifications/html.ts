/**
 * Escaping for values that go into an email body.
 *
 * Mail templates interpolate things people typed — a name at sign-up, a request
 * title, a decision note. An HTML mail client renders markup, so the same rule
 * that applies to a web page applies here, with the aggravation that a message
 * cannot be corrected once it has been delivered.
 *
 * Shared rather than per-template so that the next template cannot be written
 * without it being obvious that this exists.
 */

/**
 * Make a string safe to place in HTML text or inside a double-quoted attribute.
 *
 * `&` is escaped first; escaping it after the others would double-escape the
 * entities they introduce. Applying this to a URL is correct rather than
 * merely harmless — `&` between query parameters is required to be `&amp;` in
 * an `href`, and mail clients are stricter about it than browsers are.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
