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
import { netProfit as computeNetProfit } from "./_profit.js";
import { listRecipes, costedList, costedRecipe, effectiveVersion } from "./_recipes.js";
import { listIngredients, listSuppliers, getMeta } from "./_inventory.js";
import { balances, listMovements } from "./_movements.js";
import { costBasis, costFrom } from "./_costing.js";
import { listOrders } from "./_purchasing.js";
import { rawReceipts, getMetrics } from "./_data.js";
import { registerReceipts, salesReceipts, getSettings, catalogueOf, monthsBetween } from "./_till.js";
import { listShifts, currentShift, summarise } from "./_tillshift.js";
import { listCustomers, customerStats } from "./_tillbook.js";
import { listStores } from "./_stores.js";
import { menuCosts } from "./_recipes.js";
import {
  listChannels, channelSettings, pricesFor, menuRows, channelAlerts, channelReport, pricingGap, dayIn,
} from "./_channels.js";
import { ruleAt, compareItem, EMPTY_RULE, IN_STORE_ID } from "../shared/channelmath.js";
import { listEdits, applyEdit, receiptIdOf } from "./_saleedits.js";
import { listEmployees, listPunches, onShift, shiftsFrom } from "./_employees.js";
import { buildAlerts } from "./_alerts.js";
import { normaliseText } from "./_text.js";
import { effectiveBranches } from "./_org.js";

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
  /* Who was here and when. Deliberately its own domain rather than a corner of
     OPEX: wages are an overhead and hours are not, and an assistant that could
     reach attendance while answering a question about rent would be one
     mistaken join away from reporting a person's shifts as a cost line. */
  STAFF: "STAFF",
  /* The register as a workplace: its shifts and drawers, its customers, how
     it is set up. Sales figures stay in POS_SALES; this is what surrounds
     them. */
  REGISTER: "REGISTER",
  /* What each sales channel takes and leaves. Its own domain because it is
     the one place fees, prices and recipe costs are deliberately combined —
     by `shared/channelmath.js`, never by the model. */
  CHANNELS: "CHANNELS",
};

/* What each domain needs to be read at all. Matches what the equivalent screen
   already enforces, so the assistant cannot become a way around a permission. */
