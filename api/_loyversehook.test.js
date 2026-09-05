/* The webhook front door, and the catalogue-id matching behind it.

   What these protect: a token resolves to exactly one organization and an
   unknown one to none; a rotated token stops working immediately; a configured
   signature is enforced and a wrong one refused; a pushed receipt normalises
   to the same shape a polled one does; the same sale arriving twice deducts
   once; and a dish that gets renamed at the till keeps depleting. */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const hook = await import("./_loyversehook.js");
const sd = await import("./_salesdepletion.js");
const inv = await import("./_inventory.js");
const mv = await import("./_movements.js");
const rc = await import("./_recipes.js");

let failures = 0;
async function test(name, fn) {
  __resetMemory();
  delete process.env.LOYVERSE_CLIENT_SECRET;
  try {
    await fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

/* A Loyverse receipt as the webhook delivers it. */
const payload = (over = {}) => ({
  receipt_number: "1-1043",
  created_at: "2026-09-05T18:20:00.000Z",
  store_id: "b1",
  total_money: 64,
  line_items: [
    {
      item_id: "itm_burger", variant_id: "var_single",
      item_name: "Cheeseburger", variant_name: "Single",
      quantity: 2, total_money: 64,
    },
  ],
  ...over,
});

/* ---------------------- tokens ---------------------------------- */

await test("a token resolves to its own organization and nothing else", async () => {
  const a = await hook.webhookToken("org1");
  const b = await hook.webhookToken("org2");

  assert.ok(a && b && a !== b, "each org gets its own token");
  assert.equal(await hook.orgForToken(a), "org1");
  assert.equal(await hook.orgForToken(b), "org2");
  assert.equal(await hook.orgForToken("not-a-token"), null);
  assert.equal(await hook.orgForToken(""), null);
  assert.equal(await hook.orgForToken(null), null);
});

await test("asking twice returns the same token rather than a new one", async () => {
  /* It is an address, not a password: somebody re-opening settings has to be
     able to read the URL they already configured. */
  assert.equal(await hook.webhookToken("org1"), await hook.webhookToken("org1"));
});

await test("rotating retires the old token immediately", async () => {
  const old = await hook.webhookToken("org1");
  const fresh = await hook.rotateWebhookToken("org1");

  assert.notEqual(old, fresh);
  assert.equal(await hook.orgForToken(fresh), "org1");
  /* A rotation happens because the old URL is believed to have leaked, so a
     grace period would defeat the point. */
  assert.equal(await hook.orgForToken(old), null);
});

/* ---------------------- signatures ------------------------------- */

await test("a parsed body cannot be verified, and says so rather than passing", () => {
  process.env.LOYVERSE_CLIENT_SECRET = "shhh";
  /* The failure mode this guards: re-serialising a parsed object produces
     different bytes from the ones that were signed, so comparing against it
     would refuse every honest request while looking like a working check. */
  const out = hook.verifySignature({ receipt_number: "1-1" }, { [hook.SIGNATURE_HEADER]: "abc" });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "norawbody");
});

await test("with no secret configured the signature is not checked", () => {
  const out = hook.verifySignature('{"a":1}', {});
  assert.equal(out.ok, true);
  assert.equal(out.checked, false);
});

await test("with a secret configured a correct signature passes", () => {
  process.env.LOYVERSE_CLIENT_SECRET = "shhh";
  const raw = JSON.stringify(payload());
  const digest = crypto.createHmac("sha1", "shhh").update(raw).digest("hex");

  assert.equal(hook.verifySignature(raw, { [hook.SIGNATURE_HEADER]: digest }).ok, true);
  /* Loyverse sends the digest bare, lowercase hex, with no algorithm prefix.
     A header that arrives upper-cased still verifies. */
  assert.equal(hook.verifySignature(raw, { [hook.SIGNATURE_HEADER]: digest.toUpperCase() }).ok, true);
  assert.equal(hook.SIGNATURE_HEADER, "x-loyverse-signature");
});

await test("the digest is SHA-1, which is what Loyverse actually sends", () => {
  /* This was implemented as SHA-256 from a guess. Both digests are hex and
     neither errors, so the only symptom would have been every genuine
     notification refused — pinned here so it cannot drift back. */
  process.env.LOYVERSE_CLIENT_SECRET = "shhh";
  const raw = JSON.stringify(payload());

  const sha1 = crypto.createHmac("sha1", "shhh").update(raw, "utf8").digest("hex");
  const sha256 = crypto.createHmac("sha256", "shhh").update(raw, "utf8").digest("hex");

  assert.equal(sha1.length, 40, "SHA-1 hex is 40 characters");
  assert.equal(hook.verifySignature(raw, { [hook.SIGNATURE_HEADER]: sha1 }).ok, true);
  assert.equal(hook.verifySignature(raw, { [hook.SIGNATURE_HEADER]: sha256 }).ok, false);
});

await test("with a secret configured a wrong or missing signature is refused", () => {
  process.env.LOYVERSE_CLIENT_SECRET = "shhh";
  const raw = JSON.stringify(payload());

  assert.equal(hook.verifySignature(raw, {}).ok, false);
  assert.equal(hook.verifySignature(raw, {}).reason, "missing");
  assert.equal(hook.verifySignature(raw, { [hook.SIGNATURE_HEADER]: "deadbeef" }).ok, false);

  /* A body altered after signing must not verify. */
  const digest = crypto.createHmac("sha1", "shhh").update(raw).digest("hex");
  const tampered = JSON.stringify(payload({ total_money: 6400 }));
  assert.equal(hook.verifySignature(tampered, { [hook.SIGNATURE_HEADER]: digest }).ok, false);
});

/* ---------------------- payload ---------------------------------- */

await test("a pushed receipt normalises to the shape the engine already takes", () => {
  const [receipt] = hook.receiptsFromEvent(payload()).receipts;

  assert.equal(receipt.id, "1-1043", "idempotency keys on the till's receipt number");
  assert.equal(receipt.branchId, "b1");
  assert.equal(receipt.at, Date.parse("2026-09-05T18:20:00.000Z"));
  assert.equal(receipt.lines.length, 1);
  assert.equal(receipt.lines[0].qty, 2);
  assert.equal(receipt.lines[0].itemId, "itm_burger");
  assert.equal(receipt.lines[0].variantId, "var_single");
});

/* The envelope Loyverse actually sends, per its API reference: a merchant, an
   event type, and an ARRAY of up to a hundred objects. */
const envelope = (...receipts) => ({
  merchant_id: "5fk4f446-01d2-8787-4fd5-7b7b1995df85",
  type: "receipts.update",
  created_at: "2026-09-05T18:20:01.000Z",
  receipts,
});

await test("the real envelope carries an array of receipts, not one", () => {
  /* The first implementation read `body.receipt` and would have found nothing
     in every genuine delivery. */
  const out = hook.receiptsFromEvent(envelope(payload()));
  assert.equal(out.error, undefined);
  assert.equal(out.receipts.length, 1);
  assert.deepEqual(out.receipts[0], hook.receiptsFromEvent(payload()).receipts[0]);
});

await test("a batched notification yields every receipt in it", () => {
  /* Loyverse batches up to 100 per request — an import or a burst of sales
     arrives as one POST, and reading only the first would lose the rest. */
  const many = Array.from({ length: 12 }, (_, i) =>
    payload({ receipt_number: `1-${1100 + i}` }));
  const out = hook.receiptsFromEvent(envelope(...many));

  assert.equal(out.receipts.length, 12);
  assert.equal(out.receipts[11].id, "1-1111");
});

await test("a batch with some unreadable rows keeps the readable ones", () => {
  const out = hook.receiptsFromEvent(envelope(
    payload(),
    { receipt_number: "", line_items: [] },
    payload({ receipt_number: "1-1044" }),
  ));
  assert.equal(out.receipts.length, 2);
  assert.equal(out.rejected.length, 1);
});

await test("a bare receipt is still read, for the dashboard's test send", () => {
  const bare = hook.receiptsFromEvent(payload());
  assert.equal(bare.receipts.length, 1);
  assert.equal(bare.receipts[0].id, "1-1043");
});

await test("a payload missing what the engine needs is named, not guessed", () => {
  assert.equal(hook.receiptsFromEvent(null).error, "payload");
  assert.equal(hook.receiptsFromEvent({}).error, "receipt_number");
  assert.equal(hook.receiptsFromEvent(payload({ receipt_number: "", id: "" })).error, "receipt_number");
  assert.equal(hook.receiptsFromEvent(payload({ line_items: undefined })).error, "line_items");
});

await test("the event is receipts.update, which is the only one Loyverse defines", () => {
  /* Both task specifications name `receipt.created`. It does not exist:
     Loyverse's events are inventory_levels.update, items.update,
     customers.update, receipts.update and shifts.create, and receipts.update
     fires on creation as well as change. */
  assert.equal(hook.RECEIPT_EVENTS.has("receipts.update"), true);
  assert.equal(hook.RECEIPT_EVENTS.has("receipt.created"), false);
  assert.equal(hook.RECEIPT_EVENTS.has("customers.update"), false);
  assert.equal(hook.eventNameOf({ type: "receipts.update" }), "receipts.update");
  assert.equal(hook.eventNameOf(payload()), "", "a bare receipt has no event name");
});

await test("a refund does not draw stock, and neither does a cancelled sale", () => {
  /* A refund lists the same items with the same positive quantities as the
     sale it reverses. Deducting it would take one meal's food out twice. */
  const [refund] = hook.receiptsFromEvent(payload({
    receipt_number: "1-1044", receipt_type: "REFUND", refund_for: "1-1043",
  })).receipts;
  assert.equal(refund.receiptType, "REFUND");
  assert.equal(hook.drawsStock(refund), false);

  const [cancelled] = hook.receiptsFromEvent(payload({
    receipt_number: "1-1045", cancelled_at: "2026-09-05T18:40:00.000Z",
  })).receipts;
  assert.equal(hook.drawsStock(cancelled), false);

  const [sale] = hook.receiptsFromEvent(payload()).receipts;
  assert.equal(sale.receiptType, "SALE");
  assert.equal(hook.drawsStock(sale), true);
});

/* ---------------------- end to end ------------------------------- */

async function seed() {
  await inv.saveIngredient("org1", { name: "Beef mince", stockUnit: "kg" });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "receive", qty: 10, unit: "kg", unitCost: 30,
  });
  await rc.saveVersion("org1", {
    menuItem: "Cheeseburger Single", portions: 1, sellPrice: 32,
    lines: [{ ingredientId: "beef-mince", qty: 150, unit: "g" }],
  });
}

