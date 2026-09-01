/* The package catalogue, and the accounts that predate it.

   What these protect: an account that bought a package under its old name
   keeps the access it paid for; a retired id never grants something it did not
   buy; the catalogue only contains ids that can actually be granted; and the
   stored record is never rewritten by the migration, so it keeps saying what
   was really sold. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const acc = await import("./_accounts.js");
const ent = await import("../src/entitlements.js");

let failures = 0;
function test(name, fn) {
  __resetMemory();
  try {
    fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

test("three packages, and every one of them is grantable", () => {
  assert.deepEqual(acc.FEATURES, ["assistant", "operations", "costs"]);
});

test("the old bill-scan package becomes the costs package", () => {
  assert.deepEqual(acc.normaliseFeatures(["billscan"]), ["costs"]);
  assert.deepEqual(ent.normaliseFeatures(["billscan"]), ["costs"]);
});

test("menu and forecast fold into costs, where their screens now live", () => {
  assert.deepEqual(acc.normaliseFeatures(["menu", "forecast"]), ["costs"]);
});

test("hardware grants nothing, because it never gated a screen", () => {
  assert.deepEqual(acc.normaliseFeatures(["pos_hardware"]), []);
  assert.deepEqual(ent.normaliseFeatures(["pos_hardware"]), []);
});

test("a legacy id and its new name do not become two entries", () => {
  assert.deepEqual(acc.normaliseFeatures(["billscan", "costs"]), ["costs"]);
  assert.deepEqual(acc.normaliseFeatures(["costs", "billscan"]), ["costs"]);
});

test("current ids pass through untouched", () => {
  assert.deepEqual(
    acc.normaliseFeatures(["assistant", "operations", "costs"]),
    ["assistant", "operations", "costs"],
  );
});

test("an unknown id is kept rather than silently dropped", () => {
  /* Dropping it would hide a typo in a grant. It grants nothing either way,
     since every gate checks for a specific id. */
  assert.deepEqual(acc.normaliseFeatures(["something_else"]), ["something_else"]);
});

test("the migration does not rewrite what it was given", () => {
  const stored = ["billscan", "pos_hardware"];
  acc.normaliseFeatures(stored);
  assert.deepEqual(stored, ["billscan", "pos_hardware"],
    "the account's record still says what was actually sold");
});

test("an account holding only the old id is still active", () => {
  const account = { plan: { items: ["billscan"], until: Date.now() + 864e5 } };
  const items = acc.activeItems(account);
  assert.ok(items.includes("costs"), "the package they paid for still resolves");
  assert.ok(items.includes("table"), "the free tier is always there");
});

test("expiry still closes a legacy plan", () => {
  const account = { plan: { items: ["billscan"], until: Date.now() - 1 } };
  assert.deepEqual(acc.activeItems(account), ["table"]);
});

test("every screen gate names a package that exists", () => {
  const sellable = new Set([...acc.FEATURES, ...acc.FREE_FEATURES, null]);
  for (const [screen, feature] of Object.entries(ent.SCREEN_FEATURE)) {
    assert.ok(sellable.has(feature), `${screen} is gated on "${feature}", which cannot be granted`);
  }
});

test("both migration maps agree", () => {
  /* The server decides access and the client decides which tabs to draw. If
     they disagree, a screen is either drawn and then refused, or hidden while
     the account holds it. */
  for (const id of ["billscan", "menu", "forecast", "pos_hardware", "assistant", "operations", "costs"]) {
    assert.deepEqual(acc.normaliseFeatures([id]), ent.normaliseFeatures([id]), id);
  }
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
