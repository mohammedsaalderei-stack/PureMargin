/* Four domains, four tools, and no way to read across them.

   ── The problem this exists to stop ──────────────────────────────────────

   Until now the assistant was handed one prose brief containing everything at
   once: overheads, recipes, stock and sales, flattened into paragraphs. A
   language model reading that has nothing structural telling it that rent is
   not an ingredient. It answers "what does my burger cost?" with a number that
   quietly includes a share of the rent, or reports food cost and leaves the
   salaries out of the month — and both readings are available in the same
   block of text, so which one comes out is a matter of phrasing.

   That is not a prompting problem and cannot be fixed by asking nicely. The
   fix is that the four kinds of money live behind four separate tools, each
   reading exactly one store, each returning rows stamped with what they are.
   A question about overheads calls the overhead tool and receives overheads.
   There is no query that returns a mixture, because no function here can
   produce one.

   ── The four ────────────────────────────────────────────────────────────

   OPEX          Rent, salaries, licences. What goes out whether the room is
                 full or empty. Never a component of a dish.
   RECIPE        What a dish is made of. Grams of beef, millilitres of sauce.
                 Never a monthly bill.
   RAW_INVENTORY What is on the shelf and what it was bought for. The bridge
                 between an invoice and a recipe line, and neither of them.
   POS_SALES     What was sold and for how much. Revenue and counts, never
                 cost — cost is derived from RECIPE against POS_SALES, which
                 is what `calculateNetProfit` does and nothing else may.

   ── Why the arithmetic is here and not in the model ─────────────────────

   `calculateNetProfit` is a function, not a paragraph. A model asked to
   subtract three numbers will usually get it right and will occasionally not,
   and the failure is silent: a plausible figure, in a confident sentence, that
   nobody re-adds. Worse, it has to decide *which* numbers, and that decision
   is the crossover this file exists to prevent.

   So the model is not asked. It calls one function that reads each domain
   through that domain's own reader and returns the components alongside the
   result, so an answer can show its working and a reader can check it.

   ── Authorization ───────────────────────────────────────────────────────

   Every tool takes the same `ctx`, which carries the org, the branch scope
   already intersected with what the session may see, and the capabilities.
   A tool the caller's role cannot use returns a refusal rather than data, and
   the refusal names the domain so the assistant can say what it cannot see
   instead of inventing what it cannot read. */

import { monthlyTotal as fixedMonthlyTotal, listCosts } from "./_fixedcosts.js";
import { listVarCosts, totalOf as varTotalOf, monthOf } from "./_varcosts.js";
import { listRecipes, costedList, costedRecipe, effectiveVersion } from "./_recipes.js";
import { listIngredients, listSuppliers, getMeta } from "./_inventory.js";
import { balances, listMovements } from "./_movements.js";
import { costBasis, costFrom } from "./_costing.js";
import { ingestionStatus } from "./_loyversehook.js";
import { listOrders } from "./_purchasing.js";
import { rawReceipts } from "./_data.js";
import { listEdits, applyEdit, receiptIdOf } from "./_saleedits.js";
import { provider } from "./_pos.js";

/* The tag on every row. Deliberately shouty and deliberately redundant with
   the tool that produced it: a row that travels into a conversation and comes
   back out in a later turn still says what it is. */
export const ENTITY = {
  FIXED_COST: "FIXED_COST",
  VARIABLE_COST: "VARIABLE_COST",
  RECIPE_INGREDIENT: "RECIPE_INGREDIENT",
  RECIPE_PACKAGING: "RECIPE_PACKAGING",
  RAW_INVENTORY: "RAW_INVENTORY",
  POS_SALE_ITEM: "POS_SALE_ITEM",
  POS_RECEIPT: "POS_RECEIPT",
  STOCK_MOVEMENT: "STOCK_MOVEMENT",
  SUPPLIER: "SUPPLIER",
  PURCHASE_ORDER: "PURCHASE_ORDER",
};

export const DOMAIN = {
  OPEX: "OPEX",
  RECIPE: "RECIPE",
  RAW_INVENTORY: "RAW_INVENTORY",
  POS_SALES: "POS_SALES",
};

/* What each domain needs to be read at all. Matches what the equivalent screen
   already enforces, so the assistant cannot become a way around a permission. */
const NEEDS = {
  [DOMAIN.OPEX]: "view:dashboard",
  [DOMAIN.RECIPE]: "view:costs",
  [DOMAIN.RAW_INVENTORY]: "view:inventory",
  [DOMAIN.POS_SALES]: "view:dashboard",
};

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