const onHand = async () => {
  const rows = await mv.balances("org1", ["b1"], {
    ingredients: await inv.listIngredients("org1"),
  });
  return rows.find((r) => r.ingredientId === "beef-mince")?.qty ?? null;
};

await test("a pushed receipt deducts once, however many times it arrives", async () => {
  await seed();
  const [receipt] = hook.receiptsFromEvent(payload()).receipts;

  const first = await sd.depleteFromSales("org1", "b1", [receipt]);
  assert.equal(first.posted, 1);
  assert.equal(first.movements, 1);
  /* Two burgers at 150 g, off 10 kg. */
  assert.equal(await onHand(), 9.7);

  /* The same event delivered again — a sender retry, or the poller finding it
     a minute later. */
  const again = await sd.depleteFromSales("org1", "b1", [receipt]);
  assert.equal(again.posted, 0);
  assert.equal(again.movements, 0);
  assert.equal(await onHand(), 9.7);
});

await test("the ledger entry carries the receipt number as a ref", async () => {
  await seed();
  const [receipt] = hook.receiptsFromEvent(payload()).receipts;
  await sd.depleteFromSales("org1", "b1", [receipt]);

  const [entry] = await mv.listMovements("org1", "b1", { type: "consume" });
  assert.equal(entry.ref, "1-1043", "a receipt's consumption must be findable by its number");
  assert.equal(entry.auto, true, "variance must be able to ignore derived consumption");
});

