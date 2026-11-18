import { escapeHtml } from "../html";

/**
 * The one HTML frame every message is written into.
 *
 * ## Why a frame rather than six hand-written documents
 *
 * Mail HTML is not web HTML. Tables carry the layout because Outlook still
 * ignores much of CSS, every style is inline because `<style>` blocks are
 * stripped, nothing is loaded from a server because images are blocked by
 * default, and none of that is interesting enough to retype per message. One
 * frame also means the day somebody wants AIDP's mail to carry a customer's
 * colours is one file, not a search.
 *
 * ## Every helper escapes
 *
 * `para`, `facts`, `button` and the rest take plain text and escape it
 * themselves. The alternative — helpers that take HTML and trust the caller —
 * works until the first template interpolates a request title somebody typed,
 * and that message is in an inbox before anyone notices. Escaping by default
 * means a template has to go out of its way to be wrong rather than out of its
 * way to be right.
 */

const SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const INK = "#0f172a";
const BODY = "#1e293b";
const MUTED = "#64748b";
const LINE = "#eef2f7";
const ACCENT = "#1d4ed8";

/** A paragraph of body text. */
export function para(text: string): string {
  return `<p style="margin:0 0 16px 0;">${escapeHtml(text)}</p>`;
}

/** A paragraph with one phrase in bold — usually the reference. */
export function paraWith(before: string, strong: string, after = ""): string {
  return `<p style="margin:0 0 16px 0;">${escapeHtml(before)}<strong>${escapeHtml(strong)}</strong>${escapeHtml(after)}</p>`;
}

/** The label/value block: reference, title, what was found. */
export function facts(rows: [string, string][]): string {
  const cells = rows
    .map(
      ([label, value], index) => `
                  <tr>
                    <td style="padding:${index === 0 ? "12px" : "2px"} 16px 2px 16px;color:${MUTED};width:108px;vertical-align:top;">${escapeHtml(label)}</td>
                    <td style="padding:${index === 0 ? "12px" : "2px"} 16px 2px 16px;color:${INK};">${escapeHtml(value)}</td>
                  </tr>`,
    )
    .join("");
  return `
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                       style="background:#f8fafc;border:1px solid ${LINE};border-radius:8px;font-family:${SANS};font-size:14px;line-height:1.6;margin:0 0 20px 0;">${cells}
                  <tr><td colspan="2" style="padding:0 0 10px 0;"></td></tr>
                </table>`;
}

/** The call to action. */
export function button(href: string, label: string): string {
  return `
                <a href="${escapeHtml(href)}"
                   style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-family:${SANS};font-size:15px;font-weight:600;padding:12px 22px;border-radius:7px;margin:0 0 20px 0;">
                  ${escapeHtml(label)}
                </a>`;
}

/**
 * The same link again, as text.
 *
 * Not decoration: a button is an anchor with a background, and a client that
 * strips the background leaves a word nobody can tell is a link. The address
 * spelled out is what makes the message work when the styling does not.
 */
export function urlFallback(href: string): string {
  const safe = escapeHtml(href);
  return `
                <p style="margin:0 0 6px 0;font-size:13px;color:${MUTED};">If the button does not work, paste this into your browser:</p>
                <p style="margin:0 0 16px 0;font-size:13px;word-break:break-all;"><a href="${safe}" style="color:${ACCENT};">${safe}</a></p>`;
}

/** A quieter line under the main body. */
export function note(text: string): string {
  return `<p style="margin:0 0 12px 0;font-size:13px;color:${MUTED};">${escapeHtml(text)}</p>`;
}

export type ShellInput = {
  /** The inbox preview line. Hidden in the body itself. */
  preheader: string;
  /** The <title>, and what the message is about. */
  title: string;
  heading: string;
  /** Composed from the helpers above. */
  body: string;
  /** The line under the rule at the bottom. Optional. */
  footer?: string;
};

export function shell(input: ShellInput): string {
  const footer = input.footer
    ? `
            <tr>
              <td style="padding:0 28px 28px 28px;border-top:1px solid ${LINE};font-family:${SANS};font-size:13px;line-height:1.6;color:${MUTED};">
                <p style="margin:18px 0 0 0;">${escapeHtml(input.footer)}</p>
              </td>
            </tr>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.title)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f6f9;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f9;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="max-width:520px;background:#ffffff;border:1px solid #e3e8ef;border-radius:10px;">
            <tr>
              <td style="padding:28px 28px 8px 28px;font-family:${SANS};">
                <p style="margin:0 0 4px 0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">AIDP</p>
                <h1 style="margin:0;font-size:20px;line-height:1.35;color:${INK};font-weight:600;">${escapeHtml(input.heading)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 0 28px;font-family:${SANS};font-size:15px;line-height:1.6;color:${BODY};">
${input.body}
              </td>
            </tr>${footer}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** "Hello Nitin," or "Hello," — a name that is only whitespace is no name. */
export function greeting(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `Hello ${trimmed},` : "Hello,";
}