function refuse(domain) {
  return {
    domain,
    error: "forbidden",
    message: `This account cannot read the ${domain} domain.`,
    entries: [],
  };
}

const allowed = (ctx, domain) => (ctx.capabilities || []).includes(NEEDS[domain]);

/* ── OPEX ────────────────────────────────────────────────────────────────

   Fixed operating costs, and the variable overheads that sit beside them —
   packaging bought in bulk, maintenance, delivery commission. Both are
   overheads. Neither is ever a recipe component, which is the whole point of
   them being here and not there. */
export async function getFixedCosts(ctx, { month } = {}) {
  if (!allowed(ctx, DOMAIN.OPEX)) return refuse(DOMAIN.OPEX);

  const costs = await listCosts(ctx.orgId);
  const key = month || monthOf(new Date().toISOString().slice(0, 10));
  const variable = await listVarCosts(ctx.orgId, { month: key });

  const entries = costs.map((c) => ({
    type: ENTITY.FIXED_COST,
    domain: DOMAIN.OPEX,
    id: c.id,
    name: c.name,
    period: c.period,
    amount: Number(c.amount),
    monthlyAmount: c.period === "yearly" ? round2(Number(c.amount) / 12) : round2(Number(c.amount)),
    currency: "AED",
  }));

  const variableEntries = variable.map((c) => ({
    type: ENTITY.VARIABLE_COST,
    domain: DOMAIN.OPEX,
    id: c.id,
    name: c.title,
    date: c.date,
    amount: Number(c.amount),
    currency: "AED",
  }));

  return {
    domain: DOMAIN.OPEX,
    month: key,
    currency: "AED",
    entries: [...entries, ...variableEntries],
    fixedMonthlyTotal: fixedMonthlyTotal(costs),
    variableMonthTotal: varTotalOf(variable),
    /* Stated so an answer cannot present overheads as though they were the
       cost of a dish. */
    note: "Operating overheads only. These are never components of a recipe.",
  };
}

/* ── RECIPE ──────────────────────────────────────────────────────────────

   What a dish is made of, and what those components cost. No overheads reach
   this function: it reads the recipe store and the ingredient cost basis, and
   there is no path from here to rent. */
export async function getRecipeDetails(ctx, { dish_name: dishName } = {}) {
  if (!allowed(ctx, DOMAIN.RECIPE)) return refuse(DOMAIN.RECIPE);

  const wanted = String(dishName || "").trim().toLowerCase();
  if (!wanted) {
    /* No dish named: the menu, so the assistant can pick one rather than
       guessing at a name that may not exist. */
    const list = await costedList(ctx.orgId, ctx.branches, { method: ctx.method });
    return {
      domain: DOMAIN.RECIPE,
      currency: "AED",
      dishes: list.map((r) => ({
        type: "RECIPE",
        domain: DOMAIN.RECIPE,
        id: r.id,
        dish: r.menuItem,
        category: r.category || null,
        sellPrice: r.sellPrice,
        costPerPortion: r.perPortion?.total ?? null,
        costComplete: r.complete,
        costFromEstimates: r.estimatedCount > 0,
      })),
      note: "Dish specifications and food cost only. Contains no operating overheads.",
    };
  }

  const all = await listRecipes(ctx.orgId);
  const hit = all.find((r) => r.menuItem.trim().toLowerCase() === wanted)
    || all.find((r) => r.menuItem.trim().toLowerCase().includes(wanted));
  if (!hit) {
    return {
      domain: DOMAIN.RECIPE,
      error: "notfound",
      message: `No recipe named "${dishName}".`,
      dishes: all.map((r) => r.menuItem),
    };
  }

  const costed = await costedRecipe(ctx.orgId, hit.id, ctx.branches, { method: ctx.method });
  const version = costed?.effective || effectiveVersion(hit);

  const line = (l, type) => ({
    type,
    domain: DOMAIN.RECIPE,
    ingredientId: l.ingredientId,
    ingredient_name: l.name,
    quantity: l.qty,
    unit: l.unit,
    costPerPortion: l.cost === null || l.cost === undefined
      ? null
      : round2(l.cost / (version?.portions || 1)),
    costed: l.cost !== null && l.cost !== undefined,
    costFromEstimate: Boolean(l.estimated),
  });

  return {
    domain: DOMAIN.RECIPE,
    currency: "AED",
    dish: hit.menuItem,
    category: hit.category || null,
    sellPrice: hit.sellPrice,
    portions: version?.portions ?? 1,
    components: (costed?.costing?.lines || []).map((l) => line(l, ENTITY.RECIPE_INGREDIENT)),
    packaging: (costed?.costing?.packaging || []).map((l) => line(l, ENTITY.RECIPE_PACKAGING)),
    foodCostPerPortion: costed?.costing?.perPortion?.foodCost ?? null,
    packagingCostPerPortion: costed?.costing?.perPortion?.packagingCost ?? null,
    totalCostPerPortion: costed?.costing?.perPortion?.total ?? null,
    grossMargin: costed?.margin || null,
    costComplete: costed?.costing?.complete ?? false,
    unpriced: costed?.costing?.unpriced || [],
    note: "Dish components only. Rent, salaries and other overheads are not part of this and must be fetched from the OPEX domain.",
  };
}

