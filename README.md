# AIDP — AI Design Pattern / compliance gap engine

AIDP turns an enterprise's architecture standards from documents nobody can
enforce into an automatic gate that every solution design is checked against.

A customer uploads their standards registers. AIDP breaks them into individual
clauses. When a design lands, the engine fires **every clause** at it and records
a verdict per clause, each one cited to a passage in the submitted document. An
architect then reviews findings instead of hunting for them.

> It answers questions, but it is **not a chatbot** and not RAG-with-a-text-box.
> Nobody types a query. Retrieval runs *backwards*: the reference clause is the
> query, and the submitted design is the corpus. A chatbot is judged on whether
> the answer reads well; this is judged on whether a "compliant" verdict survives
> an audit.

---

## Contents

1. [Repository layout](#1-repository-layout)
2. [Architecture](#2-architecture)
3. [The assessment engine](#3-the-assessment-engine)
4. [Data model](#4-data-model-the-parts-that-matter)
5. [Prerequisites](#5-prerequisites)
6. [Setup](#6-setup)
7. [Verifying the install](#7-verifying-the-install)
8. [The evaluation loop](#8-the-evaluation-loop)
9. [Cost and model configuration](#9-cost-and-model-configuration)
10. [Gotchas that will cost you an hour](#10-gotchas-that-will-cost-you-an-hour)
11. [Where to read next](#11-where-to-read-next)

---

## 1. Repository layout

Two runtimes, one database. They share nothing else — no RPC, no message broker.

```
Dexter/
├── AIDP/              Next.js 16 app — UI, auth, governance workflow, API
├── Workers/           Python 3.12 workers — parse, chunk, embed, analyse
├── templates/         the client's six standards registers (.xlsx) — GITIGNORED
├── samples/           MERIDIAN_ANSWER_KEY.md — the 170-clause eval key
└── .claude/agents/    subagent definitions for debugging the engine
```

**The two halves are deliberately separate processes.** The app owns every
governance table and is the only thing that writes them. The workers own the
pipeline and write only pipeline tables plus findings. A worker never writes a
governance table — when a run lands it POSTs the run id to the app and lets the
app decide what it means (`Workers/aidp/notify.py` →
`/api/internal/advance-runs`).

| | AIDP (app) | Workers |
|---|---|---|
| Runtime | Node 22.x, Next.js 16 App Router | Python 3.12 in Docker |
| Postgres connection | **pooled** Neon string | **direct** Neon string |
| Deploys to | Vercel | local Docker (see note below) |
| Owns | auth, orgs, requests, decisions, reports | parsing, chunking, embeddings, verdicts |

> **Deployment reality check:** all jobs currently run on local Docker workers.
> There is no hosted worker environment. The app can sit on Vercel; the workers
> run on whatever machine you start them on, and reach the app over
> `host.docker.internal`.

---

## 2. Architecture

### The pipeline

```
upload ──► parse ──► chunk ──► embed ──┬──► (reference / technology: stop here)
                                       │
                                       └──► analyse ──► findings ──► report
```

A document carries a **role** that decides how far it travels:

| Role | Meaning | Stops at |
|---|---|---|
| `reference` | a customer's standards document | embed |
| `technology` | an approved-technology stack | embed |
| `assessed` | a design submitted for review | analyse |

`technology` is not set by the uploader — the parse stage sets it from what the
file turned out to be.

### The queue

There is no Redis, no Celery, no SQS. The queue is a Postgres table (`job`)
claimed with `SELECT … FOR UPDATE SKIP LOCKED`. That buys lease semantics,
heartbeats, exponential backoff, a reaper for workers that died holding a lease,
and a dead-letter state — all transactional with the work itself.

- One Docker image, four roles. `STAGE` picks the loop at startup
  (`Workers/aidp/__main__.py`). No default `STAGE`: a container started without
  one fails immediately rather than quietly running the wrong loop.
- `SKIP LOCKED` means replicas of the same stage never collide, so
  `docker compose up --scale embed=3` is the whole scaling story.
- Every job carries a `correlationId` that follows a document across all stages.
- Handlers receive a `heartbeat` callable and are expected to call it — a long
  parse with vision calls will outrun its lease otherwise and get reaped
  mid-work.

### Storage

Blobs (uploaded PDFs, extracted figure images) live either on a shared local
directory (`AIDP/.storage`, mounted into the workers by compose) or in
UploadThing reached through the app. **The workers deliberately do not hold the
UploadThing token** — it exists only in the app, so rotating it doesn't mean
redeploying two runtimes.

### How the workers talk to the app

Two internal endpoints, both gated by `WORKER_SHARED_SECRET` sent as
`x-worker-secret` (see `AIDP/src/lib/access/internal-auth.ts`):

| Endpoint | For |
|---|---|
| `/api/internal/files` | blobs, when `STORAGE_BACKEND=app` |
| `/api/internal/credentials` | a customer's own decrypted model key |
| `/api/internal/advance-runs` | worker tells the app a run has landed |
| `/api/internal/send-notifications` | drains the mail outbox (for a timer) |

With no secret configured, every one of these answers 401. That is the correct
default — an endpoint that hands out decrypted API keys must never be open by
omission.

---

## 3. The assessment engine

This is the part worth your attention; everything else is plumbing.

### Backwards retrieval

For each of the ~170 clauses in the customer's framework, the engine searches the
submitted design and classifies what it finds. The clause is the query. This is
why chunking must be **clause-atomic** — a Requirements bullet severed from its
Statement is a useless probe.

### Two modes

| Mode | What it sends | When |
|---|---|---|
| **whole document** | the entire design, every call, provider-cached after the first | default, below the token ceiling |
| **search** | hybrid (vector + lexical) retrieval scoped to one document | above `WHOLE_DOCUMENT_MAX_TOKENS` (250k), recorded on the run |

These two modes do not agree with each other, and the disagreement is not
settled: search mode has returned 37 `contradicts` where document mode returned
5 on the same corpus. If you are evaluating judgement quality, pin the mode
first — see `.claude/agents/knobs-and-mode.md`.

### Verdict vocabulary

Seven verdicts, in `Workers/aidp/stages/analyse.py`:

| Verdict | Means |
|---|---|
| `covered` | the design meets the clause |
| `partial` | partly met |
| `absent` | the design does not address it |
| `contradicts` | the design does the opposite |
| `needs_review` | the engine will not assert either way |
| `not_assessable` | on-subject, but the evidence to judge it isn't in the document |
| `not_applicable` | the clause doesn't govern this architecture at all |

The last two exist because of a specific failure. Without `not_assessable`, "the
document does not say" was forced into `absent`, which a confirmed absent turned
into a Critical gap — so a missing page of paperwork reached a report beside a
real breach and read the same. `not_applicable` is held to the strictest proof
(it must cite the passage establishing what the design *is*, and may not rest on
a reading of a diagram) because it removes a clause from the report rather than
answering it.

### Guards against false certainty

The model's verdict is **not taken at face value**. A `covered` that cites no
evidence, or an `absent` reached on top of weak retrieval, is demoted to
`needs_review`. The reasoning: a wrong `absent` sends someone to fix what already
exists; a wrong `covered` ships a gap into production.

Every verdict that asserts something about the document must point at a passage
in it, and the quote is **verified against the rendered text in code** — not
trusted from the model.

### Repeatability

A clause is read up to `JUDGE_READINGS` times (default 3) and the readings are
voted on. Readings stop as soon as two agree, so an ordinary clause costs two
calls and only a contested one costs three. The first reading is pinned, the rest
sampled on their own seeds — a vote between identical draws is one opinion
counted three times.

This exists because two runs over one unchanged design came back `9 absent /
4 needs_review`, then `7 / 7`. For a tool whose output goes to an architecture
review board, that is the whole of its credibility.

### Resumability

Findings commit one at a time. A worker that dies mid-run is requeued by the
reaper and picks up at the clause after the last one written, rather than
starting again and paying for it twice.

### The request lifecycle

```
draft ──► submitted ──► ready ──► checking ──► reported ──► decided
                           │                        │
                           └────────► failed ◄──────┘
```

`ready` means *indexed, waiting for a human to press "Start assessing"* — opening
a run costs real money, so it is a person's decision, not an automatic one.
`failed` carries a `failureReason` in words the requestor can act on, because a
submission that cannot proceed has to say so rather than sit in `submitted`
forever.

### Roles

Four tiers, compared in exactly one place (`AIDP/src/lib/access/roles.ts`):

| Role | Can |
|---|---|
| platform admin | see every organisation's people and spend — **never their documents** |
| owner | admit/remove colleagues, curate standards, install the model key |
| architect | decide what happens to a submission after review |
| member | submit designs, review findings |

Nobody — administrator included — may rule on their own submission.

---

## 4. Data model (the parts that matter)

`AIDP/prisma/schema.prisma` is ~2,700 lines and heavily commented; the comments
are the design record, so read them rather than the column list.

**Organisation is a hard tenant boundary.** One customer's Internal-Use standards
must never surface in another's assessment.

```
Organisation                       ← the tenant boundary
 ├── Membership / RosterEntry      who is in it, and in what role
 ├── Framework → Clause            their standards, as structured data
 ├── Project
 │    └── ArchitectureRequest      a submission (AR-0001, per-org numbering)
 │         └── AssessmentRun
 │              └── Finding        one per clause, cited
 ├── Document → Section/Chunk/Embedding/Figure/TableBlock
 ├── Decision                      standing rulings that bind future runs
 ├── ProviderCredential            the customer's own model key, AES-256-GCM
 ├── TokenUsage                    per-run, per-person spend
 └── Notification                  the outbox
```

Notes a reviewer will want:

- **Governance records are relation-free on purpose.** `Decision.sourceDocumentId`
  and `ArchitectureRequest.documentId` are not foreign keys — a governance record
  has to survive its source document being removed from the library, and a
  cascade would erase the submission along with it.
- **Vectors are `vector(1024)`** via pgvector, with a GIN index on a weighted
  `tsvector` for the lexical half of hybrid search.
- **State columns are strings, not Prisma enums**, with the vocabulary written in
  the doc comment — a vocabulary that grows should not cost a migration.
- **Decisions are one-way.** A standard already in the library never goes back
  through Decisions; clause status is set directly, never proposed.

### Notifications

Everything the platform tells somebody is a row in `notification` before it is a
message anywhere. Nothing sends inline. The hazard here is duplicates, not lost
mail — the screens repair their own state as they render, so the code that
notices "this request moved on" runs on every page load. A unique index on
`dedupeKey` (`requestId:kind:channel:recipient`) plus `skipDuplicates` turns a
hundred enqueues into one email. Callers may enqueue as often as they like and
are expected to.

---

## 5. Prerequisites

| | Version | Notes |
|---|---|---|
| Node | **22.18 ≤ v < 23** | `package.json` `engines` pins this |
| npm | 10+ | |
| Docker + Compose | any current | the workers only run in Docker |
| Neon Postgres | — | pgvector is created by the first migration |
| OpenRouter key | — | one key covers judging *and* embeddings |

> **Node version.** `engines` says 22.x. This machine has v24.18.0, which npm
> will not block (no `engine-strict`). It has been working, but if you hit
> anything strange in the Next build, pin to 22 before debugging further.

You do **not** need Python locally — the workers run in Docker and the image
installs everything. Python 3.11+ is only needed if you want to run the worker
test files directly on the host.

---

## 6. Setup

### 6.1 Database

Create a Neon project. You need **both** connection strings from the Neon
console:

- **pooled** — host contains `-pooler`. The app uses this.
- **direct** — the same string with `-pooler` removed. Migrations and the workers
  use this.

This is not a style preference. Neon's pooler is PgBouncer in transaction mode:
it cannot hold the session-level advisory lock `prisma migrate` takes, and it
breaks the lease semantics the worker queue depends on.

pgvector is created by `20260802150931_document_ingestion/migration.sql`
(`CREATE EXTENSION IF NOT EXISTS vector`) — nothing to do by hand.

### 6.2 The app

```bash
cd AIDP
npm install
npm run dev          # predev writes .env.local and runs `prisma generate`
```

`predev` generates `BETTER_AUTH_SECRET` and leaves `DATABASE_URL` empty on
purpose. Open `AIDP/.env.local` and fill in:

```ini
# Database — note which string goes where
DATABASE_URL=postgresql://…@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
DIRECT_DATABASE_URL=postgresql://…@ep-xxx.REGION.aws.neon.tech/neondb?sslmode=require

# You, so you get the operator console at /admin
PLATFORM_ADMIN_EMAILS=you@example.com

# Models. These three MUST match Workers/.env character for character.
EMBEDDING_PROVIDER=openrouter
EMBEDDING_MODEL=openai/text-embedding-3-large
EMBEDDING_DIMS=1024
OPENROUTER_API_KEY=sk-or-…
OPENROUTER_PROVIDERS=openai

# Machine-to-machine. `openssl rand -base64 32`
WORKER_SHARED_SECRET=…
# Seals customers' own model keys. `openssl rand -base64 32`
CREDENTIAL_ENCRYPTION_KEY=…

# Storage shared with the workers
STORAGE_BACKEND=local
STORAGE_LOCAL_PATH=.storage
```

Then apply the schema and start it:

```bash
npm run db:migrate   # uses DIRECT_DATABASE_URL automatically (prisma.config.ts)
npm run dev
```

`AIDP/.env.example` documents every variable and *why* it exists — read it rather
than copying the block above blind.

**Mail is optional.** Leave `RESEND_API_KEY` / `MAIL_FROM` unset and outgoing
mail is printed to the terminal running `npm run dev`; copy the password-reset
link out of it. Set both or neither — a half-filled pair is treated as
unconfigured.

### 6.3 The workers

```bash
cd Workers
cp .env.example .env
```

Fill in `Workers/.env`:

```ini
DATABASE_URL=postgresql://…@ep-xxx.REGION.aws.neon.tech/neondb?sslmode=require   # DIRECT

LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-…
OPENROUTER_MODEL=openai/gpt-4.1-mini
OPENROUTER_PROVIDERS=openai
OPENROUTER_ZDR=off

EMBEDDING_PROVIDER=openrouter
EMBEDDING_MODEL=openai/text-embedding-3-large
EMBEDDING_DIMS=1024

STORAGE_BACKEND=local
STORAGE_LOCAL_PATH=/app/.storage

APP_BASE_URL=http://host.docker.internal:3000
WORKER_SHARED_SECRET=…       # identical to the app's
```

Start them — **from `Workers/`, not from the repo root**:

```bash
docker compose up --build
```

That brings up four containers (parse, chunk, embed, analyse) sharing
`../AIDP/.storage` as a mounted volume. Scale a stage when documents back up:

```bash
docker compose up --scale embed=3
```

Why the directory matters: compose interpolates `${JUDGE_MODEL}`,
`${PREFER_WHOLE_DOCUMENT}` and friends from `Workers/.env`, and **only when run
from `Workers/`**. Run it from anywhere else and every one of them resolves
empty, which silently changes what a run costs. See §10.

### 6.4 First account and standards

1. Sign up at <http://localhost:3000/sign-up>. An email listed in
   `PLATFORM_ADMIN_EMAILS` is promoted to platform admin on its next sign-in, and
   the `isPlatformAdmin` column is the authority from then on.
2. Create an organisation, then upload standards.

> ### ⚠ The standards are not in this repository
>
> `templates/` holds the client's six `.xlsx` registers and is **gitignored** —
> they are the customer's Internal-Use material and this repo is public. A fresh
> clone ships **no standards at all**. The product's own 145-standard baseline
> library was deleted on 2026-11-13; the client's six registers are now the only
> standards AIDP uses.
>
> You need these six files from Martin before anything can be assessed:
>
> ```
> Enterprise_Architecture_Standards.xlsx     15 clauses   EA-001  … EA-015
> Solution_Architecture_Standards.xlsx       33 clauses   SOL-001 … SOL-033
> Security_Standards.xlsx                    36 clauses   SEC-001 … SEC-036
> Integration_Standards.xlsx                 40 clauses   INT-001 … INT-040
> Infrastructure_Standards.xlsx              18 clauses   INF-001 … INF-018
> Data_Standards.xlsx                        28 clauses   DAT-001 … DAT-028
>                                           170 clauses total
> ```

Upload each as a **Reference standard**. A register is the one input shape where
nothing is inferred: one row is already one standard, with its parts in named
columns, so `Workers/aidp/parsing/registers.py` infers nothing — one row becomes
one *section* (numbered `SEC-006` etc.), which is what makes every finding in the
report quotable.

Then upload a design as **Design to assess** and press *Start assessing*.

---

## 7. Verifying the install

### Worker smoke tests — no API key needed

```bash
cd Workers

# Parsing, against a synthetic PDF carrying the traps of the real corpus
docker run --rm -v "$PWD":/w -w /w --entrypoint python aidp-worker:dev \
  scripts/smoke_parse.py

# The queue against the real database — claim, lease, chain, backoff, DLQ
docker run --rm -v "$PWD":/w -w /w -e STAGE=parse -e DATABASE_URL="$DIRECT_URL" \
  --entrypoint python aidp-worker:dev scripts/smoke_queue.py

# The analyse stage with the model stubbed — clause loop, guards, resumability
docker run --rm -v "$PWD":/w -w /w -e STAGE=analyse -e DATABASE_URL="$DIRECT_URL" \
  -e GEMINI_API_KEY=stub --entrypoint python aidp-worker:dev scripts/smoke_analyse.py
```

What none of them prove is judgement *quality* — whether "absent" really means
absent. That needs real documents and real model calls, and it is what the eval
set in §8 is for.

### Worker test suite

`Workers/tests/` holds 39 files. **They are standalone scripts, not pytest
tests** — there is no `pytest` dependency and collecting them will not work. Run
each file on its own:

```bash
cd Workers
python tests/test_verdict_agreement.py
python tests/test_guard_strips.py
# …
```

### App verification scripts

`AIDP/scripts/` holds 52 `verify-*.mts` scripts, each one checking a specific
guarantee against the real database. They are the closest thing this codebase has
to integration tests, and their file headers explain what property is being held
in place and why.

```bash
cd AIDP
npx tsx --env-file=.env.local scripts/verify-notifications.mts
npx tsx --env-file=.env.local scripts/verify-mailer.mts        # checks the path, sends nothing
npx tsx --env-file=.env.local scripts/verify-lifecycle.mts
```

`verify-notifications.mts` scopes everything to a throwaway organisation so a
test drain can never touch a real customer's outbox. Others follow the same
discipline — but read the header before running one against a database you care
about.

### Lint and types

```bash
cd AIDP && npm run lint && npm run typecheck
cd Workers && ruff check . && mypy aidp
```

---

## 8. The evaluation loop

This is how you tell whether a change to the engine helped.

`samples/MERIDIAN_ANSWER_KEY.md` is the expected verdict for all **170 clauses**
of the six client registers against a real design (*Meridian One Unified
Solution Architecture*, 11pp), derived by reading the two against each other by
hand.

```bash
cd AIDP
npx tsx --env-file=.env.local scripts/score-run.mts <runId> [keyFile]
```

It makes **no model calls** — it reads findings and a key and compares them. Safe
against a finished run, a failed one, or the same run repeatedly.

Two accuracy figures, deliberately:

| Figure | Over |
|---|---|
| `accuracy` | rows that produced a finding |
| `accuracyAll` | every row in the key, counting a missing finding as wrong |

The second exists because the first cannot see a run that answered nothing.

**Caveats the key states about itself**, so nobody mistakes it for ground truth:

1. The registers' **Status column is blank on every row** — nothing says which
   clauses are Mandatory and which Recommended. Obligation is read from each
   clause's own wording, which is what the engine does too. If the client ever
   populates that column, re-derive the must/should split before trusting any
   severity.
2. `INF-006` (GPU) and `SEC-035` (Generative AI) are `not_applicable` on a
   condition the clauses themselves state. They are not silence.
3. Expect legitimate disagreement on the `partial` rows.

The key names 24 rows under *"Must get these right"* — 19 breaches the engine
must find, and 5 clauses the design genuinely meets, included so the suite
catches a judge made too strict as readily as one made too lenient.

### Debugging a bad finding

`.claude/agents/` defines six subagents for exactly this, and they encode the
right order of attack:

| Agent | Use when |
|---|---|
| `answer-key-differ` | scoring a run, comparing two runs — **the only one allowed to say something improved or regressed** |
| `finding-forensics` | one clause is wrong and nobody knows why; traces it backwards to a root cause |
| `evidence-fidelity` | the problem is what the judge was *shown*, or a quote that won't verify |
| `guard-calibrator` | a guard is suspected of eating a correct finding |
| `knobs-and-mode` | any question about configuration rather than wording |
| `prompt-surgeon` | the failure is in the judge prompt or verdict schema |

Change one knob at a time, and score before and after.

---

## 9. Cost and model configuration

**A full 170-clause run costs roughly $2.03.** Assessment is ~93% of all spend —
parsing, chunking and embedding are rounding errors. Check the account balance
before kicking off a batch.

| Setting | Default | What it does |
|---|---|---|
| `OPENROUTER_MODEL` | `openai/gpt-4.1-mini` | the judge |
| `JUDGE_READINGS` | 3 | readings per clause; stops at two agreeing |
| `ASSESS_CONCURRENCY` | 8 | clauses in flight |
| `PREFER_WHOLE_DOCUMENT` | `on` in `config.py`, **forced `off` in compose** | whole-document vs search mode |
| `WHOLE_DOCUMENT_MAX_TOKENS` | 250000 | above this, falls back to search and says so on the run |
| `RULES_READINGS` | 2 | independent readings of a standard's rules, cross-checked |

**Keep the judge on `gpt-4.1-mini`.** A frontier model costs roughly 40× a run.
Dropping to nano breaks agreement with the answer key.

Every OpenRouter request sends `data_collection: deny` and is pinned to
`OPENROUTER_PROVIDERS` — one host, not a list, because the same prompt answered
by two different hosts is two slightly different answers, and a report that
changes between runs of an unchanged design is the exact complaint that setting
exists to avoid.

To A/B against the answer key without editing `.env`:

```bash
cd Workers
JUDGE_READINGS=1 ASSESS_CONCURRENCY=8 docker compose up -d analyse
```

Gemini (`LLM_PROVIDER=gemini`) and Anthropic (`LLM_PROVIDER=anthropic`, plus a
separate embeddings vendor — Anthropic has no embeddings endpoint) remain
supported. Without any key the pipeline still completes: figures are stored but
not described, chunks embed without a preamble, and both are recorded as ingest
issues rather than passing silently.

---

## 10. Gotchas that will cost you an hour

**1 · Pooled vs direct Postgres, in both directions.** The app wants pooled; the
workers and migrations want direct. Get it backwards and `prisma migrate` hangs
ten seconds then fails with `P1002 … Timed out trying to acquire a postgres
advisory lock`, which reads as a database outage when the database is perfectly
healthy. `scripts/check-migrate-url.mts` runs first and says so in those words.

**2 · Docker containers read `.env` only at creation.** Editing `Workers/.env`
and running `docker compose up` does nothing to already-created containers:

```bash
docker compose up -d --force-recreate
```

**3 · Run compose from `Workers/`.** `${PREFER_WHOLE_DOCUMENT}` and friends only
interpolate from `Workers/.env` when compose is invoked there. Run it elsewhere
and they resolve empty — and empty used to mean *on*, which read the whole design
into every single call: 11,134 input tokens × 382 calls, 84% of a $2.03 run, with
nothing anywhere saying it had happened. The compose file now states the safe
value in the fallback (`${PREFER_WHOLE_DOCUMENT:-off}`) rather than deferring.
The duplication with `.env` is deliberate.

**4 · `EMBEDDING_DIMS` must match the `vector(N)` column** (currently 1024) and
must be identical in both `.env` files. Search embeds its question in the app and
its chunks in the worker; a mismatch makes the vectors incomparable. The worker
asserts the match on the first batch rather than failing later with a confusing
insert error.

**5 · Changing the embedding model invalidates every stored vector.** Vectors are
only ever compared with vectors from the same model, so existing documents become
invisible to search. Run `python scripts/reembed.py` (dry run), then `--apply`
with the embed worker running, then `--drop-old` once it has finished.

**6 · There is a $20 ceiling on the OpenRouter account.** It has been spent
mid-run before, and the run still reported itself "complete". Check the balance
before a batch; don't trust a completion state to mean the money lasted.

**7 · A module-level wrapper is required for the LLM seam.** A client method with
no module-level wrapper in `Workers/aidp/ai/llm.py` is unreachable —
`review_covered` was dead for three commits before anyone noticed.

**8 · UI debugging: read the log first.** For anything in the Next.js app, read
`AIDP/.next/dev/logs/next-development.log` before theorising.

**9 · `useReducedMotion` cannot branch structurally.** It can't report the real
value until after mount without breaking hydration. Framer writes `opacity: 0` on
first render, and if the branch removes the props that would animate it back, the
content stays invisible forever. Vary the *transition*, not the element — see the
comments in `Reveal.tsx` and `Hero.tsx`.

---

## 11. Where to read next

In this order:

| Document | What it gives you |
|---|---|
| `AIDP/docs/product.md` | what the product is, who the users are, the open questions |
| `AIDP/docs/pipeline-design.md` | the ingestion pipeline's design decisions |
| `AIDP/docs/chunking.md` | why chunking is clause-atomic |
| `AIDP/docs/ingestion-plan.md` | parsing each input format |
| `AIDP/docs/build-plan.md` | phases and what belongs in each |
| `AIDP/README.md` | the app: auth, notifications, the landing page |
| `Workers/README.md` | the workers: layout, smoke tests, model providers |
| `AIDP-How-It-Works.pdf` | the client-facing explanation |

Then read, in the code:

- `Workers/aidp/stages/analyse.py` — the product, in one file
- `Workers/aidp/whole_document.py` — render, normalise, verify quotes
- `Workers/aidp/parsing/registers.py` — why a register is the trustworthy input
- `AIDP/src/lib/ingest/verdicts.ts` — how a verdict becomes a report row
- `AIDP/src/lib/access/roles.ts` — the authorisation model, in one place
- `AIDP/prisma/schema.prisma` — the doc comments are the design record

**A note on the comments.** This codebase explains *why* far more than *what*,
and the explanations are load-bearing — several encode a bug that was expensive
to find. If a comment and the code disagree, that is a finding worth reporting,
not noise to tidy.
