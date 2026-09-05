/* Domain isolation, and the one calculation the model is not allowed to do.

   What these protect: no tool returns a row from another domain, every row
   carries a type and a domain, a role that cannot read a domain gets a refusal
   rather than data, net profit subtracts overheads that the old "net profit"
   never did, and an unknown tool name is refused rather than guessed at. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const dm = await import("./_domains.js");
const fc = await import("./_fixedcosts.js");
const vc = await import("./_varcosts.js");
const rc = await import("./_recipes.js");
const inv = await import("./_inventory.js");
const mv = await import("./_movements.js");

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

const ALL = ["view:dashboard", "view:costs", "view:inventory", "view:profitability"];

const ctx = (over = {}) => ({
  orgId: "org1",
  branches: ["b1"],
  capabilities: ALL,
  method: "wavg",
  metrics: { totals: { sales: 100000, cost: 30000, receipts: 1200, avgTicket: 83.3, discounts: 0 },
    items: [{ name: "Cheeseburger", qty: 400, revenue: 16000 }] },
  ...over,
});

/* A business with one overhead, one dish, and one thing on the shelf. */
async function seed() {
  await fc.saveCost("org1", { name: "Rent", amount: 18000, period: "monthly" });
  await fc.saveCost("org1", { name: "Software licence", amount: 8400, period: "yearly" });
  await vc.saveVarCost("org1", { title: "Packaging", amount: 1620, date: vc.todayISO() });

  await inv.saveIngredient("org1", { name: "Beef mince", stockUnit: "kg" });
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "receive", qty: 20, unit: "kg", unitCost: 30,
  });
  await rc.saveVersion("org1", {
    menuItem: "Cheeseburger", portions: 1, sellPrice: 32, category: "Mains",
    lines: [{ ingredientId: "beef-mince", qty: 150, unit: "g" }],
  });
}

/* ---------------------- isolation ------------------------------- */

await test("the overhead tool returns overheads and nothing else", async () => {
  await seed();
  const out = await dm.getFixedCosts(ctx());

  assert.equal(out.domain, "OPEX");
  assert.ok(out.entries.length >= 3);
  for (const row of out.entries) {
    assert.equal(row.domain, "OPEX");
    assert.ok(["FIXED_COST", "VARIABLE_COST"].includes(row.type), `stray type ${row.type}`);
  }
  /* Nothing about beef, at all. */
  assert.ok(!JSON.stringify(out).toLowerCase().includes("beef"));
  assert.equal(out.fixedMonthlyTotal, 18700); // 18000 + 8400/12
  assert.equal(out.variableMonthTotal, 1620);
});

await test("the recipe tool returns components and no overheads", async () => {
  await seed();
  const out = await dm.getRecipeDetails(ctx(), { dish_name: "Cheeseburger" });

  assert.equal(out.domain, "RECIPE");
  assert.equal(out.dish, "Cheeseburger");
  for (const row of out.components) {
    assert.equal(row.domain, "RECIPE");
    assert.equal(row.type, "RECIPE_INGREDIENT");
  }
  /* Scanned over the data rather than the whole payload: the note deliberately
     names rent in order to warn against it, and asserting on prose would make
     this test fail for saying the right thing. What must not appear is an
     overhead among the rows. */
  const rows = JSON.stringify([...out.components, ...out.packaging]).toLowerCase();
  assert.ok(!rows.includes("rent"), "rent leaked into a recipe");
  assert.ok(!rows.includes("licence"), "an overhead leaked into a recipe");
  assert.ok(!rows.includes("fixed_cost"), "an OPEX row leaked into a recipe");

  /* 150 g of beef at 30/kg. */
  assert.equal(out.components[0].quantity, 150);
  assert.equal(out.components[0].unit, "g");
  assert.equal(out.totalCostPerPortion, 4.5);
});

await test("the inventory tool returns stock, not recipe quantities", async () => {
  await seed();
  const out = await dm.getInventoryLevels(ctx());

  assert.equal(out.domain, "RAW_INVENTORY");
  assert.equal(out.items.length, 1);
  const beef = out.items[0];
  assert.equal(beef.type, "RAW_INVENTORY");
  /* 20 kg received, 0 consumed — the shelf, not the 150 g a burger uses. */
  assert.equal(beef.quantityOnHand, 20);
  assert.equal(beef.unit, "kg");
  assert.equal(beef.stockValue, 600);
});

await test("the sales tool carries revenue and never a cost", async () => {
  const out = await dm.getPosSalesMetrics(ctx(), {});

  assert.equal(out.domain, "POS_SALES");
  assert.equal(out.grossRevenue, 100000);
  for (const row of out.items) {
    assert.equal(row.type, "POS_SALE_ITEM");
    assert.equal(row.cost, undefined, "sales must not carry cost");
  }
  /* Letting this return cost would put the same number on both sides of the
     profit calculation. */
  assert.ok(!("costOfGoodsSold" in out));
  assert.ok(!("cost" in out));
});