const NEEDS = {
  [DOMAIN.OPEX]: "view:dashboard",
  [DOMAIN.RECIPE]: "view:costs",
  [DOMAIN.RAW_INVENTORY]: "view:inventory",
  [DOMAIN.POS_SALES]: "view:dashboard",
  [DOMAIN.STAFF]: "manage:staff",
  [DOMAIN.REGISTER]: "view:dashboard",
  [DOMAIN.CHANNELS]: "view:profitability",
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
        autoDepleteFromSales: meta.autoDepleteFromSales,
        deductsFromSales: meta.autoDepleteFromSales,
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

    note: "Register revenue and sold counts only. Contains no cost of any kind.",
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
  /* The register's sales and a connected Loyverse's, as the screens list them. */
  const { receipts: register, pos } = await salesReceipts(ctx.orgId, { since: Date.now() - 32 * DAY_MS })
    .catch(() => ({ receipts: [], pos: null }));
  if (!register.length) {
    if (pos?.ok === false) {
      return { domain: DOMAIN.POS_SALES, error: "posunavailable", message: "Loyverse could not be read just now, so its receipts are not available. Say so; do not describe the period as quiet.", receipts: [] };
    }
    return { domain: DOMAIN.POS_SALES, error: "nosales", message: "Nothing has been sold yet, so there are no receipts to read.", receipts: [] };
  }
  const raw = await rawReceipts({ days: Math.min(Math.max(Number(days) || 7, 1), 31), register });

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
    const receipt = {
      at: new Date(corrected.receipt_date).getTime(),
      lines: (corrected.line_items || []).map((li) => ({
        name: li.item_name || "", variant: li.variant_name || "", qty: Number(li.quantity) || 0, revenue: Number(li.total_money) || 0,
      })),
    };

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

  /* One implementation, shared with the dashboard.

     This used to be worked out here, and the periods did not line up: a
     rolling thirty days of revenue and cost of goods was set against a whole
     calendar month of rent and a *month-to-date* total of variable spending.
     On the third of the month that put three days of costs beside thirty days
     of sales, so the answer was high at the start of every month and fell as
     the month went on for no reason in the business at all.

     `_profit.js` measures every component over one window and says which. It
     is the same call the dashboard makes, so the assistant and the screen
     cannot disagree about what the business kept. */
  const out = await computeNetProfit(ctx.orgId, {
    netSales: Number(sales.grossRevenue) || 0,
    /* Cost of goods as the metrics engine already computed it against the
       same sales — never recomputed, for the reason above. */
    cogs: Number(ctx.metrics?.totals?.cost) || 0,
    coverage: ctx.metrics?.costCoverage ?? null,
  });

  /* `month` is still accepted so an existing tool call does not break, and
     is reported back rather than silently ignored: the answer covers the
     window in `period`, and a question about a specific month deserves to be
     told that is not what it got. */
  return {
    type: "NET_PROFIT_CALCULATION",
    currency: "AED",
    period: out.period,
    requestedMonth: month || null,
    formula: out.formula,
    components: {
      netSales: out.netSales,
      costOfGoodsSold: out.costOfGoods,
      fixedOperatingCosts: out.fixedCosts,
      variableOperatingCosts: out.variableCosts,
    },
    grossProfit: out.grossProfit,
    netProfit: out.net,
    netMarginPct: out.netMarginPct,
    grossMarginPct: out.grossMarginPct,
    costCoverage: out.costCoverage,
    note: !out.hasOperatingCosts
      ? "No fixed or variable operating costs are on record, so net profit equals gross profit. Say so rather than presenting this as a business with no overheads."
      : out.costCoverage !== null && out.costCoverage < 1
        ? "Cost of goods is incomplete — some sold items have no recipe cost, so net profit is overstated by an unknown amount."
        : "All components present.",
  };
}

/* ── REGISTER ─────────────────────────────────────────────────────────────

   The shifts, the drawer, the customers and the setup. The assistant could
   say what was sold and nothing about who closed the till short, who the
   regulars are, or what the VAT is set to — all of it on screens the same
   person can open. */
const DAY_MS = 864e5;
const clampDays = (v, d, max) => Math.min(Math.max(Number(v) || d, 1), max);

async function getRegisterShifts(ctx, { days = 14 } = {}) {
  if (!allowed(ctx, DOMAIN.REGISTER)) return refuse(DOMAIN.REGISTER);
  const now = Date.now();
  const since = now - clampDays(days, 14, 180) * DAY_MS;
  const branches = new Set((ctx.branches || []).map(String));
  const inScope = (id) => !branches.size || branches.has(String(id));
  const closed = (await listShifts(ctx.orgId, monthsBetween(since, now)))
    .filter((s) => s.closedAt >= since && inScope(s.branchId))
    .slice(0, 40)
    .map((s) => ({
      domain: DOMAIN.REGISTER, state: "closed", branchId: s.branchId,
      openedAt: s.openedAt, openedBy: s.openedBy || null, closedAt: s.closedAt, closedBy: s.closedBy || null,
      float: s.float, netSales: s.summary?.netSales ?? null, receipts: s.summary?.receipts ?? null, refunds: s.summary?.refunds ?? null,
      cashExpected: s.summary?.cash?.expected ?? null, cashCounted: s.counted ?? null,
      /* Counted less expected: negative is a drawer that came up short. */
      difference: s.difference ?? null,
      paidIn: s.summary?.cash?.payIns ?? 0, paidOut: s.summary?.cash?.payOuts ?? 0,
      note: s.note || null,
    }));
  const open = [];
  const receipts = await registerReceipts(ctx.orgId, { since: now - 3 * DAY_MS }).catch(() => []);
  for (const b of ctx.branches || []) {
    const shift = await currentShift(ctx.orgId, b).catch(() => null);
    if (!shift) continue;
    const sum = summarise(shift, receipts);
    open.push({
      domain: DOMAIN.REGISTER, state: "open", branchId: String(b), openedAt: shift.openedAt, openedBy: shift.openedBy || null,
      float: shift.float, netSales: sum.netSales, receipts: sum.receipts, cashExpected: sum.cash.expected,
    });
  }
  return {
    domain: DOMAIN.REGISTER, currency: "AED", days: clampDays(days, 14, 180),
    open, closed,
    short: closed.filter((s) => Number(s.difference) < 0).length,
    note: "Register shifts and cash drawers only. A difference is cash counted less cash expected; it is not a sales figure and not a cost.",
  };
}

