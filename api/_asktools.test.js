/* The assistant's reach: the register, longer history, and sales channels.

   The rule the user asked for is that the assistant can read everything the
   business's plan includes. These are the things it could not: who closed the
   till short, who the regulars are, how the register is set up, what was sold
   before this month, and what each delivery channel leaves behind. Each is
   checked for what it returns, for what it must not (a customer's phone
   number; a channel's figures to somebody who may not see profit), and for
   the package it belongs to. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const dm = await import("./_domains.js");
const { createAccount, getAccount } = await import("./_accounts.js");
const { issueToken } = await import("./_auth.js");
const { orgFor } = await import("./_org.js");
const { saveVersion } = await import("./_recipes.js");
const { SCREEN_FEATURE } = await import("../src/entitlements.js");
const till = (await import("./till.js")).default;
const channels = (await import("./channels.js")).default;

let failures = 0;
async function test(name, fn) {
  __resetMemory();
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 0.006, `expected ${b}, got ${a}`);
const ALL_CAPS = ["view:dashboard", "view:costs", "view:inventory", "view:profitability", "manage:staff"];
const ALL_FEATURES = ["table", "assistant", "operations", "costs"];

async function shop() {
  await createAccount({ username: "owner1", password: "Till-test-9x!" });
  const account = await getAccount("owner1");
  const org = await orgFor(account);
  await saveVersion(org.id, { id: "wrap", menuItem: "Wrap", sellPrice: 50, lines: [{ name: "Chicken", qty: 100, unit: "g", estimatedCost: 0.15 }] });
  const token = issueToken("owner1", account.tokenVersion || 0);
  const call = async (handler, method, what, body) => {
    const r = { code: 0, body: null, setHeader() { return r; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
    await handler({ method, url: `/api/x?what=${what}`, headers: { authorization: `Bearer ${token}` }, query: { what }, body }, r);
    return r;
  };
  await call(till, "PUT", "vat", { vatPct: 0 });
  const ctx = (over = {}) => ({ orgId: org.id, branches: ["register"], capabilities: ALL_CAPS, features: ALL_FEATURES, metrics: {}, timeZone: "Asia/Dubai", orgName: "Olive House", ...over });
  return { org, call, ctx };
}
const order = (over = {}) => ({ branchId: "register", orderType: "takeaway", lines: [{ itemId: "wrap", qty: 1 }], payments: [{ type: "cash", received: 50 }], ...over });

await test("shifts: who closed, what was expected, what was counted, and the gap", async () => {
  const { call, ctx } = await shop();
  await call(till, "POST", "shift-open", { branchId: "register", float: 100 });
  await call(till, "POST", "sale", order());
  await call(till, "POST", "shift-close", { branchId: "register", counted: 140 });
  await call(till, "POST", "shift-open", { branchId: "register", float: 50 });
  const out = await dm.runTool("get_register_shifts", {}, ctx());
  assert.equal(out.closed.length, 1);
  near(out.closed[0].cashExpected, 150);
  near(out.closed[0].cashCounted, 140);
  near(out.closed[0].difference, -10);
  assert.equal(out.short, 1);
  assert.equal(out.open.length, 1);
  near(out.open[0].float, 50);
  /* Another branch's drawer is not this person's to read. */
  assert.equal((await dm.runTool("get_register_shifts", {}, ctx({ branches: ["s-elsewhere"] }))).closed.length, 0);
});

await test("customers: visits, spend and points — and no contact details", async () => {
  const { call, ctx } = await shop();
  await call(till, "PUT", "settings", { section: "options", value: { useShifts: false, loyaltyPct: 10 } });
  const sara = (await call(till, "PUT", "customer", { name: "Sara Ali", phone: "+971500000001", email: "sara@example.com" })).body.customer;
  await call(till, "POST", "sale", order({ customerId: sara.id }));
  await call(till, "POST", "sale", order({ customerId: sara.id }));
  const out = await dm.runTool("get_customers", {}, ctx());
  assert.equal(out.customers[0].name, "Sara Ali");
  assert.equal(out.customers[0].visits, 2);
  near(out.customers[0].spent, 100);
  near(out.customers[0].points, 10);
  const text = JSON.stringify(out);
  assert.ok(!text.includes("971500000001") && !text.includes("sara@example.com"), "a phone number or an address reached the model");
  assert.equal((await dm.runTool("get_customers", { search: "nobody" }, ctx())).customers.length, 0);
});