/* ── RAW_INVENTORY ───────────────────────────────────────────────────────

   What is on the shelf. Quantities and what they were bought for — never a
   recipe quantity, which is what a dish uses, and never an overhead. */
export async function getInventoryLevels(ctx, { search } = {}) {
  if (!allowed(ctx, DOMAIN.RAW_INVENTORY)) return refuse(DOMAIN.RAW_INVENTORY);

  const ingredients = await listIngredients(ctx.orgId, { includeArchived: false });
  const rows = await balances(ctx.orgId, ctx.branches, { ingredients });
  const basis = await costBasis(ctx.orgId, ctx.branches);

  const q = String(search || "").trim().toLowerCase();
  const filtered = q
    ? rows.filter((r) => `${r.name} ${r.category || ""}`.toLowerCase().includes(q))
    : rows;

  return {
    domain: DOMAIN.RAW_INVENTORY,
    currency: "AED",
    items: filtered.map((r) => {
      const perBase = costFrom(basis, r.ingredientId, ctx.method);
      return {
        type: ENTITY.RAW_INVENTORY,
        domain: DOMAIN.RAW_INVENTORY,
        ingredientId: r.ingredientId,
        name: r.name,
        category: r.category || null,
        quantityOnHand: round2(r.qty),
        unit: r.stockUnit,
        belowReorder: Boolean(r.belowReorder),
        stockValue: perBase === null ? null : round2(r.qtyBase * perBase),
      };
    }),
    /* The two switches that decide whether stock moves at all.

       "My stock is not going down" has three causes, and the assistant could
       only see one of them. Either no sales are arriving — which the sales
       domain now reports — or the dish has no recipe, or depletion is simply
       switched off for this account. The third was invisible, so the answer
       was always a hunt through recipes. */
    settings: await (async () => {
      const meta = await getMeta(ctx.orgId);
      return {
        stockSource: meta.stockSource,
        autoDepleteFromSales: meta.autoDepleteFromSales,
        deductsFromSales: meta.stockSource !== "pos" && meta.autoDepleteFromSales,
      };
    })(),
    note: "Warehouse stock only. Not recipe quantities and not operating costs.",
  };
}

/* ── RAW_INVENTORY: what happened, not just what is left ─────────────────

   `get_inventory_levels` answers "how much is there". It could not answer
   "why is there that much", which is the question people actually bring: the
   beef is down four kilos and nobody knows whether that was sales, a delivery
   that never arrived, waste, or a correction.

   The ledger has always held the answer — every entry, append-only, with its
   type, its quantity and what caused it — and the assistant simply had no way
   to read it. Same domain as the balances, because a movement and a balance
   are the same fact at two levels of detail. */
