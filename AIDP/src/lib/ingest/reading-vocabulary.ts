/**
 * Which intake answers a design can be read for — no database, no server-only
 * imports.
 *
 * Split out for the reason given at the top of outcomes-vocabulary.ts: the
 * module that reaches Prisma cannot be imported by a client component without
 * failing the build with a chunking error that names the wrong file. The wizard
 * is a client component and needs the labels; the worker's reply is checked
 * against this same list on the server.
 *
 * ## Why this is a short list and not Group C
 *
 * Group C has eleven fields. Six of them are what a design document actually
 * states — the technologies, the integrations, the authentication, the data
 * stores and their classification, where it is hosted — and those are the six
 * the submission gate blocks on. The rest are yes/no questions about the
 * *change*, not about the architecture: whether a component is new to the
 * organisation, whether an existing one is being retired. A design says what it
 * uses; whether that is new here is a fact about the estate, which no design
 * document contains.
 *
 * Three of those questions are included all the same, because a design often
 * does say it outright — "replaces the Kong 2.8 cluster" — and under one rule:
 *
 * **A yes/no answer is only ever proposed as "yes".** Never as "no". A design
 * that does not mention retiring anything is not a design that retires nothing;
 * it is a design that did not say. Proposing "no" from silence would be the
 * tool inventing an answer, and it is the answer that keeps a category from
 * triggering — which is to say, the answer that quietly keeps a submission away
 * from a reviewer. `absent` is the hard verdict here exactly as it is in the
 * assessment engine.
 */

/** A field a reading may propose, and how it is stored. */
export type ReadableField =
  | "technologies"
  | "integrationPoints"
  | "authMechanism"
  | "dataStores"
  | "dataClassification"
  | "hostingEnvironment"
  | "newTechnologyComponent"
  | "replacesTechnologyComponent"
  | "newOrDuplicatedStorage";

export type FieldShape = "list" | "text" | "yes";

export const READABLE: Record<
  ReadableField,
  {
    /** How the wizard labels it, word for word, so the proposal and the box it
     *  fills read as the same question. */
    label: string;
    shape: FieldShape;
    /** What the model is told to look for. Sent in the prompt verbatim. */
    looksFor: string;
    /** The companion free-text field a "yes" carries, when it has one. */
    detail?: "newTechnologyComponentName" | "replacedTechnologyComponentName";
  }
> = {
  technologies: {
    label: "Technologies and platforms",
    shape: "list",
    looksFor:
      "every technology, platform, framework, database, broker, runtime and cloud " +
      "service the design says the solution is built on or runs on",
  },
  integrationPoints: {
    label: "Integration points and external systems",
    shape: "text",
    looksFor:
      "the external systems this solution talks to and how — the interfaces, APIs, " +
      "file transfers, queues and third parties named in the design",
  },
  authMechanism: {
    label: "Authentication and authorisation",
    shape: "text",
    looksFor:
      "how people and services are authenticated and what controls what they may do — " +
      "the protocol, the identity provider, the roles or scopes the design names",
  },
  dataStores: {
    label: "Data stores used",
    shape: "text",
    looksFor:
      "where the solution keeps data — the databases, caches, object stores, queues " +
      "and file shares the design names, and what each holds",
  },
  dataClassification: {
    label: "Data classification",
    shape: "text",
    looksFor:
      "the sensitivity the design gives the data it handles, in the organisation's own " +
      "words (for example Public, Internal, Confidential, Restricted, PII, cardholder data)",
  },
  hostingEnvironment: {
    label: "Hosting and deployment environment",
    shape: "text",
    looksFor:
      "where this runs and how it is deployed — the cloud, region, account, cluster, " +
      "data centre or tenancy the design names",
  },
  newTechnologyComponent: {
    label: "A new technology component is introduced",
    shape: "yes",
    detail: "newTechnologyComponentName",
    looksFor:
      "a statement that the design introduces, adopts or brings in a technology the " +
      "organisation does not already run",
  },
  replacesTechnologyComponent: {
    label: "An existing component is being replaced",
    shape: "yes",
    detail: "replacedTechnologyComponentName",
    looksFor:
      "a statement that the design replaces, retires, decommissions or migrates off an " +
      "existing technology or component",
  },
  newOrDuplicatedStorage: {
    label: "New or duplicated data storage is introduced",
    shape: "yes",
    looksFor:
      "a statement that the design stands up a new data store, or holds a second copy " +
      "of data that already lives somewhere else",
  },
};

export const READABLE_FIELDS = Object.keys(READABLE) as ReadableField[];

export function isReadableField(value: unknown): value is ReadableField {
  return typeof value === "string" && value in READABLE;
}

/**
 * One proposed answer, with the design's own words behind it.
 *
 * `quote` is not decoration. It is the only thing that makes a proposal
 * reviewable in the second it deserves: a requestor reading "Confidential"
 * beside "all customer records are classified Confidential (§4.2)" can accept
 * it without opening the document, and that is the whole saving. A proposal
 * whose quote could not be found in the design never reaches this type — see
 * the checks in Workers/aidp/request_intake.py.
 */
export type Proposal = {
  field: ReadableField;
  /** A list for "list", a sentence for "text", the detail or "" for "yes". */
  value: string[] | string;
  /** The design it was read from, so a reviewer knows which document said it. */
  documentId: string;
  documentTitle: string;
  /** Where in that design, as the report cites anything else. */
  section: string;
  page: number | null;
  quote: string;
};

export type ReadingState = "reading" | "ready" | "failed";

export function isReadingState(value: unknown): value is ReadingState {
  return value === "reading" || value === "ready" || value === "failed";
}

/** A proposal as the wizard fills a box with it. */
export function asFieldValue(proposal: Proposal): string {
  return Array.isArray(proposal.value) ? proposal.value.join(", ") : proposal.value;
}
