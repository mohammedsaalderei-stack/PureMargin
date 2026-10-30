/* The register: building a sale, its settings, and where it is kept.

   A till that charges the wrong amount is worse than no till, and the wrong
   amount usually comes from trusting the screen: a price typed into a request,
   an add-on from another dish, change worked out against the wrong total. So
   most of what follows is about what a request may and may not decide. */

import assert from "node:assert/strict";
import { backend, __resetMemory, listJSON, setJSON } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const till = await import("./_till.js");
const {
  buildSale, catalogueOf, readAddons, readVat, monthsBetween, receiptNumber, forDepletion,
  recordSale, registerReceipts, usesRegister, saveAddons, saveVat, getSettings, DEFAULT_VAT_PCT,
} = till;

let failures = 0;
async function test(name, fn) {
  try {
    __resetMemory();
    await fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const AT = Date.UTC(2026, 9, 30, 9, 15, 0);

const CATALOGUE = [
  { id: "beef-burger", name: "Beef burger", category: "Meals", price: 28,
    addons: [{ id: "extra-cheese", name: "Extra cheese", price: 3, cost: 0.8 }, { id: "extra-sauce", name: "Extra sauce", price: 2, cost: 0.4 }] },
  { id: "fries", name: "Fries", category: "Meals", price: 12, addons: [] },
  { id: "latte", name: "Latte", category: "Drinks", price: 18, addons: [] },
];

const sale = (over = {}) => ({
  orderType: "dine_in", table: "5",
  lines: [{ itemId: "beef-burger", qty: 1, addons: ["extra-cheese"] }],
  payment: { type: "cash", received: 50 },
  ...over,
});

const build = (input, opts = {}) => buildSale(input, { catalogue: CATALOGUE, vatPct: 5, branchId: "b1", at: AT, number: "PM-T-1", ...opts });

/* ── The money ── */

await test("the demo's order comes to the demo's total", async () => {
  /* Burger 28 + extra cheese 3 = 31.00; VAT 5% = 1.55; due 32.55; 50 in, 17.45 back. */
  const { receipt } = build(sale());
  assert.equal(receipt.subtotal_money, 31);
  assert.equal(receipt.total_tax, 1.55);
  assert.equal(receipt.total_money, 32.55);
  assert.equal(receipt.payments[0].change, 17.45);
});

await test("a price in the request is ignored; the catalogue's is charged", async () => {
  const { receipt } = build(sale({ lines: [{ itemId: "fries", qty: 2, price: 0.01, total: 0.02 }] }));
  assert.equal(receipt.line_items[0].price, 12);
  assert.equal(receipt.line_items[0].total_money, 24);
});

await test("quantity multiplies the dish and its add-ons together", async () => {
  const { receipt } = build(sale({ lines: [{ itemId: "beef-burger", qty: 3, addons: ["extra-cheese", "extra-sauce"] }], payment: { type: "card" } }));
  assert.equal(receipt.line_items[0].price, 33);
  assert.equal(receipt.line_items[0].total_money, 99);
  assert.equal(receipt.line_items[0].addon_cost, 3.6);
});

await test("an add-on from another dish is refused", async () => {
  const out = build(sale({ lines: [{ itemId: "fries", qty: 1, addons: ["extra-cheese"] }] }));
  assert.equal(out.error, "addon");
});

await test("an unknown dish is refused rather than sold at nothing", async () => {
  assert.equal(build(sale({ lines: [{ itemId: "lobster", qty: 1 }] })).error, "item");
});

await test("a quantity has to be a whole number of at least one", async () => {
  for (const qty of [0, -1, 1.5, "two", 1000]) {
    assert.equal(build(sale({ lines: [{ itemId: "fries", qty }] })).error, "qty", `qty ${qty}`);
  }
});

await test("an empty order is refused", async () => {
  assert.equal(build(sale({ lines: [] })).error, "empty");
});

await test("cash short of the total is refused, with the total to collect", async () => {
  const out = build(sale({ payment: { type: "cash", received: 30 } }));
  assert.equal(out.error, "short");
  assert.equal(out.total, 32.55);
});

await test("cash with no amount entered is taken as exact", async () => {
  const { receipt } = build(sale({ payment: { type: "cash" } }));
  assert.equal(receipt.payments[0].received, 32.55);
  assert.equal(receipt.payments[0].change, 0);
});

await test("a card payment is the total, with no change", async () => {
  const { receipt } = build(sale({ payment: { type: "card", received: 500 } }));
  assert.deepEqual([receipt.payments[0].name, receipt.payments[0].money_amount, receipt.payments[0].change], ["Card", 32.55, 0]);
});

await test("a payment of no known kind is refused", async () => {
  assert.equal(build(sale({ payment: { type: "voucher" } })).error, "payment");
});

await test("an order type is required, and a table only means something dining in", async () => {
  assert.equal(build(sale({ orderType: "delivery" })).error, "ordertype");
  assert.equal(build(sale({ orderType: "takeaway", table: "5" })).receipt.table, null);
  assert.equal(build(sale()).receipt.table, "5");
});

await test("a VAT rate of nonsense falls back to the default instead of to zero", async () => {
  const { receipt } = build(sale(), { vatPct: "lots" });
  assert.equal(receipt.vat_pct, DEFAULT_VAT_PCT);
});

/* ── The receipt is the till's shape, so every report reads it ── */

await test("the receipt reads like a till's", async () => {
  const { receipt } = build(sale());
  assert.equal(receipt.receipt_type, "SALE");
  assert.equal(receipt.store_id, "b1");
  assert.equal(receipt.line_items[0].item_name, "Beef burger");
  assert.equal(receipt.line_items[0].quantity, 1);
  assert.equal(receipt.payments[0].name, "Cash");
  assert.ok(receipt.receipt_date.startsWith("2026-10-30"));
});

await test("stock depletion sees the dish by recipe and by name", async () => {
  const { receipt } = build(sale());
  const d = forDepletion(receipt);
  assert.equal(d.id, "PM-T-1");
  assert.equal(d.lines[0].itemId, "recipe:beef-burger");
  assert.equal(d.lines[0].name, "Beef burger");
  assert.equal(d.lines[0].qty, 1);
});

await test("a receipt number no till issues, sortable by time", async () => {
  const n = receiptNumber(AT, () => 0.5);
  assert.match(n, /^PM-261030-091500-[0-9A-Z]{3}$/);
  assert.ok(receiptNumber(AT, () => 0) < receiptNumber(AT + 1000, () => 0));
});

/* ── The catalogue ── */

await test("every current dish is on the register, priced or not", async () => {
  const items = catalogueOf([
    { id: "a", menuItem: "Burger", sellPrice: 28 },
    { id: "b", menuItem: "Old dish", sellPrice: 20, archived: true },
    { id: "c", menuItem: "Unpriced", sellPrice: null },
    { id: "d", menuItem: "Free?", sellPrice: 0 },
  ], { addons: {} });
  assert.deepEqual(items.map((i) => i.id).sort(), ["a", "c", "d"]);
  assert.deepEqual(items.filter((i) => i.priced).map((i) => i.id), ["a"]);
  assert.equal(items.find((i) => i.id === "c").price, null);
});

await test("a dish with no price cannot be sold", async () => {
  const catalogue = catalogueOf([{ id: "c", menuItem: "Unpriced", sellPrice: null }], { addons: {} });
  const out = buildSale({ orderType: "takeaway", lines: [{ itemId: "c", qty: 1 }], payment: { type: "card" } },
    { catalogue, vatPct: 5, branchId: "b1", at: Date.now(), number: "PM-x" });
  assert.equal(out.error, "noprice");
});

await test("a dish carries its own add-ons and nobody else's", async () => {
  const items = catalogueOf([{ id: "a", menuItem: "Burger", sellPrice: 28 }, { id: "b", menuItem: "Fries", sellPrice: 12 }],
    { addons: { a: [{ id: "x", name: "Cheese", price: 3, cost: 1 }] } });
  assert.equal(items.find((i) => i.id === "a").addons.length, 1);
  assert.equal(items.find((i) => i.id === "b").addons.length, 0);
});

/* ── Settings ── */

await test("add-on names make ids, and two of a name do not collide", async () => {
  const { addons } = readAddons([{ name: "Extra cheese", price: 3 }, { name: "Extra cheese", price: 4 }]);
  assert.deepEqual(addons.map((a) => a.id), ["extra-cheese", "extra-cheese-2"]);
});

await test("an add-on needs a name and a sensible price; its cost may be unknown", async () => {
  assert.equal(readAddons([{ name: "", price: 3 }]).error, "name");
  assert.equal(readAddons([{ name: "X", price: -1 }]).error, "price");
  assert.equal(readAddons([{ name: "X", price: 2, cost: -1 }]).error, "cost");
  assert.equal(readAddons([{ name: "X", price: 2, cost: "" }]).addons[0].cost, null);
});

await test("VAT is a rate between none and fifty percent", async () => {
  assert.equal(readVat(5).vatPct, 5);
  assert.equal(readVat(0).vatPct, 0);
  assert.equal(readVat(51).error, "vat");
  assert.equal(readVat("x").error, "vat");
});

await test("add-ons and VAT are kept per organization", async () => {
  await saveAddons("org1", "a", [{ name: "Cheese", price: 3, cost: 0.8 }]);
  await saveVat("org1", 7.5);
  const one = await getSettings("org1");
  const two = await getSettings("org2");
  assert.equal(one.addons.a[0].name, "Cheese");
  assert.equal(one.vatPct, 7.5);
  assert.deepEqual(two.addons, {});
  assert.equal(two.vatPct, DEFAULT_VAT_PCT);
});

/* ── Storage ── */

await test("a window spanning months reads every month in it", async () => {
  assert.deepEqual(monthsBetween(Date.UTC(2026, 8, 20), Date.UTC(2026, 10, 2)), ["2026-09", "2026-10", "2026-11"]);
  assert.deepEqual(monthsBetween(Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 30)), ["2026-10"]);
});

await test("each sale is its own record, so two at once both survive", async () => {
  const one = build(sale(), { number: "PM-A" }).receipt;
  const two = build(sale(), { number: "PM-B" }).receipt;
  await Promise.all([recordSale("org1", one), recordSale("org1", two)]);
  const back = await registerReceipts("org1", { since: AT - 1000, now: AT + 1000 });
  assert.deepEqual(back.map((r) => r.id).sort(), ["PM-A", "PM-B"]);
});

await test("receipts come back inside the window, oldest first, for one organization only", async () => {
  await recordSale("org1", build(sale(), { number: "PM-late", at: AT + 60000 }).receipt);
  await recordSale("org1", build(sale(), { number: "PM-early", at: AT }).receipt);
  await recordSale("org1", build(sale(), { number: "PM-old", at: AT - 90 * 864e5 }).receipt);
  /* Same month, an hour before the window: read back with the month, and
     left out by the window. */
  await recordSale("org1", build(sale(), { number: "PM-before", at: AT - 3600e3 }).receipt);
  await recordSale("org2", build(sale(), { number: "PM-other", at: AT }).receipt);
  const back = await registerReceipts("org1", { since: AT - 1000, now: AT + 120000 });
  assert.deepEqual(back.map((r) => r.id), ["PM-early", "PM-late"]);
});

await test("an organization uses the register from its first sale", async () => {
  assert.equal(await usesRegister("org1"), false);
  await recordSale("org1", build(sale()).receipt);
  assert.equal(await usesRegister("org1"), true);
  assert.equal(await usesRegister("org2"), false);
});

await test("listJSON returns every document under a prefix, in key order", async () => {
  await setJSON("p:b", { n: 2 });
  await setJSON("p:a", { n: 1 });
  await setJSON("q:a", { n: 3 });
  const rows = await listJSON("p:");
  assert.deepEqual(rows.map((r) => [r.key, r.value.n]), [["p:a", 1], ["p:b", 2]]);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
