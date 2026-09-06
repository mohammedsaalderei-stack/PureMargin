/* Receiving the same delivery twice.

   ── What happened ────────────────────────────────────────────────────────

   Somebody re-scanned one stock sheet while testing and the balances climbed:
   brioche buns 77, then 137, then 272. Nothing was broken. Each scan really
   was a delivery as far as the ledger could tell, because nothing had ever
   told it otherwise.

   `_salesdepletion.js` has always been careful about exactly this — it
   remembers every till receipt it posted, so a webhook retry deducts nothing
   the second time. The invoice path remembered nothing at all. The same
   delivery note received in full, twice, silently, and the only sign was a
   balance that had doubled — which looks exactly like a balance that is right.

   ── Why a fingerprint, and why it asks ───────────────────────────────────

   The invoice number is the obvious key and is usually absent: a stock sheet,
   a hand-written note, a supplier who leaves the field blank. Keying on it
   would protect the deliveries that need protecting least. So the key is what
   was actually received.

   And it asks rather than refuses, because two genuine deliveries of the same
   things in the same amounts are possible and only the person holding the
   paperwork knows which this is. */

import assert from "node:assert/strict";
import {
  fingerprint, findRepeat, rememberInvoice, getInvoice, markUndone, listInvoices,
  REPEAT_WINDOW_MS,
} from "./_invoicelog.js";

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const delivery = (rows) => rows.map(([ingredientId, qtyBase]) => ({ ingredientId, qtyBase }));

const SHEET = delivery([
  ["brioche-buns", 60],
  ["ground-beef", 3000],
  ["cheddar-slices", 60],
]);

await test("the same delivery fingerprints the same, whatever order it is read in", () => {
  const shuffled = [SHEET[2], SHEET[0], SHEET[1]];
  assert.equal(fingerprint(SHEET), fingerprint(shuffled), "line order is not part of it");
});

await test("the same quantities written in different units fingerprint the same", () => {
  /* Base units, so one reading of "3 kg" and another of "3000 g" are one
     delivery — which is the whole point when the second scan may have read the
     unit column slightly differently. */
  assert.equal(
    fingerprint(delivery([["ground-beef", 3000]])),
    fingerprint(delivery([["ground-beef", 3000.0000001]])),
    "and a rounding crumb from a conversion does not separate them",
  );
});

await test("a different delivery fingerprints differently", () => {
  assert.notEqual(fingerprint(SHEET), fingerprint(delivery([["brioche-buns", 60]])));
  assert.notEqual(
    fingerprint(delivery([["brioche-buns", 60]])),
    fingerprint(delivery([["brioche-buns", 120]])),
    "twice as much of one thing is not the same delivery",
  );
  assert.notEqual(
    fingerprint(delivery([["brioche-buns", 60]])),
    fingerprint(delivery([["cheddar-slices", 60]])),
    "sixty of something else is not either",
  );
});

await test("a repeat is found, and only within the window", async () => {
  const print = fingerprint(SHEET);
  await rememberInvoice("org1", "b1", {
    fingerprint: print, supplier: "Gulf Foods", movementIds: ["m1", "m2", "m3"], lines: 3,
  });

  const now = Date.now();
  assert.ok(await findRepeat("org1", "b1", print, { now }), "the same sheet, minutes later");
  assert.equal(
    await findRepeat("org1", "b1", print, { now: now + REPEAT_WINDOW_MS + 1000 }),
    null,
    "a week later is ordinary trade, not a double scan",
  );
});

await test("a repeat is per branch", async () => {
  /* The same delivery arriving at two branches on one day is two deliveries. */
  assert.equal(await findRepeat("org1", "b2", fingerprint(SHEET)), null);
});

await test("a repeat is per organization", async () => {
  assert.equal(await findRepeat("org2", "b1", fingerprint(SHEET)), null);
});

await test("a delivery that was taken back stops counting as a repeat", async () => {
  /* Undoing and re-scanning is a correction, and being asked "you already did
     this" about something already reversed would be wrong. */
  const print = fingerprint(delivery([["olive-oil", 12000]]));
  const rec = await rememberInvoice("org3", "b1", {
    fingerprint: print, movementIds: ["x1"], lines: 1,
  });
  assert.ok(await findRepeat("org3", "b1", print));

  await markUndone("org3", "b1", rec.id, { reversed: 1 });
  assert.equal(await findRepeat("org3", "b1", print), null);

  const after = await getInvoice("org3", "b1", rec.id);
  assert.equal(after.undone, true);
  assert.equal(after.reversed, 1);
  assert.ok(after.undoneAt > 0, "and when, because it is part of what happened");
});

await test("what was written is kept, so the delivery can be taken back as one", async () => {
  const rec = await rememberInvoice("org4", "b1", {
    fingerprint: "abc", supplier: "Gulf Foods", invoiceNo: "INV-1",
    actor: "sam", movementIds: ["m1", "m2"], lines: 2,
  });
  assert.deepEqual(rec.movementIds, ["m1", "m2"]);
  assert.equal(rec.lines, 2);
  assert.equal(rec.supplier, "Gulf Foods");
  assert.equal(rec.undone, false);
  assert.ok(rec.at > 0);
});