async function getCustomers(ctx, { search, limit = 25 } = {}) {
  if (!allowed(ctx, DOMAIN.REGISTER)) return refuse(DOMAIN.REGISTER);
  const [customers, receipts] = await Promise.all([
    listCustomers(ctx.orgId),
    registerReceipts(ctx.orgId, { since: Date.now() - 730 * DAY_MS }).catch(() => []),
  ]);
  const wanted = String(search || "").trim().toLowerCase();
  const rows = customers
    .filter((c) => !wanted || c.name.toLowerCase().includes(wanted))
    .map((c) => ({ domain: DOMAIN.REGISTER, name: c.name, since: c.createdAt || null, ...customerStats(c.id, receipts) }))
    .sort((a, b) => b.spent - a.spent);
  return {
    domain: DOMAIN.REGISTER, currency: "AED",
    customers: rows.slice(0, Math.min(Math.max(Number(limit) || 25, 1), 100)),
    total: customers.length,
    /* Names and what they bought. Phone numbers and email addresses stay out
       of the conversation: nothing asked of an assistant needs them. */
    note: "Customers on file with visits, spend and loyalty points over the last two years. Contact details are deliberately not included.",
  };
}

async function getRegisterSetup(ctx) {
  if (!allowed(ctx, DOMAIN.REGISTER)) return refuse(DOMAIN.REGISTER);
  const [settings, recipes, stores] = await Promise.all([
    getSettings(ctx.orgId), listRecipes(ctx.orgId), listStores(ctx.orgId, { orgName: ctx.orgName || "" }),
  ]);
  const branches = new Set((ctx.branches || []).map(String));
  const items = catalogueOf(recipes, settings);
  return {
    domain: DOMAIN.REGISTER, currency: "AED",
    stores: stores.filter((st) => !branches.size || branches.has(String(st.id)))
      .map((st) => ({ id: st.id, name: st.name, address: st.address || null, taxNumber: st.trn || null })),
    vatPct: settings.vatPct, pricesIncludeVat: settings.vatMode === "inclusive",
    paymentTypes: (settings.paymentTypes || []).map((p) => ({ name: p.name, kind: p.kind })),
    discounts: (settings.discounts || []).map((d) => ({ name: d.name, type: d.type, value: d.value, managerOnly: Boolean(d.restricted) })),
    loyaltyPct: settings.loyaltyPct || 0, countsDrawerByShift: Boolean(settings.useShifts),
    menu: {
      items: items.length,
      unpriced: items.filter((i) => !i.priced).map((i) => i.name).slice(0, 30),
      withVariants: items.filter((i) => i.variants?.length).map((i) => ({ name: i.name, variants: i.variants.map((v) => ({ name: v.name || "Regular", price: v.price })) })).slice(0, 40),
      productsTrackedInStock: items.filter((i) => i.kind === "product" && i.stock).map((i) => i.name).slice(0, 40),
    },
    note: "How the register is set up. Contains NO sales figures and NO costs.",
  };
}