/* ---------------------- authorization ---------------------------- */

await test("a role that cannot read a domain is refused, not given data", async () => {
  await seed();
  const chef = ctx({ capabilities: ["view:inventory"] });

  const opex = await dm.getFixedCosts(chef);
  assert.equal(opex.error, "forbidden");
  assert.deepEqual(opex.entries, []);

  const recipe = await dm.getRecipeDetails(chef, { dish_name: "Cheeseburger" });
  assert.equal(recipe.error, "forbidden");

  /* But the domain they can read still works. */
  const stock = await dm.getInventoryLevels(chef);
  assert.equal(stock.error, undefined);
  assert.equal(stock.items.length, 1);
});

await test("net profit is refused when any component domain is unreadable", async () => {
  await seed();
  const out = await dm.calculateNetProfit(ctx({ capabilities: ["view:dashboard"] }));
  assert.equal(out.error, "forbidden");
  assert.ok(out.message.includes("RECIPE"));
});

/* ---------------------- the calculation -------------------------- */

await test("net profit subtracts the overheads that gross profit never did", async () => {
  await seed();
  const out = await dm.calculateNetProfit(ctx());

  assert.equal(out.type, "NET_PROFIT_CALCULATION");
  assert.equal(out.components.grossRevenue, 100000);
  assert.equal(out.components.costOfGoodsSold, 30000);
  assert.equal(out.components.fixedOperatingCosts, 18700);
  assert.equal(out.components.variableOperatingCosts, 1620);

  /* The figure the dashboard has always called "net profit" is this one. */
  assert.equal(out.grossProfit, 70000);
  /* The figure it actually is. */
  assert.equal(out.netProfit, 49680);
  assert.equal(out.netMarginPct, 49.68);
  assert.equal(out.grossMarginPct, 70);
});

await test("the components come back with the answer so it can be checked", async () => {
  await seed();
  const out = await dm.calculateNetProfit(ctx());
  const c = out.components;
  assert.equal(
    Math.round(c.grossRevenue - c.costOfGoodsSold - c.fixedOperatingCosts - c.variableOperatingCosts),
    out.netProfit,
    "the stated components must reproduce the stated answer");
  assert.ok(out.formula.includes("grossRevenue"));
});

await test("incomplete cost coverage is stated rather than absorbed", async () => {
  await seed();
  const out = await dm.calculateNetProfit(ctx({
    metrics: { ...ctx().metrics, costCoverage: 0.6 },
  }));
  assert.equal(out.costCoverage, 0.6);
  assert.ok(out.note.toLowerCase().includes("incomplete"));
});

/* ---------------------- dispatch --------------------------------- */

await test("every advertised tool exists and is reachable by name", async () => {
  await seed();
  const names = dm.TOOLS.map((t) => t.name);
  assert.deepEqual(names.sort(), [
    "calculate_net_profit", "get_fixed_costs", "get_inventory_levels",
    "get_pos_sales_metrics", "get_recent_receipts", "get_recipe_details",
    "get_stock_movements", "get_suppliers_and_orders",
  ]);

  for (const name of names) {
    const out = await dm.runTool(name, {}, ctx());
    /* The receipts tool reads the till rather than the store, so with no POS
       attached it refuses — which is the right answer, not a failure. Every
       other tool must come back clean. */
    if (name === "get_recent_receipts") {
      assert.equal(out.error, "notconnected");
      continue;
    }
    assert.equal(out.error, undefined, `${name} failed: ${out.message}`);
  }
});

await test("the receipts tool says there is no till rather than inventing one", async () => {
  /* The complaint that produced this tool: asked for the last ten sales, the
     assistant said it could only see aggregates and told the owner to open
     their POS. It was right — there was no tool. There is now, and when it
     genuinely cannot read the till it says so instead of falling back to
     totals and presenting them as transactions. */
  const out = await dm.getRecentReceipts(ctx(), {});
  assert.equal(out.error, "notconnected");
  assert.deepEqual(out.receipts, []);
});

await test("a role without the sales domain cannot read receipts", async () => {
  const chef = ctx({ capabilities: ["view:inventory"], posToken: "x" });
  assert.equal((await dm.getRecentReceipts(chef, {})).error, "forbidden");
});

await test("the receipts tool is in the sales domain and carries no cost", () => {
  const tool = dm.TOOLS.find((t) => t.name === "get_recent_receipts");
  assert.ok(tool, "advertised");
  /* Letting a receipt carry cost would put the same figure on both sides of
     the profit calculation, which is what the domain split exists to stop. */
  assert.ok(/no cost/i.test(tool.description));
  assert.ok(dm.DOMAIN_GUARDRAIL.includes("get_recent_receipts"));
});

