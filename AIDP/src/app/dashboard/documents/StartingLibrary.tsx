"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookMarked, Check, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { seedLibrary } from "./actions";

export type Offer = {
  key: string;
  title: string;
  /** How many standards the register holds, so the offer is a quantity rather
   *  than a promise. */
  standards: number;
  /** True where this organisation already holds our copy of it. */
  held: boolean;
};

/**
 * The way in, for a customer whose library is empty.
 *
 * Nothing in this product works without reference standards: `resolveFramework`
 * refuses to start an assessment with none, so a new workspace's first
 * experience was a screen that explained what standards are for and gave no way
 * to get any. The six registers had to be found as files and uploaded by hand.
 *
 * It is an offer rather than a default. A company that has its own standards
 * should not have to delete a hundred and forty-five clauses of ours before
 * they can use their own, and a library seeded behind their back is one they
 * never chose — so the two paths are stated side by side and neither happens
 * until somebody picks.
 *
 * Shown in two shapes. Empty library: the whole panel, because there is nothing
 * else on the screen and the choice is the screen. Library with something in it
 * but missing some of ours: one quiet line, because by then they have made
 * their choice and this is only a way back to a register they removed.
 *
 * The server action is the access control. This is only shown to an
 * administrator so that a control which would be refused is not offered.
 */
export function StartingLibrary({ offers, compact }: { offers: Offer[]; compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Only ever offers what is missing. Pressing it is still safe if one arrives
  // in between — seeding is content-addressed and resolves to what is already
  // there — but offering a register they hold would read as a mistake.
  const missing = offers.filter((o) => !o.held);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(missing.map((o) => o.key)));

  const add = (keys: string[]) =>
    startTransition(async () => {
      const result = await seedLibrary(keys);
      setMessage(result.message);
      router.refresh();
    });

  if (!missing.length) return null;

  const total = missing
    .filter((o) => chosen.has(o.key))
    .reduce((sum, o) => sum + o.standards, 0);

  if (message) {
    return (
      <p
        role="status"
        className="mb-4 rounded-xl border border-line bg-card px-4 py-3 text-[12.5px] text-ink/78"
      >
        {message}
      </p>
    );
  }

  // ---- the quiet shape: they already have a library of their own ----------
  if (compact || dismissed) {
    return (
      <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink/58">
        <Plus size={13} aria-hidden="true" className="text-ink/40" />
        {/* Two different situations, and the first one matters: a customer
            reading this already has standards on the shelf. Adding ours does
            not replace theirs — `resolveFramework` takes every ready reference
            document — so designs would be checked against both. Saying "start
            from our library" to somebody who has already started is both wrong
            and an invitation to double every finding. */}
        <span>
          {missing.length === offers.length
            ? `Our own standards library is available — ${offers.length} registers, ${offers.reduce(
                (sum, o) => sum + o.standards,
                0,
              )} rules. Designs would be checked against ours as well as yours.`
            : `${missing.length} register${missing.length === 1 ? "" : "s"} from our standards library ${
                missing.length === 1 ? "is" : "are"
              } not in your library.`}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => add(missing.map((o) => o.key))}
          className="font-medium text-royal underline underline-offset-2 hover:text-royal-mid disabled:opacity-50"
        >
          {pending
            ? "Adding…"
            : missing.length === offers.length
              ? "Add it"
              : `Add the missing ${missing.length === 1 ? "one" : "ones"}`}
        </button>
      </p>
    );
  }

  // ---- the full shape: an empty library ----------------------------------
  return (
    <section className="mb-5 rounded-2xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-royal-mid/30 bg-royal/10 text-royal">
          <BookMarked size={16} strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[14px] font-medium text-ink/92">Start with a standards library</h2>
          <p className="mt-0.5 max-w-prose text-[12.5px] text-ink/64">
            Nothing can be assessed until there are standards to assess against. Take ours as a
            starting point — they are generic, and you can edit or remove any of them — or upload
            your own and skip this.
          </p>
        </div>
      </div>

      <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
        {offers.map((offer) => {
          const picked = chosen.has(offer.key);
          return (
            <li key={offer.key}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[12.5px] transition-colors",
                  offer.held
                    ? "cursor-default border-line bg-page/40 text-ink/48"
                    : picked
                      ? "border-royal-mid/40 bg-royal/5 text-ink/88"
                      : "border-line text-ink/70 hover:border-line-strong",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={offer.held || picked}
                  disabled={offer.held || pending}
                  onChange={() =>
                    setChosen((was) => {
                      const next = new Set(was);
                      if (next.has(offer.key)) next.delete(offer.key);
                      else next.add(offer.key);
                      return next;
                    })
                  }
                />
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded border",
                    offer.held || picked
                      ? "border-royal-mid bg-royal-mid text-white"
                      : "border-line-strong",
                  )}
                >
                  {(offer.held || picked) && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate">{offer.title}</span>
                <span className="shrink-0 tabular-nums text-ink/48">
                  {offer.held ? "in your library" : offer.standards}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending || chosen.size === 0}
          onClick={() => add([...chosen])}
          className={cn(
            "rounded-lg bg-royal px-3.5 py-2 text-[12.5px] font-medium text-white transition-colors",
            "hover:bg-royal-mid disabled:opacity-50",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-royal-mid",
          )}
        >
          {pending
            ? "Adding…"
            : chosen.size === 0
              ? "Choose at least one"
              : `Add ${chosen.size} standard${chosen.size === 1 ? "" : "s"} · ${total} rules`}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setDismissed(true)}
          className="text-[12.5px] text-ink/60 underline underline-offset-2 hover:text-ink/80 disabled:opacity-50"
        >
          I&rsquo;ll upload my own
        </button>
      </div>
    </section>
  );
}
