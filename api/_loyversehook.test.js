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
  delete process.env.LOYVERSE_WEBHOOK_SECRET;
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
  process.env.LOYVERSE_WEBHOOK_SECRET = "shhh";
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
  process.env.LOYVERSE_WEBHOOK_SECRET = "shhh";
  const raw = JSON.stringify(payload());
  const digest = crypto.createHmac("sha256", "shhh").update(raw).digest("hex");

  assert.equal(hook.verifySignature(raw, { [hook.SIGNATURE_HEADER]: digest }).ok, true);
  /* The `sha256=` prefix some senders use is tolerated. */
  assert.equal(hook.verifySignature(raw, { [hook.SIGNATURE_HEADER]: `sha256=${digest}` }).ok, true);
});

await test("with a secret configured a wrong or missing signature is refused", () => {
  process.env.LOYVERSE_WEBHOOK_SECRET = "shhh";
  const raw = JSON.stringify(payload());

  assert.equal(hook.verifySignature(raw, {}).ok, false);
  assert.equal(hook.verifySignature(raw, {}).reason, "missing");
  assert.equal(hook.verifySignature(raw, { [hook.SIGNATURE_HEADER]: "deadbeef" }).ok, false);

  /* A body altered after signing must not verify. */
  const digest = crypto.createHmac("sha256", "shhh").update(raw).digest("hex");
  const tampered = JSON.stringify(payload({ total_money: 6400 }));
  assert.equal(hook.verifySignature(tampered, { [hook.SIGNATURE_HEADER]: digest }).ok, false);
});

/* ---------------------- payload ---------------------------------- */

await test("a pushed receipt normalises to the shape the engine already takes", () => {
  const { receipt } = hook.receiptFromEvent(payload());

  assert.equal(receipt.id, "1-1043", "idempotency keys on the till's receipt number");
  assert.equal(receipt.branchId, "b1");
  assert.equal(receipt.at, Date.parse("2026-09-05T18:20:00.000Z"));
  assert.equal(receipt.lines.length, 1);
  assert.equal(receipt.lines[0].qty, 2);
  assert.equal(receipt.lines[0].itemId, "itm_burger");
  assert.equal(receipt.lines[0].variantId, "var_single");
});

await test("a receipt wrapped in an event envelope reads the same", () => {
  const bare = hook.receiptFromEvent(payload()).receipt;
  for (const wrapped of [
    { type: "receipt.created", receipt: payload() },
    { type: "receipt.created", data: { receipt: payload() } },
    { type: "receipt.created", data: payload() },
  ]) {
    assert.deepEqual(hook.receiptFromEvent(wrapped).receipt, bare);
  }
});

await test("a payload missing what the engine needs is named, not guessed", () => {
  assert.equal(hook.receiptFromEvent(null).error, "payload");
  assert.equal(hook.receiptFromEvent({}).error, "receipt_number");
  assert.equal(hook.receiptFromEvent(payload({ receipt_number: "", id: "" })).error, "receipt_number");
  assert.equal(hook.receiptFromEvent(payload({ line_items: undefined })).error, "line_items");
});

await test("only receipt events are acted on, and an unnamed one is allowed", () => {
  assert.equal(hook.RECEIPT_EVENTS.has("receipt.created"), true);
  assert.equal(hook.RECEIPT_EVENTS.has("customer.created"), false);
  assert.equal(hook.eventNameOf({ type: "receipt.created" }), "receipt.created");
  assert.equal(hook.eventNameOf({ event: "receipt.created" }), "receipt.created");
  assert.equal(hook.eventNameOf(payload()), "", "a bare receipt has no event name");
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
  const { receipt } = hook.receiptFromEvent(payload());

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
  const { receipt } = hook.receiptFromEvent(payload());
  await sd.depleteFromSales("org1", "b1", [receipt]);

  const [entry] = await mv.listMovements("org1", "b1", { type: "consume" });
  assert.equal(entry.ref, "1-1043", "a receipt's consumption must be findable by its number");
  assert.equal(entry.auto, true, "variance must be able to ignore derived consumption");
});

await test("a dish renamed at the till keeps depleting", async () => {
  await seed();

  /* First sale matches on the printed name and teaches the catalogue id. */
  const first = await sd.depleteFromSales("org1", "b1",
    [hook.receiptFromEvent(payload()).receipt]);
  assert.equal(first.movements, 1);
  assert.equal(first.learned, 1, "the catalogue pairing should be recorded");

  /* The kitchen renames it for a promotion. Same item in the catalogue, new
     label — which under name-only matching stopped depleting silently. */
  const renamed = hook.receiptFromEvent(payload({
    receipt_number: "1-1044",
    line_items: [{
      item_id: "itm_burger", variant_id: "var_single",
      item_name: "Smash Burger", variant_name: "Single",
      quantity: 1, total_money: 32,
    }],
  })).receipt;

  const second = await sd.depleteFromSales("org1", "b1", [renamed]);
  assert.equal(second.movements, 1, "the rename must not stop the deduction");
  assert.deepEqual(second.unmatched, []);
  assert.equal(await onHand(), 9.55); // 9.7 − 150 g
});

await test("a pairing pointing at a deleted recipe resolves to nothing", async () => {
  await seed();
  await sd.depleteFromSales("org1", "b1", [hook.receiptFromEvent(payload()).receipt]);
  await rc.deleteRecipe("org1", "cheeseburger-single");

  const out = await sd.depleteFromSales("org1", "b1",
    [hook.receiptFromEvent(payload({ receipt_number: "1-1045" })).receipt]);

  assert.equal(out.movements, 0);
  assert.deepEqual(out.unmatched, ["Cheeseburger"], "reported, not silently skipped");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