await test("a dish renamed at the till keeps depleting", async () => {
  await seed();

  /* First sale matches on the printed name and teaches the catalogue id. */
  const first = await sd.depleteFromSales("org1", "b1",
    [hook.receiptsFromEvent(payload()).receipts[0]]);
  assert.equal(first.movements, 1);
  assert.equal(first.learned, 1, "the catalogue pairing should be recorded");

  /* The kitchen renames it for a promotion. Same item in the catalogue, new
     label — which under name-only matching stopped depleting silently. */
  const renamed = hook.receiptsFromEvent(payload({
    receipt_number: "1-1044",
    line_items: [{
      item_id: "itm_burger", variant_id: "var_single",
      item_name: "Smash Burger", variant_name: "Single",
      quantity: 1, total_money: 32,
    }],
  })).receipts[0];

  const second = await sd.depleteFromSales("org1", "b1", [renamed]);
  assert.equal(second.movements, 1, "the rename must not stop the deduction");
  assert.deepEqual(second.unmatched, []);
  assert.equal(await onHand(), 9.55); // 9.7 − 150 g
});

await test("a pairing pointing at a deleted recipe resolves to nothing", async () => {
  await seed();
  await sd.depleteFromSales("org1", "b1", [hook.receiptsFromEvent(payload()).receipts[0]]);
  await rc.deleteRecipe("org1", "cheeseburger-single");

  const out = await sd.depleteFromSales("org1", "b1",
    hook.receiptsFromEvent(payload({ receipt_number: "1-1045" })).receipts);

  assert.equal(out.movements, 0);
  assert.deepEqual(out.unmatched, ["Cheeseburger"], "reported, not silently skipped");
});

