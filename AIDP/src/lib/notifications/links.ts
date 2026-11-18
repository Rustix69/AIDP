/**
 * Absolute links for messages that leave the app.
 *
 * A page inside the app can link with a path; a message in somebody's inbox
 * cannot, so a notification has to know the origin it is being sent from.
 *
 * `BETTER_AUTH_URL` is that origin. It is not a notification setting, which is
 * the point: it is already the base Better Auth builds its own reset links
 * from, so every link the platform mails is built from one value and a
 * deployment cannot end up sending password resets to one host and report
 * links to another. There is no second variable to forget.
 *
 * The localhost fallback matches src/lib/auth-options.ts exactly. It is wrong
 * in production, and visibly wrong — a link to localhost in an inbox is
 * noticed immediately, which is a better failure than a plausible link to the
 * wrong host.
 */

/** The app's own origin, without a trailing slash. */
export function appUrl(): string {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  return (configured || "http://localhost:3000").replace(/\/+$/, "");
}

/** Where a submission lives, for somebody following it from their inbox. */
export function requestUrl(requestId: string): string {
  return `${appUrl()}/dashboard/requests/${requestId}`;
}

/**
 * The review report itself.
 *
 * Separate from `requestUrl` because the two messages want different landings:
 * somebody told their submission is in wants the request and its progress,
 * while somebody told a report is ready wants the findings, and making them
 * click twice for it is the kind of small rudeness that teaches people to
 * ignore the mail.
 */
export function reportUrl(requestId: string): string {
  return `${appUrl()}/dashboard/requests/${requestId}/report`;
}