await test("setup: stores, VAT, payment types and the menu's shape", async () => {
  const { call, ctx } = await shop();
  await call(till, "PUT", "vat", { vatPct: 5 });
  await call(till, "PUT", "variants", { itemId: "wrap", variants: [{ name: "Regular", price: 50 }, { name: "Large", price: 60, scale: 1.5 }] });
  const out = await dm.runTool("get_register_setup", {}, ctx());
  assert.deepEqual(out.stores.map((s) => s.id), ["register"]);
  assert.equal(out.vatPct, 5);
  assert.ok(out.paymentTypes.some((p) => p.kind === "cash"));
  assert.deepEqual(out.menu.withVariants[0].variants.map((v) => v.name), ["Regular", "Large"]);
});

await test("history: a quarter, a year or all time, added up by the server", async () => {
  const { call, ctx } = await shop();
  await call(till, "PUT", "settings", { section: "options", value: { useShifts: false } });
  await call(till, "POST", "sale", order());
  await call(till, "POST", "sale", order());
  const year = await dm.runTool("get_sales_history", { period: "365" }, ctx());
  assert.equal(year.period.key, "year");
  near(year.totals.sales, 100);
  assert.equal(year.totals.receipts, 2);
  assert.equal(year.totals.salesDelta, null, "nothing the year before to compare with");
  assert.equal(year.bucket, "week");
  near(year.series.reduce((s, b) => s + b.sales, 0), 100);
  assert.equal((await dm.runTool("get_sales_history", { period: "all" }, ctx())).period.key, "all");
  /* A branch this person cannot see contributes nothing to their figures. */
  near((await dm.runTool("get_sales_history", {}, ctx({ branches: ["s-elsewhere"] }))).totals.sales, 0);
});

await test("channels: fees, what each item leaves, the price that fixes it, and what was sold", async () => {
  const { call, ctx } = await shop();
  await call(till, "PUT", "settings", { section: "options", value: { useShifts: false } });
  await call(channels, "POST", "channel", { preset: "talabat" });
  await call(channels, "POST", "rule", { channelId: "c-talabat", commissionPct: 30, validFrom: "2026-01-01" });
  await call(till, "POST", "sale", order({ channelId: "c-talabat", payments: [{ type: "card" }] }));
  const out = await dm.runTool("get_sales_channels", {}, ctx());
  const t = out.channels.find((c) => c.id === "c-talabat");
  assert.equal(t.fees.commissionPct, 30);
  const wrap = t.items.find((i) => i.item === "Wrap");
  near(wrap.profit, 20);
  near(wrap.inStoreProfit, 35);
  near(wrap.priceToKeepInStoreProfit, 71.43);
  near(out.last30Days.rows.find((r) => r.channelId === "c-talabat").contribution, 20);
  assert.ok(out.alerts.some((a) => a.kind === "belowInStore"));
  assert.match(out.note, /NO rent/);
});

await test("each belongs to its screen's package, and to those allowed to see it", async () => {
  const { ctx } = await shop();
  assert.equal(dm.TOOL_FEATURE.get_sales_channels, SCREEN_FEATURE.channels);
  assert.equal(dm.TOOL_FEATURE.get_sales_history, SCREEN_FEATURE.overview);
  for (const name of ["get_register_shifts", "get_customers", "get_register_setup"]) {
    assert.equal(dm.TOOL_FEATURE[name], SCREEN_FEATURE.till, `${name}: the register is not a package`);
  }
  const noCosts = ctx({ features: ["table", "assistant"] });
  assert.equal((await dm.runTool("get_sales_channels", {}, noCosts)).error, "package");
  assert.ok(!dm.toolsFor(["table", "assistant"]).some((t) => t.name === "get_sales_channels"));
  assert.ok(dm.toolsFor(["assistant"]).some((t) => t.name === "get_register_shifts"), "what is not a package is always offered");
  /* A cashier sees the day's table, not what the business keeps per dish. */
  assert.equal((await dm.runTool("get_sales_channels", {}, ctx({ capabilities: ["view:dashboard"] }))).error, "forbidden");
  assert.equal((await dm.runTool("get_register_shifts", {}, ctx({ capabilities: ["view:inventory"] }))).error, "forbidden");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