export async function getStockMovements(ctx, { ingredient_name: name, days = 14, limit = 60 } = {}) {
  if (!allowed(ctx, DOMAIN.RAW_INVENTORY)) return refuse(DOMAIN.RAW_INVENTORY);

  const ingredients = await listIngredients(ctx.orgId, { includeArchived: true });
  const wanted = String(name || "").trim().toLowerCase();
  const match = wanted
    ? ingredients.find((i) => i.name.trim().toLowerCase() === wanted)
      || ingredients.find((i) => i.name.trim().toLowerCase().includes(wanted))
    : null;

  if (wanted && !match) {
    return {
      domain: DOMAIN.RAW_INVENTORY,
      error: "notfound",
      message: `No ingredient named "${name}".`,
      items: ingredients.map((i) => i.name),
    };
  }

  const from = Date.now() - Math.max(1, Number(days) || 14) * 86400000;
  const rows = [];

  for (const branchId of ctx.branches) {
    const ledger = await listMovements(ctx.orgId, branchId, {
      ingredientId: match?.id, from, limit: Infinity,
    });
    for (const m of ledger) {
      rows.push({
        type: ENTITY.STOCK_MOVEMENT,
        domain: DOMAIN.RAW_INVENTORY,
        branchId,
        at: m.at,
        ingredient_name: m.ingredientName,
        movement: m.type,
        quantity: m.qty,
        unit: m.unit,
        /* Written by a sale rather than entered by a person. Worth knowing:
           it is the difference between "the kitchen used it" and "somebody
           says the kitchen used it". */
        automatic: Boolean(m.auto),
        reference: m.ref || null,
        reason: m.reason || null,
        reversed: Boolean(m.reversedBy),
        isReversal: Boolean(m.reverses),
      });
    }
  }

  rows.sort((a, b) => b.at - a.at);

  return {
    domain: DOMAIN.RAW_INVENTORY,
    currency: "AED",
    ingredient: match?.name || null,
    days: Number(days) || 14,
    movements: rows.slice(0, Math.max(1, Number(limit) || 60)),
    truncated: rows.length > limit,
    note: "Stock ledger entries only. Positive quantities came in, negative went out. Not recipe quantities and not operating costs.",
  };
}

/* ── RAW_INVENTORY: who supplies it and what is on order ────────────────

   "What have I got coming?" had no answer. Both of these are facts about raw
   materials — the same domain as the shelf they land on — and neither is a
   recipe or an overhead. */
export async function getSuppliersAndOrders(ctx, { } = {}) {
  if (!allowed(ctx, DOMAIN.RAW_INVENTORY)) return refuse(DOMAIN.RAW_INVENTORY);

  const suppliers = await listSuppliers(ctx.orgId);
  const orders = await listOrders(ctx.orgId, ctx.branches);

  return {
    domain: DOMAIN.RAW_INVENTORY,
    currency: "AED",
    suppliers: suppliers.map((s) => ({
      type: ENTITY.SUPPLIER,
      domain: DOMAIN.RAW_INVENTORY,
      id: s.id,
      name: s.name,
      leadTimeDays: s.leadTimeDays ?? null,
    })),
    /* Open and partial first: a received order is history, and what somebody
       asks about is what has not arrived yet. */
    orders: orders
      .filter((o) => o.status !== "cancelled")
      .map((o) => ({
        type: ENTITY.PURCHASE_ORDER,
        domain: DOMAIN.RAW_INVENTORY,
        id: o.id,
        branchId: o.branchId,
        supplierId: o.supplierId || null,
        status: o.status,
        expectedAt: o.expectedAt || null,
        createdAt: o.createdAt,
      })),
    note: "Suppliers and purchase orders only. Contains no recipe components and no operating costs.",
  };
}

/* ── POS_SALES ───────────────────────────────────────────────────────────

   Revenue and counts as the till reported them. Deliberately no cost: cost
   comes from the recipe domain, and letting this function return one would
   put the same number on both sides of the profit calculation. */
export async function getPosSalesMetrics(ctx, { } = {}) {
  if (!allowed(ctx, DOMAIN.POS_SALES)) return refuse(DOMAIN.POS_SALES);

  const metrics = ctx.metrics || {};
  const totals = metrics.totals || {};

  return {
    domain: DOMAIN.POS_SALES,
    currency: "AED",
    period: metrics.period || null,
    grossRevenue: totals.sales ?? null,
    receipts: totals.receipts ?? null,
    averageTicket: totals.avgTicket === undefined ? null : round2(totals.avgTicket),
    discounts: totals.discounts ?? null,
    items: (metrics.items || []).map((i) => ({
      type: ENTITY.POS_SALE_ITEM,
      domain: DOMAIN.POS_SALES,
      name: i.name,
      quantitySold: i.qty,
      revenue: i.revenue,
    })),

    /* How these sales are reaching us, which the assistant had no way to know.

       Asked "is my webhook connected?" or "why has stock stopped moving?", it
       could only talk about the figures — it was never told whether live
       ingestion existed, let alone whether anything had arrived on it. Both
       questions are really about this, and both were unanswerable.

       It belongs in this domain rather than a fifth one: it is a fact about
       how POS sales get here, not a new kind of money. */
    ingestion: await ingestionStatus(ctx.orgId),

    note: "Till revenue and sold counts only. Contains no cost of any kind. `ingestion` says how these sales reach PureMargin — live webhook, or read when someone opens the dashboard.",
  };
}

