# AIDP — landing page & authentication

Marketing site and auth flow for **AIDP**, an AI-native enterprise architecture
governance platform.

This build covers the public landing page and the four auth screens only. The
dashboard, submission portal, KB manager, report viewer, and analytics screens
are out of scope; `/dashboard` exists solely as an unstyled placeholder that
proves the post-auth redirect and session guard work.

## Running it

```bash
npm install
npm run dev            # writes .env.local, then tell it about your database
# paste your Neon pooled connection string into DATABASE_URL
npm run db:migrate     # creates the four auth tables
```

There is one thing to configure: the database. `predev` writes `.env.local`
with a generated dev secret and an empty `DATABASE_URL`, and the app refuses to
serve a request until that has a [Neon](https://neon.tech) Postgres connection
string in it — pooled, the host with `-pooler` in it. `.env.example` says where
to find it. If the project is linked to Vercel, `vercel env pull .env.local`
fetches it instead. Then open http://localhost:3000.

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server (bootstraps `.env.local`, runs `prisma generate`) |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run db:migrate` | Create + apply a migration from schema changes (dev) |
| `npm run db:deploy` | Apply existing migrations (CI / production) |
| `npm run db:generate` | Regenerate the Prisma client into `generated/` |
| `npm run db:studio` | Prisma Studio against the same database |

## Routes

| Route | Notes |
| --- | --- |
| `/` | Landing page |
| `/sign-up`, `/sign-in` | Email + password |
| `/forgot-password`, `/reset-password` | Token-based reset |
| `/dashboard` | Placeholder; redirects to `/sign-in` without a session |
| `/api/auth/[...all]` | Better Auth handler |

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Framer Motion ·
Better Auth on Neon Postgres via Prisma 7 · `lucide-react` · Geist + Inter via
`next/font`.

## Theme

Monochrome: near-black grounds, white and grey for structure and body copy.
Royal purple is the only accent and is spent deliberately — display emphasis,
the primary CTA, the stats figures, active states, and the "live" parts of the
diagrams. Everything else, including the scroll path itself, is white.

The three purples in `globals.css` are a contrast ladder against `#08090c`, not
a palette. `royal` carries white text on solid fills; `royal-mid` is safe for
large display text; `royal-soft` is the one to use for small text and icons —
`royal` at 14px would fail contrast.

## How the landing page is put together

Sections live in `src/components/landing/`, and every visual is hand-drawn SVG
in `src/components/visuals/` — no stock illustration.

### The connecting path

`ScrollPath.tsx` is the centrepiece: one continuous line that threads down the
page with a glowing node riding it at the current scroll position.

It measures the page rather than hard-coding a shape. Any element tagged
`data-path-anchor` is a point the line must pass through; the component reads
those elements' real pixel centres (re-measuring on resize and after webfonts
load) and joins them with cubic béziers whose control handles are offset only
vertically — which produces the weave and guarantees the line never travels
back upward. The rendered path is then sampled into a lookup table so a scroll
position maps to a point by **binary search on y**, not on arc length; that
keeps the node exactly level with the section it belongs to instead of drifting
on the curved stretches. The same lookup drives the stroke dash offset, so the
drawn end of the line and the node are always the same point.

To attach a new section to the line, put `data-path-anchor` on the element it
should pass through. Add `data-path-step` to an ancestor to have that section
light up as the node goes by (see the `[data-path-active]` rules in
`globals.css` — the highlight is plain CSS, so scrolling costs no re-renders).

On narrow viewports the horizontal excursion is clamped so the line stays a
gentle centre spine instead of clipping off-screen.

### Motion and `prefers-reduced-motion`

The hero gradient tracks the cursor with a lerped `requestAnimationFrame` loop,
falls back to a slow ambient drift on touch devices, and pauses entirely when
scrolled out of view.

Reduced motion is honoured throughout: the path renders fully drawn instead of
animating in, travel distances collapse to zero, and `MotionProvider` sets
Framer's `reducedMotion="user"` globally.

One trap worth knowing if you extend this: `useReducedMotion` cannot report the
real value until after mount without breaking hydration, so components must not
*structurally* branch on it. Framer writes `opacity: 0` on the first render, and
if the branch then removes the props that would animate it back, the content
stays invisible forever. Vary the transition instead of the element — see the
comments in `Reveal.tsx` and `Hero.tsx`.

