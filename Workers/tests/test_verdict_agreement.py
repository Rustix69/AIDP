"""One verdict out of several readings, so a report says the same thing twice.

The engine's answer on a clause was one model call. A model does not answer the
same question the same way twice, and this is not a theoretical worry — it is
recorded in advice.py's own docstring, which is why the suggestions are cached:
two runs over one unchanged design came back 9 absent and 4 needing review, then
7 and 7.

For a tool whose output goes to an architecture review board, that is the whole
of its credibility. Everything else the engine does to earn trust — the quote
verification, the evidence guards, the obligation it will not invent — is spent
the moment a reviewer re-runs an assessment to show their manager and is handed
a different report.

So a clause is read more than once and the readings are voted on, which is what
`coverage.agree` has always done for the parts of a design no clause governs,
and for exactly this reason.

What this holds in place:

  · readings stop as soon as two agree, so the ordinary clause costs two and
    only a contested one costs three;
  · the readings are genuinely separate opinions — the first pinned, the rest
    sampled on their own seeds — because a vote between identical draws is one
    opinion counted three times;
  · a majority wins and the minority is kept, never discarded: a dissenting
    "contradicts" under a majority "covered" is the most useful line on the
    page for whoever signs the report off;
  · no majority is not a verdict. Three readings and three answers goes to a
    person, saying so, rather than picking a winner by arrival order;
  · one reading failing costs that reading, not the clause;
  · every reading failing is `needs_review`, never a pass;
  · quota exhaustion is re-raised and never written as a verdict, because a run
    that swallowed it would write a hundred unjudgeable clauses and then report
    itself complete.

No database and no model: every reading here is a function this test supplies.

    docker run --rm -v "$PWD":/w -w /w -e STAGE=analyse \\
      -e DATABASE_URL=postgresql://nobody@127.0.0.1:1/none \\
      --entrypoint python aidp-worker-test tests/test_verdict_agreement.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp.ai import llm  # noqa: E402
from aidp.stages import analyse  # noqa: E402

passed = 0
failed = 0


def ok(name: str, condition: bool, extra: object = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  ok   {name}")
    else:
        failed += 1
        print(f"  FAIL {name}", extra)


def reading(verdict: str, confidence: float = 0.8, rationale: str = "because.") -> analyse._Judged:
    return analyse._Judged(verdict, confidence, rationale, [{"chunkId": "x"}], [], 0.5)


# ---------------------------------------------------------------------------
print("\nReadings stop as soon as two of them agree")

ok("one reading has nothing to agree with", analyse._settled([reading("covered")], 3) is False)
ok(
    "two that agree are settled, out of three",
    analyse._settled([reading("covered"), reading("covered")], 3) is True,
)
ok(
    "two that disagree are not",
    analyse._settled([reading("covered"), reading("absent")], 3) is False,
)
ok("and no readings at all are not", analyse._settled([], 3) is False)
ok(
    "a 2-1 lead with nothing left to come is settled",
    analyse._settled([reading("covered"), reading("covered"), reading("absent")], 3) is True,
)

# The bug this replaced: stopping at any two agreeing made a configured five
# readings behave as three, so the setting looked like it was doing something
# while changing almost nothing — and two measurements of the same algorithm
# got read as a trend. The stop has to be read against the budget.
ok(
    "two agreeing out of FIVE is not settled — three more could overturn it",
    analyse._settled([reading("covered"), reading("covered")], 5) is False,
)
ok(
    "three agreeing out of five is, because two cannot catch three",
    analyse._settled([reading("covered")] * 3, 5) is True,
)
ok(
    "but 2-1 out of five is not",
    analyse._settled([reading("covered"), reading("covered"), reading("absent")], 5) is False,
)
ok(
    "and one reading is settled when one is all that was asked for",
    analyse._settled([reading("covered")], 1) is False,
)

seen: list[int] = []


def counting(verdict: str):
    def once(index: int) -> analyse._Judged:
        seen.append(index)
        return reading(verdict)

    return once


seen.clear()
analyse._read_and_vote(counting("covered"), 3, best=0.4, clause={"id": "c1"})
ok("an uncontested clause costs two readings, not three", seen == [0, 1], seen)

seen.clear()
analyse._read_and_vote(counting("covered"), 5, best=0.4, clause={"id": "c1"})
ok("asking for five takes a real majority of five, not two", seen == [0, 1, 2], seen)

seen.clear()
analyse._read_and_vote(counting("covered"), 1, best=0.4, clause={"id": "c1"})
ok("asking for one still takes exactly one", seen == [0], seen)


# ---------------------------------------------------------------------------
print("\nThe readings are separate opinions, not one opinion billed three times")

first = llm.judge_sampling(0)
ok("the first reading is pinned", first == (0.0, llm._SEED), first)
rest = [llm.judge_sampling(n) for n in (1, 2, 3)]
ok("the rest are sampled", all(temperature > 0 for temperature, _ in rest), rest)
ok(
    "and each is drawn on a seed of its own",
    len({seed for _, seed in rest}) == 3 and all(seed != first[1] for _, seed in rest),
    rest,
)


# ---------------------------------------------------------------------------
print("\nWhat the readings decide")

unanimous = analyse._vote([reading("covered", 0.7), reading("covered", 0.9, "the sharper one.")])
ok("agreement keeps the verdict", unanimous.verdict == "covered")
ok("and says how many readings reached it", (unanimous.readings, unanimous.agreed) == (2, 2))
ok("the surest reading carries the wording", unanimous.rationale == "the sharper one.")
ok("with nothing dissenting", unanimous.dissent == [])

majority = analyse._vote(
    [reading("covered", 0.9), reading("partial", 0.6, "half of it."), reading("covered", 0.7)]
)
ok("two readings of three carry the verdict", majority.verdict == "covered")
ok("the count is recorded honestly", (majority.readings, majority.agreed) == (3, 2))
ok(
    "and the reading that disagreed is kept, not discarded",
    majority.dissent == [{"verdict": "partial", "rationale": "half of it."}],
    majority.dissent,
)

split = analyse._vote([reading("covered"), reading("partial"), reading("absent")])
ok("three answers from three readings is not a verdict", split.verdict == "needs_review")
ok("and the rationale says that is what happened", "no answer in the majority" in split.rationale)
ok("every other reading is on the record", len(split.dissent) == 2, split.dissent)

alone = reading("absent", 0.9)
ok("a single reading is passed through untouched", analyse._vote([alone]) is alone)
ok(
    "and a finding from before this existed still reads as one reading agreeing with itself",
    (alone.readings, alone.agreed, alone.dissent) == (1, 1, []),
)

# A demoted reading votes for the demotion. The guards are part of the verdict,
# not a filter over it, so two readings the evidence did not support must not be
# outvoted by one that the guards would have refused.
guarded = analyse._vote(
    [reading("needs_review"), reading("needs_review"), reading("covered", 0.99)]
)
ok("a confident reading cannot outvote two the guards demoted", guarded.verdict == "needs_review")


# ---------------------------------------------------------------------------
print("\nA reading that fails costs that reading, not the clause")

attempts: list[int] = []


def flaky(index: int) -> analyse._Judged:
    attempts.append(index)
    if index == 0:
        raise RuntimeError("provider 500")
    return reading("partial")


voted = analyse._read_and_vote(flaky, 3, best=0.4, clause={"id": "c1"})
ok("the surviving readings still reach a verdict", voted.verdict == "partial")
ok("and the failed one did not stop the rest being taken", attempts == [0, 1, 2], attempts)


def dead(index: int) -> analyse._Judged:
    raise RuntimeError("nothing usable came back")


lost = analyse._read_and_vote(dead, 3, best=0.4, clause={"id": "c1"})
ok("every reading failing is needs_review", lost.verdict == "needs_review")
ok("never a pass", lost.verdict not in ("covered", "not_applicable"))
ok("and it says nothing is implied about the design", "could not be read" in lost.rationale)
ok("with no evidence behind it", lost.evidence == [])


def spent(index: int) -> analyse._Judged:
    raise llm.QuotaExhausted("out of credit")


try:
    analyse._read_and_vote(spent, 3, best=0.0, clause={"id": "c1"})
    ok("quota exhaustion is re-raised rather than written as a verdict", False)
except llm.QuotaExhausted:
    ok("quota exhaustion is re-raised rather than written as a verdict", True)


# ---------------------------------------------------------------------------
print("\nThe vote reaches the finding")

write_src = __import__("inspect").getsource(analyse._write)
for column in ("readings", "agreed", "dissent"):
    ok(f'"{column}" is written with the finding', f'"{column}"' in write_src)
    ok(f'and "{column}" is kept current when a clause is judged again', f'"{column}" = EXCLUDED' in write_src)


print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