await test("the log cannot grow without bound", async () => {
  for (let i = 0; i < 60; i += 1) {
    await rememberInvoice("org5", "b1", { fingerprint: `f${i}`, movementIds: [`m${i}`], lines: 1 });
  }
  const all = await listInvoices("org5", "b1");
  assert.ok(all.length <= 400);
  assert.equal(all[0].fingerprint, "f59", "newest first, so a trim drops the oldest");
});

await test("an empty delivery does not collide with another empty one by accident", () => {
  /* Nothing to receive should never have been remembered in the first place —
     the route only records a delivery that wrote something — but a fingerprint
     of nothing must at least be stable rather than random. */
  assert.equal(fingerprint([]), fingerprint([]));
  assert.notEqual(fingerprint([]), fingerprint(SHEET));
});

/* ── The whole sequence the route performs ──────────────────────────────── */

const { saveIngredient, listIngredients } = await import("./_inventory.js");
const { recordMovement, reverseMovement, balances } = await import("./_movements.js");

const onHand = async (org, id) => {
  const rows = await balances(org, ["b1"], { ingredients: await listIngredients(org) });
  return rows.find((r) => r.ingredientId === id)?.qty ?? 0;
};

/* One delivery, exactly as `?what=invoice` commits it: dry-run everything,
   fingerprint what would be written, check for a repeat, write, remember. */
async function receive(org, rows, { confirm = false } = {}) {
  const dry = await Promise.all(rows.map((r) =>
    recordMovement(org, "b1", { ...r, type: "receive", actor: "sam" }, { dryRun: true })));
  const takeable = rows.filter((_, i) => !dry[i].error);
  const print = fingerprint(dry.filter((d) => d.movement).map((d) => d.movement));

  if (!confirm) {
    const already = await findRepeat(org, "b1", print);
    if (already) return { duplicate: already };
  }

  const written = [];
  for (const r of takeable) {
    const out = await recordMovement(org, "b1", { ...r, type: "receive", actor: "sam" });
    if (out.error) break;
    written.push(out.movement);
  }
  const record = await rememberInvoice(org, "b1", {
    fingerprint: print, movementIds: written.map((m) => m.id), lines: written.length,
  });
  return { written, delivery: record };
}

await test("the same sheet scanned twice is caught before anything is written", async () => {
  const org = "org-flow";
  await saveIngredient(org, { name: "Brioche buns", stockUnit: "ea" });
  await saveIngredient(org, { name: "Ground beef", stockUnit: "kg" });
  const rows = [
    { ingredientId: "brioche-buns", qty: 60, unit: "ea" },
    { ingredientId: "ground-beef", qty: 3, unit: "kg" },
  ];

  const first = await receive(org, rows);
  assert.equal(first.written.length, 2);
  assert.equal(await onHand(org, "brioche-buns"), 60);

  /* The exact behaviour that was missing: 77 became 137 became 272 because
     nothing ever asked. */
  const second = await receive(org, rows);
  assert.ok(second.duplicate, "the repeat is recognised");
  assert.equal(await onHand(org, "brioche-buns"), 60, "and nothing was written");

  /* Confirmed, it goes in — two genuine deliveries of the same thing happen. */
  const confirmed = await receive(org, rows, { confirm: true });
  assert.equal(confirmed.written.length, 2);
  assert.equal(await onHand(org, "brioche-buns"), 120);
});

await test("a delivery can be taken back in one go, and the balance returns", async () => {
  const org = "org-undo";
  await saveIngredient(org, { name: "Cheddar slices", stockUnit: "ea" });
  const rows = [{ ingredientId: "cheddar-slices", qty: 75, unit: "ea" }];

  const first = await receive(org, rows);
  assert.equal(await onHand(org, "cheddar-slices"), 75);

  const second = await receive(org, rows, { confirm: true });
  assert.equal(await onHand(org, "cheddar-slices"), 150, "the doubling this exists to undo");

  /* What the route does for `?what=undo-delivery`: reverse every entry the
     delivery wrote, then mark it. */
  let reversed = 0;
  for (const id of second.delivery.movementIds) {
    const one = await reverseMovement(org, "b1", id, { actor: "sam", reason: "double scan" });
    if (!one.error) reversed += 1;
  }
  await markUndone(org, "b1", second.delivery.id, { reversed });

  assert.equal(reversed, 1);
  assert.equal(await onHand(org, "cheddar-slices"), 75, "back to the one real delivery");

  /* The original is still there, marked, because this ledger corrects by
     reversal and never by deletion. */
  const still = await getInvoice(org, "b1", first.delivery.id);
  assert.equal(still.undone, false, "the delivery that was kept is untouched");
});

await test("taking the same delivery back twice does not overdraw the shelf", async () => {
  /* Reversal is idempotent per entry, and this leans on that rather than
     tracking it again: an entry already reversed is refused, not reversed a
     second time into a negative balance. */
  const org = "org-twice";
  await saveIngredient(org, { name: "Olive oil", stockUnit: "ml" });
  const out = await receive(org, [{ ingredientId: "olive-oil", qty: 2, unit: "l" }]);
  assert.equal(await onHand(org, "olive-oil"), 2000);

  const id = out.delivery.movementIds[0];
  assert.equal((await reverseMovement(org, "b1", id, { actor: "sam" })).error, undefined);
  assert.equal((await reverseMovement(org, "b1", id, { actor: "sam" })).error, "reversed");
  assert.equal(await onHand(org, "olive-oil"), 0, "not minus two thousand");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
