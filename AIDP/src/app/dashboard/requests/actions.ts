"use server";

import { revalidatePath } from "next/cache";
import { NoAccess, requireAccess } from "@/lib/access/gate";
import {
  RequestRefused,
  createRequest,
  markDiagram,
  startAssessment,
  submitRequest,
  updateRequest,
  type UpdateInput,
} from "@/lib/ingest/requests";
import { advanceSubmitted } from "@/lib/ingest/requests";
import {
  ReadingRefused,
  acceptProposals,
  discardReading,
  startReading,
} from "@/lib/ingest/reading";

/**
 * Server Actions accept direct POSTs, so `requireAccess` in each of these is
 * the access control — the layout's check does not run in front of one.
 * Everything else about who may do what lives in the library beside the rule
 * it enforces, exactly as it does for projects.
 */

export type RequestResult = { ok: boolean; message: string; id?: string };

async function run(
  work: (access: Awaited<ReturnType<typeof requireAccess>>) => Promise<RequestResult>,
): Promise<RequestResult> {
  try {
    const access = await requireAccess();
    const result = await work(access);
    revalidatePath("/dashboard/requests");
    return result;
  } catch (error) {
    if (error instanceof RequestRefused) return { ok: false, message: error.message };
    if (error instanceof ReadingRefused) return { ok: false, message: error.message };
    if (error instanceof NoAccess) return { ok: false, message: error.message };
    return { ok: false, message: "That did not work. Try again." };
  }
}

export async function newRequest(form: FormData): Promise<RequestResult> {
  return run(async (access) => {
    const created = await createRequest(access, {
      title: String(form.get("title") ?? ""),
      summary: String(form.get("summary") ?? ""),
    });
    return {
      ok: true,
      id: created.id,
      message: `${created.reference} opened. Fill it in and submit it when it is ready.`,
    };
  });
}

/**
 * Save one step of the wizard.
 *
 * Takes the fields that step carries and nothing else. A field the step does
 * not mention is left alone rather than blanked — see `updateRequest`, which is
 * where that rule is enforced and tested.
 */
export async function saveRequest(id: string, input: UpdateInput): Promise<RequestResult> {
  return run(async (access) => {
    await updateRequest(access, id, input);
    revalidatePath(`/dashboard/requests/${id}`);
    return { ok: true, message: "Saved." };
  });
}

/**
 * Submit it: render the answers, take the document in, and let it index.
 *
 * The assessment is not started here, and no longer starts by itself once the
 * indexing finishes either — somebody presses "Start assessing". What this
 * owes the person watching the screen is an honest account of where their
 * request now is, which is "being read".
 *
 * `advanceSubmitted` is called once anyway, for the case that would otherwise
 * look broken: a resubmission whose documents were already indexed by an
 * earlier attempt, which would sit in "submitted" with no button until the
 * next sweep came past.
 */
export async function submit(id: string): Promise<RequestResult> {
  return run(async (access) => {
    const { reference } = await submitRequest(access, id);
    await advanceSubmitted({ organisationId: access.organisation.id });
    revalidatePath(`/dashboard/requests/${id}`);
    return {
      ok: true,
      message: `${reference} submitted. It can be assessed once its documents have been read.`,
    };
  });
}

/**
 * Open the assessment, because somebody pressed the button.
 *
 * Separate from `submit` on purpose. Submitting says "these are my answers and
 * these are my designs"; this says "read them now". They were one step while
 * the only thing assessed was the rendered form, and came apart when the
 * designs moved inside the request — see `startAssessment`, which holds the
 * reasoning and every refusal.
 */
export async function startAssessing(id: string): Promise<RequestResult> {
  return run(async (access) => {
    const { scope } = await startAssessment(access, id);
    revalidatePath(`/dashboard/requests/${id}`);
    return { ok: true, message: `Assessing ${scope}.` };
  });
}

/**
 * Nominate one of the attached designs as the architecture diagram, or clear it.
 *
 * The brief's Group B, and the answer the Group C rule turns on. A nomination
 * rather than a guess: see `markDiagram`.
 */
export async function setDiagram(
  id: string,
  documentId: string | null,
): Promise<RequestResult> {
  return run(async (access) => {
    await markDiagram(access, id, documentId);
    revalidatePath(`/dashboard/requests/${id}`);
    return {
      ok: true,
      message: documentId
        ? "Marked as the architecture diagram."
        : "No longer marked as the architecture diagram.",
    };
  });
}

/**
 * Read the attached designs for the answers this form is about to ask for.
 *
 * Queues the work and returns; the wizard polls the request page for the
 * result, as the document library polls a parse. Nothing is written to the
 * request here — see reading.ts for why a reading proposes and a person
 * accepts.
 */
export async function readDesigns(id: string): Promise<RequestResult> {
  return run(async (access) => {
    const { designs } = await startReading(access, id);
    revalidatePath(`/dashboard/requests/${id}`);
    return {
      ok: true,
      message:
        designs === 1
          ? "Reading your design for the answers below."
          : `Reading your ${designs} designs for the answers below.`,
    };
  });
}

/** Write the proposals the requestor agreed with onto the request. */
export async function acceptAnswers(
  id: string,
  fields: string[],
): Promise<RequestResult> {
  return run(async (access) => {
    const { accepted } = await acceptProposals(access, id, fields);
    revalidatePath(`/dashboard/requests/${id}`);
    return {
      ok: true,
      message:
        accepted.length === 1 ? "Answer filled in." : `${accepted.length} answers filled in.`,
    };
  });
}

/** Throw the reading away and answer the questions by hand. */
export async function dismissReading(id: string): Promise<RequestResult> {
  return run(async (access) => {
    await discardReading(access, id);
    revalidatePath(`/dashboard/requests/${id}`);
    return { ok: true, message: "Reading discarded." };
  });
}