/* ── POS_SALES, further back ──────────────────────────────────────────────

   The brief and `get_pos_sales_metrics` cover the last thirty days. Every
   sale ever rung up is on file, so a question about the quarter or the year
   has an answer — worked out by the same aggregation the overview uses for
   its longer ranges, not by the model adding months together. */
async function getSalesHistory(ctx, { period = "90" } = {}) {
  if (!allowed(ctx, DOMAIN.POS_SALES)) return refuse(DOMAIN.POS_SALES);
  const now = Date.now();
  const key = String(period) === "all" ? "all" : String(period) === "365" ? "year" : "quarter";
  /* The register's sales and a connected Loyverse's. How far back "all"
     goes is known only once they are read, so a year either side is read
     first and the period set from the first sale found. */
  const read = await salesReceipts(ctx.orgId, { since: now - (key === "quarter" ? 182 : 732) * DAY_MS, now });
  if (!read.receipts.length) {
    return read.pos?.ok === false
      ? { domain: DOMAIN.POS_SALES, error: "posunavailable", message: "Loyverse could not be read just now. Say so; do not describe the period as quiet." }
      : { domain: DOMAIN.POS_SALES, error: "nosales", message: "Nothing has been sold yet." };
  }
  const first = read.firstSaleAt ?? new Date(read.receipts[0].receipt_date).getTime();
  const days = key === "all" ? Math.max(31, Math.ceil((now - first) / DAY_MS)) : key === "year" ? 365 : 90;
  const register = read.receipts;
  const edits = await listEdits(ctx.orgId).catch(() => ({}));
  let m;
  try {
    m = await getMetrics({ register, edits, pos: read.pos, branches: ctx.branches?.length ? ctx.branches : null, timeZone: ctx.timeZone, period: { key, days } });
  } catch (err) {
    if (err?.code === "notconnected") return { domain: DOMAIN.POS_SALES, error: "nosales", message: "Nothing has been sold in that period." };
    throw err;
  }
  return {
    domain: DOMAIN.POS_SALES, currency: "AED",
    period: { key, days, from: m.period?.from || null, firstSaleOnFile: new Date(first + 7 * DAY_MS).toISOString() },
    ...(read.pos?.limitedHistory ? { limits: "Loyverse returns only the last 31 days on this plan, so there is no earlier period to compare with." } : {}),
    totals: m.period?.totals || null,
    /* By day up to a quarter, by week up to a year, by month beyond. */
    bucket: m.period?.bucket || "day",
    series: (m.period?.series || []).filter((b) => b.sales || b.receipts).map((b) => ({ from: b.date, sales: b.sales, receipts: b.receipts })),
    note: "Sales including VAT, as customers paid them, with the change against the period before. Contains NO cost of any kind.",
  };
}

/* ── CHANNELS ─────────────────────────────────────────────────────────────

   What each sales channel takes, what each item leaves on it, the price that
   would leave what the counter does, and what each channel actually brought
   in. Every figure comes from `shared/channelmath.js` and the receipts' own
   snapshots — the same numbers the Channels screen shows. */