## Authentication

Configured in `src/lib/auth.ts` (server) and `src/lib/auth-client.ts` (browser).

**Database.** Neon Postgres via Prisma, and nothing else — there is no local
file database and no fallback. Put your Neon *pooled* connection string in
`DATABASE_URL` (see `.env.example`), then `npm run db:migrate` to apply
`prisma/migrations`. `src/lib/prisma.ts` holds the client — Prisma 7 runs
without the Rust query engine, so it connects through the `@prisma/adapter-neon`
driver adapter over Neon's WebSocket protocol rather than a plain connection
string. WebSockets rather than HTTP because Better Auth writes a user and their
credential row in one interactive transaction, which the HTTP driver can't hold
open.

**Pooled vs direct.** The app uses the pooled host; the migration CLI uses
`DIRECT_DATABASE_URL` when it is set, because Neon's pooler is PgBouncer in
transaction mode and can't hold the session-level advisory lock
`prisma migrate` takes. That preference lives in `prisma.config.ts`.

**Production deploys.** Vercel runs `npm run db:deploy` before `npm run build`
through `vercel.json`. Configure `DIRECT_DATABASE_URL` in the Vercel project
environment for each environment that deploys the app — this is required, not
optional, and the build refuses to start without it.

`DIRECT_DATABASE_URL` is the same Neon connection string with `-pooler` removed
from the host. Migrations take a session-level advisory lock; Neon's pooler runs
PgBouncer in transaction mode and cannot hold one, so running them against the
pooled host waits ten seconds and fails with

```
Error: P1002 ... Timed out trying to acquire a postgres advisory lock
```

which reads as a database outage when the database is perfectly healthy.
`scripts/check-migrate-url.mts` runs first and says so in those words rather
than letting the timeout happen. This applies pending
Prisma migrations before the deployment is built and served; if a migration
fails, the deployment fails instead of serving code against an old schema.
Keep `DATABASE_URL` set to the pooled connection string for application
traffic. If you override Vercel's Build Command in project settings, preserve
the `npm run db:deploy && npm run build` sequence.

**Schema.** `prisma/schema.prisma` owns the four Better Auth tables (`user`,
`session`, `account`, `verification`). The column names are not arbitrary —
Better Auth addresses them directly, so they have to match `getAuthTables()` in
`@better-auth/core`. Better Auth does not create or alter tables here; Prisma
migrations are the only thing that touches the schema.

**Sign-up fields.** Beyond name, email, and password, sign-up collects company,
country, and phone. These are declared twice on purpose: as
`user.additionalFields` in `src/lib/auth-options.ts`, which is what lets the
client send them and Better Auth accept them, and as columns on `User` in
`prisma/schema.prisma`. Change one and you must change the other, then run
`npm run db:migrate`. On the client, `inferAdditionalFields` gives
`signUp.email` and `useSession` the matching types.

**Password reset.** Sent through the mailer in
`src/lib/notifications/mailer.ts`. Set `RESEND_API_KEY` and `MAIL_FROM` together
and it goes out through Resend; leave either unset and the message is printed to
the terminal running `npm run dev` — copy the link out of it to complete the
flow, exactly as before a provider existed. In production an unset pair throws
on the action that needs it rather than failing silently.

The reset window is `RESET_TOKEN_SECONDS` in `src/lib/auth-options.ts`, declared
once and passed both to Better Auth and to the template, so the message cannot
promise a window the token does not honour.

**Mail.** `resend` is imported in `src/lib/notifications/mailer.ts` and nowhere
else. Everything sends through the `Mailer` interface, so a customer who
requires their own Microsoft 365 tenant or SMTP relay is a second implementation
in that file rather than a change spread across the app. Note that
`resend.emails.send` resolves with `{ data: null, error }` instead of throwing —
`ResendMailer` converts that into a thrown `MailRefused`, which is why callers
can treat a resolved send as a sent message. `npx tsx --env-file=.env.local
scripts/verify-mailer.mts` checks the whole path without sending anything.

## Notifications