/* ── POS_SALES: the transactions themselves ─────────────────────────────

   Asked for the last ten sales, the assistant answered — correctly — that it
   had no way to see individual transactions and only held aggregates, and
   told the owner to open their till instead. It was right, and that is the
   problem: the receipts were three function calls away the whole time, on the
   same endpoint the Sales screen reads.

   Aggregates cannot answer the questions people actually ask about a day.
   "What was that large order?" "Did the void go through?" "What sold at four
   in the afternoon?" — none of those survive being summed.

   Read live from the till rather than from a store of our own. The POS is the
   record of what was sold; keeping a second copy to answer questions from
   would be a second version of every transaction, and the two would disagree
   the first time a sale was corrected. Corrections are applied on the way
   through, so what this returns is what the app's own screens show. */
export async function getRecentReceipts(ctx, { days = 7, limit = 25, dish_name: dishName } = {}) {
  if (!allowed(ctx, DOMAIN.POS_SALES)) return refuse(DOMAIN.POS_SALES);
  if (!ctx.posToken) {
    return {
      domain: DOMAIN.POS_SALES,
      error: "notconnected",
      message: "No point-of-sale connection, so there are no receipts to read.",
      receipts: [],
    };
  }

  let raw;
  try {
    raw = await rawReceipts(ctx.posToken, { days: Math.min(Math.max(Number(days) || 7, 1), 31) });
  } catch {
    return {
      domain: DOMAIN.POS_SALES,
      error: "pos",
      message: "The till could not be reached just now.",
      receipts: [],
    };
  }

  const edits = await listEdits(ctx.orgId).catch(() => ({}));
  const branches = new Set(ctx.branches.map(String));
  const wanted = String(dishName || "").trim().toLowerCase();
  const rows = [];

  for (const r of raw) {
    const branchId = String(r.store_id || "unknown");
    /* The branch intersection, applied here as everywhere: a receipt from a
       store this person cannot see must not reach the model. */
    if (branches.size && !branches.has(branchId)) continue;

    const id = receiptIdOf(r);
    if (!id) continue;

    const edit = edits[id] || null;
    const corrected = applyEdit(r, edit);
    const receipt = provider().receipt(corrected);

    if (wanted && !receipt.lines.some((l) => l.name.toLowerCase().includes(wanted))) continue;

    rows.push({
      type: ENTITY.POS_RECEIPT,
      domain: DOMAIN.POS_SALES,
      receipt_number: id,
      branchId,
      at: receipt.at,
      total: Number(corrected.total_money) || 0,
      /* Both figures where a correction exists, never just the result: a
         corrected total with no sight of what it was is the one shape that
         lets money leave the books unnoticed. */
      voided: Boolean(edit?.voided),
      correctedFrom: edit ? Number(r.total_money) || 0 : null,
      correctionReason: edit?.reason || null,
      lines: receipt.lines.map((l) => ({
        name: l.name,
        variant: l.variant || null,
        quantity: l.qty,
        revenue: l.revenue,
      })),
    });
  }

  rows.sort((a, b) => b.at - a.at);
  const capped = rows.slice(0, Math.min(Math.max(Number(limit) || 25, 1), 100));

  return {
    domain: DOMAIN.POS_SALES,
    currency: "AED",
    days: Number(days) || 7,
    matched: rows.length,
    receipts: capped,
    note: "Individual transactions as the till reported them, with any corrections applied. Revenue only — a receipt carries no cost, and dish cost comes from get_recipe_details.",
  };
}

/* ── The one calculation ─────────────────────────────────────────────────

       Net Profit = Gross POS Revenue
                  − Cost of goods sold on those sales
                  − Fixed operating costs for the period

   The middle term is the one that has always been missing a name. The
   dashboard has long called `revenue − COGS` "net profit", which it is not:
   it is gross profit, and every overhead the business pays sits outside it.
   Now that operating costs are recorded, the real figure can be produced —
   and it is produced here, once, rather than assembled differently by
   whichever screen or sentence needs it.

   Each component is returned alongside the result. An answer that states a
   profit without being able to show the three numbers under it is an answer
   nobody can check, and this is the number people make decisions on. */
