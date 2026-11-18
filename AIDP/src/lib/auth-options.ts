import { prismaAdapter } from "better-auth/adapters/prisma";
import type { BetterAuthOptions } from "better-auth";
import { prisma } from "./prisma";
import { mailer } from "./notifications/mailer";
import { passwordResetMail } from "./notifications/templates/password-reset";

/**
 * How long a sign-in lasts, in seconds: an hour. SESSION_SECONDS overrides it,
 * which is how the expiry is tested without waiting an hour for it.
 */
export const SESSION_SECONDS =
  Number(process.env.SESSION_SECONDS) > 0 ? Number(process.env.SESSION_SECONDS) : 60 * 60;

/**
 * How long a password-reset link stays usable, in seconds: an hour.
 *
 * Better Auth's own default is the same hour, but it is named here because the
 * message says the window out loud. Declared once and passed both to the
 * option and to the template, so the mail cannot promise a window the token
 * does not honour.
 */
export const RESET_TOKEN_SECONDS = 60 * 60;

/**
 * Better Auth configuration, minus anything Next-specific.
 *
 * Split out from `auth.ts` so other entry points can import the same options
 * without dragging in `next/headers` via the nextCookies plugin, which can't
 * load outside a request.
 *
 * Database
 * --------
 * Neon Postgres through Prisma. The schema lives in `prisma/schema.prisma` and
 * is applied with `npm run db:migrate` — Better Auth no longer creates its own
 * tables, so that file is the single source of truth. Changing
 * `additionalFields` below means adding the matching columns there too.
 */
export const authOptions = {
  database: prismaAdapter(prisma, {
    provider: "postgresql",
    // Better Auth writes a user and their credential row together on sign-up;
    // Neon's WebSocket driver supports the interactive transaction that needs.
    transaction: true,
  }),

  // In development Better Auth falls back to a generated secret and warns.
  // Set BETTER_AUTH_SECRET before deploying — sessions are signed with it.
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",

  /**
   * A session lasts an hour from sign-in, and no longer.
   *
   * Better Auth's default is a week, pushed back a day whenever the session is
   * used — so a laptop left signed in to customer designs stayed signed in more
   * or less for good. `expiresIn` sets the hour, and the session cookie's
   * Max-Age follows it, so the browser drops the cookie at the same moment the
   * server stops honouring it. `disableSessionRefresh` is what makes the hour
   * absolute: without it, using the app would keep moving the end further away.
   *
   * An open tab is sent to sign-in when the hour is up by SessionTimeout, since
   * the server only notices on the next request.
   */
  session: {
    expiresIn: SESSION_SECONDS,
    disableSessionRefresh: true,
  },

  /**
   * Collected at sign-up. `input: true` lets the client send them on the
   * sign-up call; each one maps to a column on the `user` table, so changing
   * this list means updating `prisma/schema.prisma` and re-running
   * `npm run db:migrate`.
   */
  user: {
    additionalFields: {
      company: { type: "string", required: true, input: true },
      country: { type: "string", required: true, input: true },
      phone: { type: "string", required: true, input: true },
    },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
    resetPasswordTokenExpiresIn: RESET_TOKEN_SECONDS,

    /**
     * Password-reset delivery.
     *
     * The message is composed in src/lib/notifications/templates and handed to
     * whichever mailer the environment has. With RESEND_API_KEY and MAIL_FROM
     * set that is Resend; without them it is the console in development, where
     * the link is copied out of the terminal running `npm run dev`, and an
     * error in production.
     *
     * ## Why a failure here is allowed to reach the caller
     *
     * Throwing turns a provider outage into a 500 on the forgot-password route,
     * which is deliberate and is what this function did before a provider
     * existed. The alternative — swallowing the error — tells somebody to check
     * an inbox that will never receive anything, and leaves no trace that
     * anything went wrong.
     *
     * It does cost a little: during an outage the route answers differently for
     * an address that has an account and one that does not, which is an
     * enumeration signal. That trade is accepted because it is available only
     * while mail is broken for everybody, and a reset nobody receives is the
     * worse failure of the two.
     */
    sendResetPassword: async ({ user, url }) => {
      const composed = passwordResetMail({
        name: user.name ?? "",
        url,
        expiresInSeconds: RESET_TOKEN_SECONDS,
      });

      await mailer().send({ to: user.email, ...composed });
    },
  },
} satisfies BetterAuthOptions;
