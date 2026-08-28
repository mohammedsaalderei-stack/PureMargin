/* Sorting an uploaded document.

   What these protect: a kind maps to one fixed destination rather than one the
   model chose; an unrecognised or low-confidence answer is treated as unplaced
   rather than pushed at the nearest screen; and a destination the caller has
   no capability for is marked closed rather than routed to. */

import assert from "node:assert/strict";
import { KINDS, KIND_KEYS, routeFor, normaliseVerdict, classifyPrompt } from "./_docroute.js";

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const ALL = ["view:dashboard", "manage:inventory", "manage:recipes", "view:profitability"];

test("every kind names a tab, a scanner and a capability", () => {
  for (const key of KIND_KEYS) {
    const k = KINDS[key];
    assert.ok(k.tab && k.scanner && k.needs, `${key} is incomplete`);
  }
});

test("a supplier document goes to inventory, not to costs", () => {
  const r = routeFor("supplier", ALL);
  assert.equal(r.tab, "inventory");
  assert.equal(r.scanner, "supplier");
});

test("a customer bill goes to costs, not to inventory", () => {
  const r = routeFor("bill", ALL);
  assert.equal(r.tab, "costs");
  assert.equal(r.scanner, "bill");
});

test("a recipe goes to recipes", () => {
  assert.equal(routeFor("recipe", ALL).tab, "recipes");
});

test("a stock take goes to inventory but to the shelf scanner", () => {
  const r = routeFor("inventory", ALL);
  assert.equal(r.tab, "inventory");
  assert.equal(r.scanner, "inventory", "a count is not a delivery");
});

test("an unknown kind routes nowhere", () => {
  const r = routeFor("unknown", ALL);
  assert.equal(r.allowed, false);
  assert.equal(r.tab, undefined);
});

test("a kind the model invented routes nowhere", () => {
  assert.equal(routeFor("purchase_order_maybe", ALL).allowed, false);
});

test("a destination the caller cannot use is marked closed", () => {
  const cashier = ["view:dashboard"];
  assert.equal(routeFor("bill", cashier).allowed, true, "a cashier may price a bill");
  assert.equal(routeFor("supplier", cashier).allowed, false,
    "a cashier may photograph a delivery note but not receive it");
  assert.equal(routeFor("recipe", cashier).allowed, false);
});

test("someone with no capabilities is routed nowhere", () => {
  for (const key of KIND_KEYS) assert.equal(routeFor(key, []).allowed, false);
});

test("a high-confidence verdict is certain", () => {
  const v = normaliseVerdict({ kind: "supplier", confidence: "high", why: "has an invoice number" });
  assert.equal(v.kind, "supplier");
  assert.equal(v.certain, true);
});

test("a medium or low confidence verdict is not certain", () => {
  for (const c of ["medium", "low"]) {
    assert.equal(normaliseVerdict({ kind: "supplier", confidence: c }).certain, false,
      `${c} confidence must be offered, not acted on`);
  }
});

test("an unknown kind is never certain, whatever the confidence says", () => {
  assert.equal(normaliseVerdict({ kind: "unknown", confidence: "high" }).certain, false);
});

test("a kind outside the list becomes unknown", () => {
  assert.equal(normaliseVerdict({ kind: "invoice-ish", confidence: "high" }).kind, "unknown");
});

test("a missing confidence is treated as low", () => {
  assert.equal(normaliseVerdict({ kind: "recipe" }).confidence, "low");
  assert.equal(normaliseVerdict({ kind: "recipe" }).certain, false);
});

test("a junk response does not crash", () => {
  for (const junk of [null, undefined, {}, { kind: 5 }, "nonsense"]) {
    const v = normaliseVerdict(junk);
    assert.equal(v.kind, "unknown");
    assert.equal(v.certain, false);
  }
});

test("the page count defaults to one rather than zero", () => {
  assert.equal(normaliseVerdict({ kind: "bill", pages: 0 }).pages, 1);
  assert.equal(normaliseVerdict({ kind: "bill", pages: 3 }).pages, 3);
});

test("the explanation is kept but bounded", () => {
  const v = normaliseVerdict({ kind: "bill", why: "x".repeat(500) });
  assert.ok(v.why.length <= 200);
});

test("the prompt tells the model to say unknown when unsure", () => {
  const p = classifyPrompt("");
  assert.match(p, /unknown/);
  assert.match(p, /supplier against bill/i,
    "the pair most easily confused has to be called out explicitly");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
