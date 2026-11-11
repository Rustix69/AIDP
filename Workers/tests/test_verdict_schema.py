"""Every field the judge is asked for is one it is allowed to answer.

A response schema says three things about a field: that it exists
(`properties`), that the model has to answer it (`required`), and where it sits
in the output (`propertyOrdering`). Nothing checked that the three agreed, and
both judge schemas had fallen out of step in opposite directions:

  · `_DOCUMENT_VERDICT_SCHEMA` named "obligation" in `required` and
    `propertyOrdering` but never declared it. `_strict_schema` rebuilds
    `required` from `properties`, so the field was dropped from the request
    rather than rejected, and every clause on a whole-document run came back
    "unstated". Severity grades on (verdict, obligation) and nothing else, so a
    breached "shall" and a breached "may" arrived at a reviewer identically.

  · `_VERDICT_SCHEMA` had the mirror of it — declared, but absent from both
    lists. On the Gemini path the dict is passed through as `responseSchema`
    verbatim, so the model was free to omit it.

Neither failed loudly. Both produced a complete, confident, well-evidenced run
with one column quietly empty, which is the worst way for a bug to behave.

What this proves:

  · the three lists agree, in every schema in the module and in nested objects
    too, so the next schema to drift fails here instead of in a client demo;
  · "obligation" specifically survives `_strict_schema`, which is the transform
    that silently dropped it.

No database, no model, no network.

    python tests/test_verdict_schema.py
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from aidp.ai import llm  # noqa: E402

passed = 0
failed = 0


def ok(name: str, condition: bool, extra: object = "") -> None:
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS {name}")
    else:
        failed += 1
        print(f"  FAIL {name}", extra)


def objects(schema: object, path: str = ""):
    """Every object node in a schema, including nested ones."""
    if not isinstance(schema, dict):
        return
    if isinstance(schema.get("properties"), dict):
        yield path or ".", schema
        for key, child in schema["properties"].items():
            yield from objects(child, f"{path}.{key}")
    if isinstance(schema.get("items"), dict):
        yield from objects(schema["items"], f"{path}[]")


SCHEMAS = {
    name: getattr(llm, name)
    for name in dir(llm)
    if name.endswith("_SCHEMA") and isinstance(getattr(llm, name), dict)
}

print("\nEvery schema in the module is internally consistent")
ok("there are schemas to check", len(SCHEMAS) > 5, len(SCHEMAS))

for name, schema in sorted(SCHEMAS.items()):
    for path, node in objects(schema, name):
        declared = set(node["properties"])
        required = list(node.get("required") or [])
        ordering = list(node.get("propertyOrdering") or [])

        undeclared_required = [f for f in required if f not in declared]
        ok(
            f"{path}: every required field is declared",
            not undeclared_required,
            undeclared_required,
        )

        undeclared_ordered = [f for f in ordering if f not in declared]
        ok(
            f"{path}: every ordered field is declared",
            not undeclared_ordered,
            undeclared_ordered,
        )

        # Strict mode answers every declared field, so a property nobody asked
        # for is either dead weight or a field the model will not fill in.
        unasked = [f for f in declared if f not in required]
        ok(f"{path}: every declared field is required", not unasked, unasked)

print("\nObligation specifically — the field that went missing")
for name in ("_VERDICT_SCHEMA", "_DOCUMENT_VERDICT_SCHEMA"):
    schema = SCHEMAS[name]
    ok(f"{name} declares it", "obligation" in schema["properties"])
    ok(f"{name} requires it", "obligation" in schema["required"])
    ok(f"{name} orders it", "obligation" in schema["propertyOrdering"])
    ok(
        f"{name} offers unstated as an answer",
        "unstated" in schema["properties"]["obligation"]["enum"],
    )
    strict = llm._strict_schema(schema)
    ok(
        f"{name} keeps it through _strict_schema",
        "obligation" in strict.get("properties", {})
        and "obligation" in strict.get("required", []),
    )

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
