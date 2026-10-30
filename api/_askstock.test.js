/* The assistant reading the storeroom — and everything else the business paid for.

   "What have I got in stock" came back empty. The chat route resolved the
   asker's branches from an empty roster, so every tool walked no ledgers: the
   inventory tool summed nothing, movements found nothing, purchase orders
   were none. The brief carried leakage and alerts but never the balances, so
   nothing else filled the gap.

   These check that the tools reach the branches the stock screen reaches,
   that the brief now carries what is on the shelf, that what is offered and
   what is answered follow the packages bought, and that the model cannot
   widen a branch scope by naming one. */

import assert from "node:assert/strict";
import { backend, __resetMemory, setJSON } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

/* Never reach a real till from a test. */
delete process.env.POS_ACCESS_TOKEN;
delete process.env.LOYVERSE_ACCESS_TOKEN;

const { createAccount, getAccount } = await import("./_accounts.js");
const { createOrg, orgFor } = await import("./_org.js");
const inv = await import("./_inventory.js");
const mv = await import("./_movements.js");
const dm = await import("./_domains.js");
const gr = await import("./_grounding.js");
const { askerScopeFor } = await import("./chat.js");
const { SCREEN_FEATURE } = await import("../src/entitlements.js");

let failures = 0;
async function test(name, fn) {
  __resetMemory();
  try {
    await fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const ALL = ["table", "assistant", "operations", "costs"];
const ASSISTANT_ONLY = ["table", "assistant"];

/* An owner with no till connected, whose stock is kept where the Inventory
   screen keeps it: the register's branch. */
async function ownerWithStock() {
  await createAccount({ username: "owner1", password: "Ask-test-9x!" });
  const account = await getAccount("owner1");
  const org = await orgFor(account);
  await inv.saveIngredient(org.id, { name: "Chicken thigh", stockUnit: "kg" });
  await mv.recordMovement(org.id, "register", {
    ingredientId: "chicken-thigh", type: "receive", qty: 10, unit: "kg", unitCost: 22.8,
  });
  return { account, org };
}

const toolCtx = (scope, features) => ({
  orgId: scope.org.id,
  branches: scope.authorized,
  capabilities: scope.capabilities,
  features,
  method: "wavg",
  metrics: {},
});

/* ── The branches the tools read ── */

await test("the assistant's tools reach the branch the stock screen keeps stock in", async () => {
  const { account } = await ownerWithStock();
  const { scope } = await askerScopeFor(account);
  assert.deepEqual(scope.authorized, ["register"]);

  const out = await dm.runTool("get_inventory_levels", {}, toolCtx(scope, ALL));
  const chicken = out.items.find((i) => i.name === "Chicken thigh");
  assert.ok(chicken, "the delivered chicken is visible to the assistant");
  assert.equal(chicken.quantityOnHand, 10);
  assert.equal(chicken.stockValue, 228);
});

await test("the stock ledger is readable through the same scope", async () => {
  const { account } = await ownerWithStock();
  const { scope } = await askerScopeFor(account);
  const out = await dm.runTool("get_stock_movements", { ingredient_name: "Chicken thigh" }, toolCtx(scope, ALL));
  assert.equal(out.movements.length, 1);
  assert.equal(out.movements[0].movement, "receive");
});

/* ── What the business paid for ── */

await test("only the tools for packages the business bought are offered", async () => {
  const offered = (features) => dm.toolsFor(features).map((t) => t.name);
  assert.ok(!offered(ASSISTANT_ONLY).includes("get_inventory_levels"));
  assert.ok(!offered(ASSISTANT_ONLY).includes("get_fixed_costs"));
  assert.ok(offered(ASSISTANT_ONLY).includes("calculate_net_profit"), "the Overview is free");
  assert.equal(offered(ALL).length, dm.TOOLS.length, "everything, for a business with every package");
});

await test("a tool outside the packages bought refuses by naming the package", async () => {
  const { account } = await ownerWithStock();
  const { scope } = await askerScopeFor(account);
  const out = await dm.runTool("get_inventory_levels", {}, toolCtx(scope, ASSISTANT_ONLY));
  assert.equal(out.error, "package");
  assert.equal(out.package, "operations");
  assert.equal(out.items, undefined, "no stock leaks out with the refusal");
});

await test("a caller that forgets the packages gets nothing, not everything", async () => {
  const { account } = await ownerWithStock();
  const { scope } = await askerScopeFor(account);
  const out = await dm.runTool("get_inventory_levels", {}, { ...toolCtx(scope, ALL), features: undefined });
  assert.equal(out.error, "package");
});

await test("each tool belongs to the package of the screen it mirrors", async () => {
  const S = SCREEN_FEATURE;
  const T = dm.TOOL_FEATURE;
  for (const name of ["get_inventory_levels", "get_stock_movements", "get_suppliers_and_orders"]) {
    assert.equal(T[name], S.inventory, name);
  }
  assert.equal(T.get_stock_alerts, S.alerts);
  assert.equal(T.get_recipe_details, S.recipes);
  assert.equal(T.get_fixed_costs, S.costs);
  assert.equal(T.get_recent_receipts, S.sales);
  assert.equal(T.get_pos_sales_metrics, S.overview);
  assert.equal(T.calculate_net_profit, S.overview);
  assert.equal(T.get_staff_attendance, null, "the employees screen is gated by role, not by plan");
  for (const t of dm.TOOLS) assert.ok(t.name in T, `${t.name} has a package`);
});

/* ── A branch named by the model ── */

await test("the alerts tool will not read a branch the asker cannot see", async () => {
  const orgId = "org-alerts";
  await inv.saveIngredient(orgId, { name: "Saffron", stockUnit: "g", reorderPoint: 100 });
  await mv.recordMovement(orgId, "b2", { ingredientId: "saffron", type: "receive", qty: 5, unit: "g", unitCost: 9 });
  const ctx = { orgId, branches: ["b1"], capabilities: ["view:inventory"], features: ALL, method: "wavg", metrics: {} };

  const own = await dm.runTool("get_stock_alerts", { branches: ["b2"] }, ctx);
  assert.ok(!own.entries.some((e) => /saffron/i.test(JSON.stringify(e))), "nothing from the other branch");

  const theirs = await dm.runTool("get_stock_alerts", {}, { ...ctx, branches: ["b2"] });
  assert.ok(theirs.entries.some((e) => /saffron/i.test(JSON.stringify(e))), "the same alert, for someone who can see b2");
});

/* ── The brief ── */

async function groundedOwner(features) {
  const org = await createOrg({ ownerUsername: "boss", name: "Kitchen", branchAllowance: null });
  const acct = { username: "boss", orgId: org.id, email: "boss@x.co", business: "" };
  await setJSON("acct:boss", acct);
  await inv.saveIngredient(org.id, { name: "Tahini", stockUnit: "kg", reorderPoint: 5 });
  await mv.recordMovement(org.id, "b1", { ingredientId: "tahini", type: "receive", qty: 4, unit: "kg", unitCost: 14 });
  return gr.groundingFor(acct, { allBranchIds: ["b1"], branchNames: { b1: "Main" }, features });
}

await test("the brief says what is on the shelf, with its value and its reorder state", async () => {
  const out = await groundedOwner(ALL);
  assert.ok(out.brief.includes("STOCK ON HAND NOW"), out.brief);
  const line = out.brief.split("\n").find((l) => l.startsWith("Tahini:"));
  assert.ok(line, "the tahini is listed");
  assert.ok(line.includes("4 kg"));
  assert.ok(line.includes("AED 56"));
  assert.ok(line.includes("reorder point"));
});

await test("without the operations package the shelf is absent, and named as not bought", async () => {
  const out = await groundedOwner(ASSISTANT_ONLY);
  assert.ok(!out.brief.includes("STOCK ON HAND"));
  assert.ok(!out.brief.includes("Tahini"));
  assert.ok(out.entitlements.withheld.includes("operations"));
  assert.ok(out.brief.includes("the stock on hand"), "the package is described as containing it");
});

await test("the stock section belongs to the inventory screen's package", async () => {
  assert.equal(gr.SECTION_FEATURE.stock, SCREEN_FEATURE.inventory);
});

/* ── Through the chat route ──

   The model is replaced by a stub that asks for the inventory tool once and
   then answers, so what is checked is exactly what the route sends: the tools
   it offers, the brief it writes, and what the tool returned. The business
   has no till connected — which used to be a 409 before anything was read. */

const { grantPlan } = await import("./_accounts.js");
const { issueToken } = await import("./_auth.js");
const chat = (await import("./chat.js")).default;

function fakeRes() {
  const r = {
    code: null, body: null, headers: {},
    setHeader(k, v) { r.headers[k] = v; return r; },
    status(c) { r.code = c; return r; },
    json(b) { r.body = b; return r; },
  };
  return r;
}

await test("asked what is in storage, the assistant is briefed on the shelf and its tool reads it", async () => {
  const { account } = await ownerWithStock();
  await grantPlan("owner1", ["assistant", "operations", "costs"], 1);
  const token = issueToken("owner1", account.tokenVersion || 0);

  const sent = [];
  const realFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "stub-key-for-tests";
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("api.anthropic.com")) throw new Error(`unexpected fetch: ${url}`);
    sent.push(JSON.parse(init.body));
    const reply = sent.length === 1
      ? { content: [{ type: "tool_use", id: "t1", name: "get_inventory_levels", input: {} }] }
      : { content: [{ type: "text", text: "10 kg of chicken thigh." }] };
    return { ok: true, json: async () => reply };
  };
  const res = fakeRes();
  try {
    await chat({
      method: "POST", headers: { authorization: `Bearer ${token}` },
      body: { messages: [{ role: "user", content: "What is in my storage?" }], stream: false },
    }, res);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.ANTHROPIC_API_KEY;
  }

  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.text, "10 kg of chicken thigh.");

  const [first, second] = sent;
  assert.ok(first.tools.some((t) => t.name === "get_inventory_levels"), "the stock tool is offered");
  assert.ok(first.system.includes("STOCK ON HAND NOW") && first.system.includes("Chicken thigh"), "the shelf is in the brief");
  assert.ok(first.system.includes("SALES: none"), "no till is said, not hidden");

  const result = JSON.parse(second.messages.at(-1).content[0].content);
  assert.equal(result.items.find((i) => i.name === "Chicken thigh").quantityOnHand, 10);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