/* ---------------------- is it actually connected ----------------- */

/* The assistant could not answer "is my webhook connected?" because nothing
   ever told it. Worse, nothing recorded the only evidence that matters: that
   a delivery arrived. Issuing a token proves somebody opened Settings. */

await test("no address issued reads as off", async () => {
  const out = await hook.ingestionStatus("org1");
  assert.equal(out.state, "off");
  assert.equal(out.configured, false);
});

await test("an address with nothing delivered is waiting, not live", async () => {
  await hook.webhookToken("org1");
  const out = await hook.ingestionStatus("org1");

  /* The commonest real state: the URL was generated and never pasted into
     Loyverse. Calling that "connected" would send somebody hunting through
     their recipes for why stock is not moving. */
  assert.equal(out.state, "waiting");
  assert.equal(out.configured, true);
  assert.ok(/not been added in Loyverse/i.test(out.hint));
});

await test("one delivery makes it live, and the clock starts", async () => {
  await hook.webhookToken("org1");
  const at = Date.now() - 5 * 60000;
  await hook.noteDelivery("org1", { at, receipts: 3 });

  const out = await hook.ingestionStatus("org1");
  assert.equal(out.state, "live");
  assert.equal(out.deliveries, 1);
  assert.equal(out.receipts, 3);
  assert.equal(out.lastReceiptAt, at);
  assert.equal(out.quiet, false);
  assert.equal(out.quietForMinutes, 5);
});

await test("a long silence is reported but not called broken", async () => {
  await hook.webhookToken("org1");
  const at = Date.now() - 9 * 60 * 60 * 1000;
  await hook.noteDelivery("org1", { at });

  const out = await hook.ingestionStatus("org1", { now: Date.now() });
  assert.equal(out.state, "live", "it did work, and the record says when");
  assert.equal(out.quiet, true);
  /* Whether nine quiet hours is a fault depends on opening times, which this
     module does not know — so it reports and does not judge. */
  assert.ok(out.quietForMinutes >= 540);
});

await test("deliveries accumulate rather than overwrite", async () => {
  await hook.webhookToken("org1");
  await hook.noteDelivery("org1", { at: 1000, receipts: 2 });
  await hook.noteDelivery("org1", { at: 2000, receipts: 5 });

  const out = await hook.ingestionStatus("org1");
  assert.equal(out.deliveries, 2);
  assert.equal(out.receipts, 7);
  assert.equal(out.firstReceiptAt, 1000, "the first is kept");
  assert.equal(out.lastReceiptAt, 2000, "the last is what freshness reads");
});

await test("one organization's ingestion is not another's", async () => {
  await hook.webhookToken("org1");
  await hook.noteDelivery("org1", {});
  assert.equal((await hook.ingestionStatus("org2")).state, "off");
});


console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
