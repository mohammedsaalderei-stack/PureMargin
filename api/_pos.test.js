/* The POS adapter.

   What these protect: every adapter answers the same questions in the same
   shape; the Loyverse mapping still reads a real Loyverse payload correctly;
   POS_API_BASE overrides the provider's own base; an unknown provider falls
   back rather than crashing; and the env-driven adapter reads the field names
   it is told to. */

import assert from "node:assert/strict";

const REQUIRED = [
  "id", "label", "base", "auth", "detail",
  "receiptsPath", "probePath", "itemsPath", "storesPath",
  "nextCursor", "receiptsOf", "itemsOf", "storesOf",
  "receipt", "item", "store", "historyRefused",
];

let failures = 0;
function test(name, fn) {
  const saved = { ...process.env };
  try {
    fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

const { provider, providerNames, loyverse, custom } = await import("./_pos.js");

test("every provider answers the whole contract", () => {
  for (const p of [loyverse, custom]) {
    for (const key of REQUIRED) {
      assert.ok(p[key] !== undefined, `${p.id} is missing ${key}`);
    }
  }
  assert.deepEqual(providerNames.sort(), ["custom", "loyverse"]);
});

test("loyverse is the default", () => {
  delete process.env.POS_PROVIDER;
  delete process.env.POS_API_BASE;
  assert.equal(provider().id, "loyverse");
  assert.match(provider().base, /loyverse/);
});

test("an unknown provider falls back rather than crashing", () => {
  process.env.POS_PROVIDER = "not-a-real-till";
  assert.equal(provider().id, "loyverse", "a typo must not take the app down");
});

test("POS_API_BASE overrides the provider's own base", () => {
  process.env.POS_PROVIDER = "loyverse";
  process.env.POS_API_BASE = "https://sandbox.example.com/v2";
  assert.equal(provider().base, "https://sandbox.example.com/v2");
});

test("the token is presented as a bearer header", () => {
  assert.deepEqual(loyverse.auth("abc"), { Authorization: "Bearer abc" });
});

test("loyverse reads a real receipt shape", () => {
  const out = loyverse.receipt({
    store_id: 77,
    receipt_date: "2026-08-01T10:00:00.000Z",
    line_items: [
      { item_name: "Shawarma", variant_name: "Large", quantity: 2, total_money: 24 },
      { item_name: "Tea", quantity: 1, total_money: 6 },
    ],
  });
  assert.equal(out.branchId, "77", "a numeric store id must survive as a string");
  assert.equal(out.at, Date.parse("2026-08-01T10:00:00.000Z"));
  assert.equal(out.lines.length, 2);
  assert.deepEqual(out.lines[0], { name: "Shawarma", variant: "Large", qty: 2, revenue: 24, cost: null });
  assert.equal(out.lines[1].variant, "", "a missing variant is empty, not undefined");
});

test("a receipt with no lines does not crash", () => {
  const out = loyverse.receipt({ store_id: 1, receipt_date: "2026-08-01T10:00:00Z" });
  assert.deepEqual(out.lines, []);
});

test("non-numeric money and quantity read as zero, never NaN", () => {
  const out = loyverse.receipt({
    store_id: 1, receipt_date: "2026-08-01T10:00:00Z",
    line_items: [{ item_name: "X", quantity: "two", total_money: "AED 5" }],
  });
  assert.equal(out.lines[0].qty, 0);
  assert.equal(out.lines[0].revenue, 0);
});

test("loyverse reads an item with variants", () => {
  const out = loyverse.item({
    item_name: "Shawarma", image_url: "http://x/y.png", category_id: "cat-1",
    variants: [{ variant_name: "Large", cost: 4.5 }, { variant_name: "Small", cost: 3 }],
  });
  assert.equal(out.name, "Shawarma");
  assert.equal(out.image, "http://x/y.png");
  assert.equal(out.category, "cat-1");
  assert.deepEqual(out.variants.map((v) => v.cost), [4.5, 3]);
});

test("pagination and list fields come from the adapter", () => {
  assert.equal(loyverse.nextCursor({ cursor: "abc" }), "abc");
  assert.equal(loyverse.nextCursor({}), null, "the last page must end the walk");
  assert.deepEqual(loyverse.receiptsOf({ receipts: [1, 2] }), [1, 2]);
  assert.deepEqual(loyverse.receiptsOf({}), [], "a missing list is empty, not a crash");
});

test("paths carry the window and the cursor", () => {
  const first = loyverse.receiptsPath("2026-01-01T00:00:00Z", null);
  assert.match(first, /created_at_min=/);
  assert.ok(!first.includes("cursor="), "the first page has no cursor");
  assert.match(loyverse.receiptsPath("2026-01-01T00:00:00Z", "c1"), /cursor=c1/);
  assert.match(loyverse.probePath("2026-01-01T00:00:00Z"), /limit=1/);
});

test("a plan-imposed history ceiling is recognised", () => {
  assert.equal(loyverse.historyRefused(402, ""), true);
  assert.equal(loyverse.historyRefused(500, "boom"), false, "a real fault must not be mistaken for a plan limit");
  assert.equal(loyverse.historyRefused(undefined, "only 31 days available"), true);
});

test("the env-driven adapter reads the field names it is told", () => {
  process.env.POS_FIELD_BRANCH = "location.id";
  process.env.POS_FIELD_DATE = "closedAt";
  process.env.POS_FIELD_LINES = "items";
  process.env.POS_FIELD_LINE_NAME = "title";
  process.env.POS_FIELD_LINE_QTY = "count";
  process.env.POS_FIELD_LINE_TOTAL = "gross";

  const out = custom.receipt({
    location: { id: "shop-2" },
    closedAt: "2026-08-01T10:00:00Z",
    items: [{ title: "Karak", count: 3, gross: 9 }],
  });
  assert.equal(out.branchId, "shop-2", "a dotted path must resolve");
  assert.equal(out.lines[0].name, "Karak");
  assert.equal(out.lines[0].qty, 3);
  assert.equal(out.lines[0].revenue, 9);
});

test("the env-driven adapter can use a non-bearer header", () => {
  process.env.POS_AUTH_HEADER = "X-Api-Key";
  assert.deepEqual(custom.auth("k1"), { "X-Api-Key": "k1" });
});


test("every provider declares whether it keeps stock", () => {
  for (const p of [loyverse, custom]) {
    assert.ok(p.inventory, `${p.id} must say something about inventory`);
    assert.equal(typeof p.inventory.supported, "boolean");
    assert.ok(Array.isArray(p.inventory.limits), "and what it cannot do");
  }
});

test("a till that keeps stock names what it cannot track", () => {
  assert.equal(loyverse.inventory.supported, true);
  assert.ok(loyverse.inventory.limits.length >= 3,
    "offering the till's stock without naming the trade sells a downgrade as a convenience");
});

test("an undescribed till does not claim to keep stock", () => {
  delete process.env.POS_PATH_INVENTORY;
  assert.equal(custom.inventory.supported, false,
    "claiming support and returning nothing would look like an outage");
});

test("loyverse reads a stock level", () => {
  const out = loyverse.inventory.level({ variant_id: "v1", store_id: 7, in_stock: 12.5 });
  assert.deepEqual(out, { itemId: "v1", branchId: "7", qty: 12.5 });
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