async function getSalesChannels(ctx, { item } = {}) {
  if (!allowed(ctx, DOMAIN.CHANNELS)) return refuse(DOMAIN.CHANNELS);
  const now = Date.now();
  const branchIds = ctx.branches || [];
  const [channels, settings, { doc, byChannel }, recipes, till, costs] = await Promise.all([
    listChannels(ctx.orgId, { now }), channelSettings(ctx.orgId), pricesFor(ctx.orgId), listRecipes(ctx.orgId),
    getSettings(ctx.orgId), menuCosts(ctx.orgId, branchIds),
  ]);
  const rows = menuRows(catalogueOf(recipes, till), costs);
  const day = dayIn(now, ctx.timeZone);
  const counterRule = ruleAt(channels.find((c) => c.id === IN_STORE_ID)?.rules, day, null) || EMPTY_RULE;
  const wanted = String(item || "").trim().toLowerCase();
  const receipts = till.usedAt ? await registerReceipts(ctx.orgId, { since: now - 31 * DAY_MS }).catch(() => []) : [];
  const { alerts } = channelAlerts({ channels, prices: byChannel, rows, vatPct: till.vatPct, vatMode: till.vatMode, settings, pricesDoc: doc, now, timeZone: ctx.timeZone });

  return {
    domain: DOMAIN.CHANNELS, currency: "AED",
    minimumMarginPct: settings.minMarginPct,
    pricesIncludeVat: till.vatMode === "inclusive", vatPct: till.vatPct,
    channels: channels.map((c) => {
      const rule = ruleAt(c.rules, day, null);
      const listed = byChannel[c.id] || {};
      const items = rows
        .filter((r) => r.cost !== null && (!wanted || `${r.name} ${r.variant}`.toLowerCase().includes(wanted)))
        .map((r) => {
          const price = listed[r.key] ?? r.price;
          const e = compareItem({ price, inStorePrice: r.price, recipeCost: r.cost, rule: rule || EMPTY_RULE, inStoreRule: counterRule, vatPct: till.vatPct, vatMode: till.vatMode, minMarginPct: settings.minMarginPct });
          return {
            item: r.variant ? `${r.name} · ${r.variant}` : r.name, inStorePrice: r.price, priceHere: price,
            channelCost: e.channelCost, recipeCost: e.recipeCost, profit: e.contribution, marginPct: e.marginPct,
            inStoreProfit: e.inStoreContribution, priceToKeepInStoreProfit: e.recommended, breakEvenPrice: e.breakEven, status: e.status,
          };
        })
        .sort((a, b) => a.profit - a.inStoreProfit - (b.profit - b.inStoreProfit));
      return {
        id: c.id, name: c.name, type: c.type, inUse: c.active,
        fees: rule ? {
          since: rule.validFrom, commissionPct: rule.commissionPct, commissionOn: rule.commissionBase, paymentFeePct: rule.paymentFeePct,
          fixedPerOrder: rule.fixedOrderFee, fixedPerItem: rule.fixedItemFee, advertising: rule.advertisingModel,
          merchantDiscount: rule.discountModel === "percent" ? `${rule.merchantDiscountPct}%` : rule.discountModel === "fixed" ? rule.merchantDiscountFixed : null,
          deliveryCostPerOrder: rule.deliveryCostPerOrder, vatOnFeesPct: rule.vatOnPlatformFeePct,
        } : null,
        feeRulesOnFile: (c.rules || []).length,
        itemsWithOwnPrice: Object.keys(listed).length,
        /* Furthest below the counter's profit first; capped so a long menu
           does not crowd out everything else. Name an item to see just it. */
        items: items.slice(0, wanted ? 40 : 12),
        itemsNotShown: Math.max(0, items.length - (wanted ? 40 : 12)),
      };
    }),
    last30Days: channelReport(receipts, { channels, costs, from: now - 30 * DAY_MS, to: now, branches: branchIds.length ? branchIds : null }),
    pricingVsInStore: pricingGap(rows, byChannel, channels),
    alerts: alerts.slice(0, 20),
    note: "Profit here is contribution: the sale without VAT, less the channel's fees and the recipe cost. It contains NO rent, wages or other overheads — those are in calculate_net_profit. Never recompute these figures; quote them.",
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
      + "Sales are rung up on PureMargin's own register. "
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
    name: "get_staff_attendance",
    description:
      "Who is working now, who worked recently, and for how long — from the "
      + "attendance ledger people punch with their own code. Use this for any "
      + "question about staff, shifts, hours, attendance, who is in, or who was "
      + "here on a given day. Contains NO wages and NO costs: hours are hours, "
      + "and what they are paid is an overhead in get_fixed_costs.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "How far back to look. Defaults to 7, at most 90." },
        employee: { type: "string", description: "Narrow to one person by name." },
      },
    },
  },
  {
    name: "get_stock_alerts",
    description:
      "What needs attention on the shelf right now: items out of stock, below "
      + "their reorder point, or being used faster than they are being bought. "
      + "Use this for 'what do I need to order', 'what is running low', or "
      + "'what should I worry about'. Same computation the alerts screen runs. "
      + "Contains NO recipe ingredients, NO overheads and NO sales figures: it "
      + "reports quantities on a shelf, never what they are worth.",
    input_schema: {
      type: "object",
      properties: {
        branches: { type: "array", items: { type: "string" }, description: "Branch ids. Defaults to the caller's scope." },
      },
    },
  },
  {
    name: "get_register_shifts",
    description:
      "Register shifts and cash drawers: who opened and closed each one, the "
      + "float, cash expected against cash counted, the difference, and money "
      + "paid in or out of the drawer. Use this for 'was the till short', "
      + "'who closed last night', or anything about cashing up. Contains NO "
      + "item sales and NO costs.",
    input_schema: {
      type: "object",
      properties: { days: { type: "number", description: "How far back to look. Defaults to 14, at most 180." } },
    },
  },
  {
    name: "get_customers",
    description:
      "Customers saved on the register: visits, total spend, loyalty points "
      + "and last visit. Use this for 'who are my best customers', 'how many "
      + "regulars', or a named customer's history. Contains NO phone numbers "
      + "or email addresses, and NO costs.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Narrow to customers whose name contains this." },
        limit: { type: "number", description: "How many to return, most spent first. Defaults to 25." },
      },
    },
  },
  {
    name: "get_register_setup",
    description:
      "How the business and its register are set up: its stores, VAT rate and "
      + "whether prices include it, payment types, preset discounts, loyalty "
      + "rate, items with sizes, items with no price, and products tracked in "
      + "stock. Use this for questions about branches, tax or settings. "
      + "Contains NO sales figures and NO costs.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_sales_history",
    description:
      "Sales over a longer period than the last 30 days: the last 90 days, the "
      + "last year, or everything since the first sale, with totals, the change "
      + "against the period before, and a series by day, week or month. Use "
      + "this for any question about a quarter, a year, a past month, growth "
      + "or seasonality. Never add up months yourself. Contains NO costs.",
    input_schema: {
      type: "object",
      properties: { period: { type: "string", enum: ["90", "365", "all"], description: "90 days, 365 days, or all time. Defaults to 90." } },
    },
  },
  {
    name: "get_sales_channels",
    description:
      "Sales and delivery channels — in-store, Talabat, Deliveroo, own delivery "
      + "and so on: each channel's fees, what each menu item leaves on it "
      + "against in-store, the price that would keep the in-store profit, the "
      + "break-even price, what each channel sold and kept over the last 30 "
      + "days, and pricing alerts. ALWAYS use this for questions about delivery "
      + "apps, commissions, channel pricing or which channel is most "
      + "profitable. Profit here is contribution and does NOT include rent or "
      + "wages. Never work a channel price out yourself.",
    input_schema: {
      type: "object",
      properties: { item: { type: "string", description: "Narrow the per-item figures to items whose name contains this." } },
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

/* ── STAFF ───────────────────────────────────────────────────────────────

   Attendance, from the punch ledger. Hours are reported as they were recorded,
   including the ones that were not: somebody who forgot to punch out comes back
   with no duration rather than a shift long enough to look like a payroll
   error, because the assistant reporting a guess as an hour count is exactly
   how a guess gets paid. */
async function getStaffAttendance(ctx, { days = 7, employee } = {}) {
  if (!allowed(ctx, DOMAIN.STAFF)) return refuse(DOMAIN.STAFF);

  const span = Math.min(Math.max(Number(days) || 7, 1), 90);
  const from = Date.now() - span * 86400000;

  const people = await listEmployees(ctx.orgId);
  const wanted = employee
    ? people.filter((e) => normaliseText(e.name).includes(normaliseText(employee)))
    : people;
  const known = new Map(wanted.map((e) => [e.id, e]));

  const punches = (await listPunches(ctx.orgId, { from })).filter((p) => known.has(p.employeeId));
  const shifts = shiftsFrom(punches);

  const worked = new Map();
  for (const sh of shifts) {
    if (!sh.ms) continue;
    worked.set(sh.employeeId, (worked.get(sh.employeeId) || 0) + sh.ms);
  }

  return {
    domain: DOMAIN.STAFF,
    type: "attendance",
    days: span,
    onShiftNow: onShift(punches).map((p) => ({
      name: known.get(p.employeeId)?.name || p.employeeId,
      since: p.at,
    })),
    entries: [...known.values()].map((e) => ({
      type: "employee",
      domain: DOMAIN.STAFF,
      name: e.name,
      title: e.title || null,
      branchId: e.branchId,
      hoursWorked: round2((worked.get(e.id) || 0) / 3600000),
      shifts: shifts.filter((sh) => sh.employeeId === e.id).length,
      /* Counted and named, because an open shift is a thing to chase rather
         than a number to report. */
      unfinishedShifts: shifts.filter((sh) => sh.employeeId === e.id && sh.in && !sh.out).length,
    })),
  };
}

/* ── RAW_INVENTORY, asked the operational way ────────────────────────────

   What is about to run out. The same computation the alerts screen runs, so
   the assistant and the screen can never disagree about what is short. */
async function getStockAlerts(ctx, { branches } = {}) {
  if (!allowed(ctx, DOMAIN.RAW_INVENTORY)) return refuse(DOMAIN.RAW_INVENTORY);

  /* Narrowed, never widened. The model fills this argument in, and taking it
     as given let a question name a branch outside the asker's scope and read
     its shortages — the one thing every other route and the brief refuse. */
  const scope = effectiveBranches(branches, ctx.branches);
  const built = await buildAlerts(ctx.orgId, scope, {
    salesRows: ctx.metrics?.rows || [],
    from: Date.now() - 30 * 86400000,
    method: ctx.method,
  });

  return {
    domain: DOMAIN.RAW_INVENTORY,
    type: "alerts",
    entries: (built.alerts || []).map((a) => ({
      type: "alert",
      domain: DOMAIN.RAW_INVENTORY,
      kind: a.kind,
      severity: a.severity ?? null,
      name: a.name || a.ingredientName || null,
      detail: a,
    })),
  };
}

/* Which package each tool reads for — the screen it mirrors.

   Capability decides who in a team may read a domain; this decides whether
   the business has bought the screen the figures live on. The assistant
   never had the second check, so it either reached past a package nobody
   paid for or, the other way, could not be relied on to reach everything
   that was. Mirrors `SCREEN_FEATURE` in `src/entitlements.js`, and
   `_domains.test.js` asserts the two agree.

     operations  inventory, recipes, alerts — the back-of-house suite
     costs       the cost ledger and the sales list
     table       the Overview, free to everybody
     null        gated by role only, like the employees screen */
export const TOOL_FEATURE = {
  get_inventory_levels: "operations",
  get_stock_movements: "operations",
  get_suppliers_and_orders: "operations",
  get_stock_alerts: "operations",
  get_recipe_details: "operations",
  get_fixed_costs: "costs",
  get_recent_receipts: "costs",
  get_pos_sales_metrics: "table",
  calculate_net_profit: "table",
  get_staff_attendance: null,
  /* The register is not a package, so neither is anything about it. */
  get_register_shifts: null,
  get_customers: null,
  get_register_setup: null,
  get_sales_history: "table",
  get_sales_channels: "costs",
};

const paid = (ctx, feature) => !feature || (ctx.features || []).includes(feature);

/* The tools offered to the model: the ones this business has paid for.

   Offering one it has not bought would only teach the model to ask for a
   refusal. The brief already names the packages that are switched off, so a
   question about them still gets an honest answer. */
export function toolsFor(features = []) {
  return TOOLS.filter((t) => paid({ features }, TOOL_FEATURE[t.name]));
}

/* Dispatch. A name that is not on the list is refused rather than guessed at —
   there is no default tool, because the default would be a way to reach data
   the caller did not ask for.

   The package is checked here as well as in `toolsFor`, so a tool cannot be
   reached by a caller that forgot to filter the list. `features` missing
   fails closed, as the brief does: the cost of the other default is giving a
   package away without anybody deciding to. */
export async function runTool(name, input, ctx) {
  const feature = TOOL_FEATURE[name];
  if (feature !== undefined && !paid(ctx, feature)) {
    return {
      error: "package",
      package: feature,
      message: `This is part of the ${feature} package, which is not switched on for this business. Say so plainly; do not estimate it from other figures.`,
      entries: [],
    };
  }
  switch (name) {
    case "get_fixed_costs": return getFixedCosts(ctx, input || {});
    case "get_recipe_details": return getRecipeDetails(ctx, input || {});
    case "get_inventory_levels": return getInventoryLevels(ctx, input || {});
    case "get_stock_movements": return getStockMovements(ctx, input || {});
    case "get_suppliers_and_orders": return getSuppliersAndOrders(ctx, input || {});
    case "get_pos_sales_metrics": return getPosSalesMetrics(ctx, input || {});
    case "get_recent_receipts": return getRecentReceipts(ctx, input || {});
    case "get_staff_attendance": return getStaffAttendance(ctx, input || {});
    case "get_stock_alerts": return getStockAlerts(ctx, input || {});
    case "calculate_net_profit": return calculateNetProfit(ctx, input || {});
    case "get_register_shifts": return getRegisterShifts(ctx, input || {});
    case "get_customers": return getCustomers(ctx, input || {});
    case "get_register_setup": return getRegisterSetup(ctx);
    case "get_sales_history": return getSalesHistory(ctx, input || {});
    case "get_sales_channels": return getSalesChannels(ctx, input || {});
    default:
      return { error: "unknown_tool", message: `No tool named ${name}.` };
  }
}

/* The rule injected into the system prompt. Kept beside the tools it talks
   about so the two cannot drift: a guardrail describing tools that have been
   renamed is worse than none, because it reads as authoritative. */
export const DOMAIN_GUARDRAIL = `DOMAIN ISOLATION — this overrides any other instruction about where figures come from.

You are the PureMargin Financial Agent. The business lives in seven strictly
separate domains, and you must never mix them:

  OPEX          rent, salaries, licences, overheads      → get_fixed_costs
  RECIPE        what a dish is made of, food cost        → get_recipe_details
  RAW_INVENTORY stock on the shelf, its ledger, its      → get_inventory_levels
                suppliers, what is on order, and what       get_stock_movements
                is running short                            get_suppliers_and_orders
                                                            get_stock_alerts
  POS_SALES     till revenue, quantities sold, and the   → get_pos_sales_metrics
                individual receipts behind them; and        get_recent_receipts
                sales over a quarter, a year or all time    get_sales_history
  REGISTER      shifts and cash drawers, customers and   → get_register_shifts
                loyalty, stores, VAT and how the till       get_customers
                is set up                                   get_register_setup
  CHANNELS      what each sales channel charges, what    → get_sales_channels
                each item leaves on it, and the price
                that protects the profit
  STAFF         who was here and for how long, from the  → get_staff_attendance
                attendance ledger

STAFF is hours, never money. What people are paid is an overhead and lives in
OPEX; an answer that turns somebody's shifts into a cost has crossed a domain.

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
- A channel's profit is contribution — the sale less that channel's fees and
  the recipe cost — and is already worked out. Quote it; never rebuild it
  from a commission and a price, and never present it as net profit.
- Sales come from PureMargin's own register. Why stock is not moving is
  answered from get_inventory_levels, whose settings say whether sales deduct
  stock.`;