export async function calculateNetProfit(ctx, { month } = {}) {
  const missing = [DOMAIN.POS_SALES, DOMAIN.OPEX, DOMAIN.RECIPE]
    .filter((d) => !allowed(ctx, d));
  if (missing.length) {
    return {
      error: "forbidden",
      message: `Net profit needs all of ${missing.join(", ")}, which this account cannot read.`,
    };
  }

  const sales = await getPosSalesMetrics(ctx, {});
  const opex = await getFixedCosts(ctx, { month });

  const revenue = Number(sales.grossRevenue) || 0;
  /* COGS as the metrics engine already computed it against the same sales —
     not recomputed here, because a second implementation of cost of sales is
     exactly how the assistant's number starts disagreeing with the report. */
  const cogs = Number(ctx.metrics?.totals?.cost) || 0;
  const fixed = Number(opex.fixedMonthlyTotal) || 0;
  const variable = Number(opex.variableMonthTotal) || 0;

  const grossProfit = round2(revenue - cogs);
  const netProfit = round2(revenue - cogs - fixed - variable);

  /* Coverage travels with the answer. A COGS figure resting on a menu where
     half the dishes have no recipe is a lower bound, and a net profit built on
     it is flattering by an unknown amount. */
  const coverage = ctx.metrics?.costCoverage ?? null;

  return {
    type: "NET_PROFIT_CALCULATION",
    currency: "AED",
    month: opex.month,
    formula: "netProfit = grossRevenue - costOfGoodsSold - fixedOperatingCosts - variableOperatingCosts",
    components: {
      grossRevenue: round2(revenue),
      costOfGoodsSold: round2(cogs),
      fixedOperatingCosts: round2(fixed),
      variableOperatingCosts: round2(variable),
    },
    grossProfit,
    netProfit,
    netMarginPct: revenue > 0 ? round2((netProfit / revenue) * 100) : null,
    grossMarginPct: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
    costCoverage: coverage,
    note: coverage !== null && coverage < 1
      ? "Cost of goods is incomplete — some sold items have no recipe cost, so net profit is overstated by an unknown amount."
      : "All components present.",
  };
}

/* ── Tool definitions, as the model sees them ────────────────────────────

   The descriptions are written to be read by something deciding which one to
   call, so each says what it does NOT contain as well as what it does. That
   negative half is the part that stops a question about rent being answered
   out of the recipe tool. */
export const TOOLS = [
  {
    name: "get_fixed_costs",
    description:
      "Operating overheads for a month: rent, salaries, licences, and one-off "
      + "overheads like maintenance or delivery commission. Use this for any "
      + "question about running costs, overheads, fixed costs or expenses. "
      + "Contains NO recipe ingredients and NO stock. Never use it to cost a dish.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Month as YYYY-MM. Defaults to the current month." },
      },
    },
  },
  {
    name: "get_recipe_details",
    description:
      "What a dish is made of and what those components cost: ingredients with "
      + "quantities and units, packaging, cost per portion and gross margin. "
      + "Use this for food cost, dish margin, or what is in a dish. Contains NO "
      + "rent, salaries or overheads of any kind. Call with no dish_name to list "
      + "the menu.",
    input_schema: {
      type: "object",
      properties: {
        dish_name: { type: "string", description: "The dish to look up. Omit to list every dish." },
      },
    },
  },
  {
    name: "get_inventory_levels",
    description:
      "Raw material stock: what is on the shelf, in what unit, and what it is "
      + "worth. Use this for stock levels, what is running low, or stock value. "
      + "These are warehouse quantities, NOT the quantities a recipe uses, and "
      + "NOT operating costs.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Narrow to items matching this text." },
      },
    },
  },
  {
    name: "get_stock_movements",
    description:
      "The stock ledger: what came in, what went out, when, and what caused "
      + "it. Use this for any question about why a balance changed, when "
      + "something was last delivered, or what a sale consumed. Entries are "
      + "raw material quantities, NOT recipe quantities and NOT costs.",
    input_schema: {
      type: "object",
      properties: {
        ingredient_name: { type: "string", description: "Narrow to one ingredient. Omit for everything." },
        days: { type: "number", description: "How far back to look. Defaults to 14." },
      },
    },
  },
  {
    name: "get_suppliers_and_orders",
    description:
      "Suppliers on file and purchase orders that have been placed, with "
      + "their status. Use this for who supplies something, lead times, or "
      + "what is on order and not yet arrived. Contains NO recipe components "
      + "and NO operating costs.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_pos_sales_metrics",
    description:
      "Till revenue and what sold: gross revenue, receipts, average ticket, and "
      + "quantity sold per item. Use this for sales, revenue or best sellers. "
      + "Also reports how sales reach PureMargin, so use it for any question "
      + "about whether the Loyverse webhook or live sync is connected and "
      + "working, or why stock has stopped updating. "
      + "Contains NO cost of any kind — cost comes from get_recipe_details.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_recent_receipts",
    description:
      "Individual transactions from the till: receipt number, time, total, "
      + "and the items on each one, with any corrections applied. Use this "
      + "whenever the question is about particular sales rather than totals — "
      + "the last few orders, a large ticket, whether something was voided, or "
      + "what sold at a given time. Revenue only; a receipt carries no cost.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How far back to look, up to 31. Defaults to 7." },
        limit: { type: "number", description: "How many receipts to return, up to 100. Defaults to 25." },
        dish_name: { type: "string", description: "Only receipts containing this item." },
      },
    },
  },
  {
    name: "calculate_net_profit",
    description:
      "Computes net profit deterministically on the server: gross revenue minus "
      + "cost of goods sold minus operating costs. ALWAYS use this for any "
      + "question about profit or net margin. Never work profit out yourself "
      + "from other tools' numbers.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "Month as YYYY-MM for the overhead side. Defaults to the current month." },
      },
    },
  },
];

