/* What the assistant is allowed to know, per person.

   What these protect: figures somebody may not see are removed before the
   model is called rather than after, because asking a model to keep a secret
   it has been handed is a request and not a control; the redaction reaches
   nested structures, since the context is assembled from several sources; and
   a caller that knows nothing about capabilities still sees everything. */

import assert from "node:assert/strict";
import { redactContext, redactionNote } from "./_askscope.js";

let failures = 0;
function test(name, fn) {
  try { fn(); console.log("  ok ", name); }
  catch (err) { failures += 1; console.error("  FAIL", name, "\n       ", err.message); }
}

const CONTEXT = {
  sales: 12000,
  orders: 340,
  marginPct: 62,
  netProfit: 4100,
  items: [
    { name: "Shawarma", qty: 90, revenue: 1800, cost: 700, margin: 1100 },
    { name: "Tea", qty: 200, revenue: 800, cost: 100, margin: 700 },
  ],
  branches: { b1: { sales: 6000, profit: 2000 } },
};

const CASHIER = ["view:dashboard"];
const MANAGER = ["view:dashboard", "view:costs", "view:profitability"];

test("a cashier's context keeps sales and loses margin", () => {
  const out = redactContext(CONTEXT, CASHIER);
  assert.equal(out.sales, 12000);
  assert.equal(out.orders, 340);
  assert.equal(out.marginPct, undefined);
  assert.equal(out.netProfit, undefined);
});

test("redaction reaches inside arrays", () => {
  const out = redactContext(CONTEXT, CASHIER);
  assert.equal(out.items[0].qty, 90, "what sold is theirs to see");
  assert.equal(out.items[0].cost, undefined);
  assert.equal(out.items[0].margin, undefined);
});

test("redaction reaches nested objects", () => {
  const out = redactContext(CONTEXT, CASHIER);
  assert.equal(out.branches.b1.sales, 6000);
  assert.equal(out.branches.b1.profit, undefined);
});

test("a manager keeps everything", () => {
  const out = redactContext(CONTEXT, MANAGER);
  assert.equal(out.marginPct, 62);
  assert.equal(out.items[0].cost, 700);
});

test("costs and margins are separate permissions", () => {
  const out = redactContext(CONTEXT, ["view:dashboard", "view:costs"]);
  assert.equal(out.items[0].cost, 700, "may see what it cost");
  assert.equal(out.items[0].margin, undefined, "but not what it earned");
});

test("no capabilities given means unrestricted", () => {
  assert.deepEqual(redactContext(CONTEXT, undefined), CONTEXT);
});

test("an empty capability list is a person with none, not an absent caller", () => {
  const out = redactContext(CONTEXT, []);
  assert.equal(out.marginPct, undefined);
  assert.equal(out.sales, 12000);
});

test("the prompt is told what was withheld", () => {
  const note = redactionNote(CASHIER);
  assert.match(note, /margins/);
  assert.match(note.replace(/\s+/g, " "), /do not estimate/i,
    "silence about a gap invites a guess");
});

test("nothing is said when nothing was withheld", () => {
  assert.equal(redactionNote(MANAGER), "");
  assert.equal(redactionNote(undefined), "");
});

test("redaction does not mutate what it was given", () => {
  const before = JSON.stringify(CONTEXT);
  redactContext(CONTEXT, CASHIER);
  assert.equal(JSON.stringify(CONTEXT), before);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