await test("an unknown tool name is refused rather than defaulted", async () => {
  const out = await dm.runTool("select_star_from_everything", {}, ctx());
  assert.equal(out.error, "unknown_tool");
});

await test("every tool description says what it does not contain", () => {
  /* The negative half is what stops a question about rent being answered out
     of the recipe tool, so it is worth asserting rather than trusting. */
  for (const tool of dm.TOOLS) {
    const says = ["no ", "not ", "never"].some((w) => tool.description.toLowerCase().includes(w));
    assert.ok(says,
      `${tool.name} does not say what it excludes`);
  }
});

await test("the guardrail names every tool it claims to govern", () => {
  for (const tool of dm.TOOLS) {
    assert.ok(dm.DOMAIN_GUARDRAIL.includes(tool.name),
      `guardrail does not mention ${tool.name}`);
  }
});

/* ---------------- what happened, not just what is left ---------- */

/* "How much is there" was answerable; "why is there that much" was not, and
   it is the question people actually bring. */

await test("the ledger is readable, and says what caused each change", async () => {
  await seed();
  await mv.recordMovement("org1", "b1", {
    ingredientId: "beef-mince", type: "consume", qty: 300, unit: "g",
    auto: true, ref: "1-1043",
  });

  const out = await dm.getStockMovements(ctx(), { ingredient_name: "Beef mince" });
  assert.equal(out.domain, "RAW_INVENTORY");
  assert.equal(out.ingredient, "Beef mince");

  for (const row of out.movements) {
    assert.equal(row.type, "STOCK_MOVEMENT");
    assert.equal(row.domain, "RAW_INVENTORY");
  }

  const sale = out.movements.find((m) => m.movement === "consume");
  assert.equal(sale.automatic, true, "a sale-driven deduction is distinguishable from a typed one");
  assert.equal(sale.reference, "1-1043", "and traceable to the receipt that caused it");

  const delivery = out.movements.find((m) => m.movement === "receive");
  assert.ok(delivery, "the delivery that put it there is in the same answer");
});

await test("an ingredient nobody has is named, not guessed at", async () => {
  await seed();
  const out = await dm.getStockMovements(ctx(), { ingredient_name: "Truffle" });
  assert.equal(out.error, "notfound");
  assert.ok(out.items.includes("Beef mince"), "the real names are offered instead");
});

await test("the ledger carries no overheads and no recipe quantities", async () => {
  await seed();
  const out = await dm.getStockMovements(ctx(), {});
  const text = JSON.stringify(out.movements).toLowerCase();
  assert.ok(!text.includes("rent"));
  assert.ok(!text.includes("fixed_cost"));
  assert.ok(!text.includes("recipe_ingredient"));
});

/* ---------------- why stock is not moving ----------------------- */

await test("the inventory tool says whether sales deduct at all", async () => {
  await seed();
  const out = await dm.getInventoryLevels(ctx());

  /* Three things stop stock falling: no sales arriving, no recipe on the
     dish, or depletion switched off. The third was invisible, so the answer
     was always a hunt through recipes. */
  assert.equal(typeof out.settings.deductsFromSales, "boolean");
  assert.equal(out.settings.deductsFromSales, true, "on by default");

  await inv.saveMeta("org1", { autoDepleteFromSales: false });
  const off = await dm.getInventoryLevels(ctx());
  assert.equal(off.settings.deductsFromSales, false);
});

await test("a till that keeps its own stock also stops deduction", async () => {
  await seed();
  await inv.saveMeta("org1", { stockSource: "pos" });
  const out = await dm.getInventoryLevels(ctx());
  assert.equal(out.settings.stockSource, "pos");
  assert.equal(out.settings.deductsFromSales, false,
    "both sides deducting the same sale would double it");
});

/* ---------------- suppliers and what is on order ---------------- */

await test("suppliers and open orders are readable and tagged", async () => {
  await seed();
  await inv.saveSupplier("org1", { name: "Gulf Fresh", leadTimeDays: 2 });

  const out = await dm.getSuppliersAndOrders(ctx());
  assert.equal(out.domain, "RAW_INVENTORY");
  assert.equal(out.suppliers[0].type, "SUPPLIER");
  assert.equal(out.suppliers[0].name, "Gulf Fresh");
  assert.equal(out.suppliers[0].leadTimeDays, 2);
  assert.ok(Array.isArray(out.orders));
});

await test("a role without inventory cannot read either of the new tools", async () => {
  await seed();
  const cashier = ctx({ capabilities: ["view:dashboard"] });
  assert.equal((await dm.getStockMovements(cashier, {})).error, "forbidden");
  assert.equal((await dm.getSuppliersAndOrders(cashier)).error, "forbidden");
});


console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