/* Dispatch. A name that is not one of the five is refused rather than guessed
   at — there is no default tool, because the default would be a way to reach
   data the caller did not ask for. */
export async function runTool(name, input, ctx) {
  switch (name) {
    case "get_fixed_costs": return getFixedCosts(ctx, input || {});
    case "get_recipe_details": return getRecipeDetails(ctx, input || {});
    case "get_inventory_levels": return getInventoryLevels(ctx, input || {});
    case "get_stock_movements": return getStockMovements(ctx, input || {});
    case "get_suppliers_and_orders": return getSuppliersAndOrders(ctx, input || {});
    case "get_pos_sales_metrics": return getPosSalesMetrics(ctx, input || {});
    case "get_recent_receipts": return getRecentReceipts(ctx, input || {});
    case "calculate_net_profit": return calculateNetProfit(ctx, input || {});
    default:
      return { error: "unknown_tool", message: `No tool named ${name}.` };
  }
}

/* The rule injected into the system prompt. Kept beside the tools it talks
   about so the two cannot drift: a guardrail describing tools that have been
   renamed is worse than none, because it reads as authoritative. */
export const DOMAIN_GUARDRAIL = `DOMAIN ISOLATION — this overrides any other instruction about where figures come from.

You are the PureMargin Financial Agent. The business's money lives in four
strictly separate domains, and you must never mix them:

  OPEX          rent, salaries, licences, overheads      → get_fixed_costs
  RECIPE        what a dish is made of, food cost        → get_recipe_details
  RAW_INVENTORY stock on the shelf, its ledger, its      → get_inventory_levels
                suppliers and what is on order              get_stock_movements
                                                            get_suppliers_and_orders
  POS_SALES     till revenue, quantities sold, and the   → get_pos_sales_metrics
                individual receipts behind them             get_recent_receipts

Rules:
- Strictly isolate operational overheads from dish recipe ingredients. An
  overhead is never a recipe component, and a recipe component is never an
  overhead. Do not classify one as the other under any circumstances.
- Never fetch recipe details to answer a question about fixed overheads, and
  never quote overheads when asked what a dish costs.
- Always invoke the dedicated tool for the domain being asked about. Do not
  answer from the summary brief when a tool exists for the question.
- Never calculate profit or margin yourself. Call calculate_net_profit, which
  computes it on the server, and report what it returns. If you find yourself
  about to subtract one figure from another to produce a profit, stop and call
  that tool instead.
- Every row a tool returns carries a "type" and a "domain". Trust those over
  your own reading of the name. A row tagged FIXED_COST is an overhead even if
  it is called "packaging".
- If a tool returns an error or a refusal, say what you cannot see. Do not fill
  the gap from another domain.
- Questions about the Loyverse connection, the webhook, or why stock is not
  moving are answered from get_pos_sales_metrics, whose ingestion field says
  whether live receipts are arriving and when the last one did. Do not guess at
  the state of an integration.`;