Everything the platform tells somebody about is a row in `notification` before
it is a message anywhere. `src/lib/notifications/` holds the whole of it:
`events.ts` is the list of things worth announcing and who each one reaches,
`enqueue.ts` writes the rows, `kinds.ts` is the catalogue of message types and
how each is written, and `drain.ts` sends them.

**Nothing sends inline.** A slow provider would make a person wait and a dead
one would lose the message with no record it was ever owed. The row is written
in the same breath as the thing it is about; delivery is somebody else's
problem a moment later.

**Duplicates are the real hazard, not lost mail.** `advanceSubmitted` and
`advanceChecking` are called on every page render, by design — so the code that
notices a request has moved on runs constantly, and anything hung off it runs
constantly too. The unique index on `dedupeKey`
(`requestId:kind:channel:recipient`) plus `skipDuplicates` is what turns a
hundred enqueues into one email. Callers may enqueue as often as they like and
are expected to.

**What drains it**, in the order it usually happens: the server action that
enqueued drains in `after()`, so the common case leaves within a second; any
pass takes everything due rather than only what the caller wrote, so stragglers
go out on the next one; and `/api/internal/send-notifications` is there for a
timer. No `crons` entry is wired — Vercel's Hobby plan allows one a day, and an
entry a plan refuses fails the deployment rather than the feature.

**Failures are sorted into two kinds.** A message that cannot be *sent* is
retried with `min(3600, 2^attempts)` seconds of backoff and dead-letters at
`maxAttempts`, the same shape `Workers/aidp/queue.py` uses. A message that
cannot be *written* — unknown kind, payload missing a field — is dead on the
first pass, because waiting will not supply the field. An unconfigured provider
is neither: rows stay queued with no attempt spent.

**What is sent, and to whom.** Five kinds, listed in `kinds.ts`:

| Kind | To | On |
|---|---|---|
| `submission_received` | requestor | submit |
| `ready_to_assess` | requestor | `submitted → ready` |
| `report_ready` | requestor | `checking → reported` |
| `review_requested` | everyone who can decide | the same transition |
| `assessment_failed` | requestor | `stop()`, which every failure path goes through |

`ready_to_assess` and `assessment_failed` are in neither client document. The
first covers a state the documents do not model — a request waits for somebody
to press "Start assessing", because opening a run costs model calls and that is
a person's decision. The second exists because failure is not modelled at all,
and a requestor whose submission stopped was never told.

Recipients are the requestor and, for a report, everyone whose role passes
`canDecideSubmissions` minus whoever filed it. The brief names an *assigned*
architect; `ReviewAssignment` is migrated and no code writes it, so asking
everyone who could decide is the stand-in until it does. There is no board model
and no watcher list, so ARB and stakeholder messages wait on those.

**How the app learns a run has landed.** It did not, until now: the analyse
worker wrote `assessment_run.state` and the app found out when somebody opened a
page. That is fine for a stepper and useless for "your report is ready", which
has to be sent when nobody is looking. `notify.run_complete` in
`Workers/aidp/notify.py` now posts the run id to
`/api/internal/advance-runs`, and the app reads the run row and decides what it
means — the worker still never writes a governance table. Both endings go
through it; the run's own state says which.

**Recurring events need a salt.** A failed request is editable: it goes back
through submit, becomes ready again, and produces a second report. Keyed on the
request alone the requestor would hear about the first of each and never the
rest, so callers whose event can recur pass `dedupeSalt` — the run id, usually.
`submission_received` passes none, because it happens once.

`npx tsx --env-file=.env.local scripts/verify-notifications.mts` checks all of
it against the database, scoped to a throwaway organisation so a test drain can
never touch a real customer's outbox.

**Secrets.** `BETTER_AUTH_SECRET` is generated into `.env.local` on first run for
convenience. Set it through the real environment before deploying — rotating it
invalidates every session.

## Notes on the content

Copy is written from the product brief. The only quantitative claim made is the
6–8 week → 3–5 day review timeline; the other figures on the stats strip describe
how the system is built (six pipeline stages, findings cited to a principle)
rather than asserting unverified adoption or accuracy numbers. There is no
customer logo strip, because inventing one would imply social proof that does
not exist.
