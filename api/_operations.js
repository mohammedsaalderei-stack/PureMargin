/* Operational forecasting — stage 5.

   Stage 4 ended with figures that explain the past. This file exists to turn them
   into two decisions somebody makes tomorrow morning: **what to buy** and **which
   branch to walk into**. The document is exact about the terms: a forecast must
   show its period, its range, its confidence and its assumptions, and where the
   data is incomplete or stale it must say so instead of issuing a confident
   recommendation.

   So nothing here returns a bare number.

   - A purchase line carries a quantity, a plausible range, a confidence grade, and
     the assumptions the arithmetic rests on — usage rate, lead time, pack rounding.
   - Confidence is derived from the data, never asserted: how many days of history
     exist, how many of the weeks actually recorded usage, how variable that usage
     was, and whether the sales feeding it are fresh. Volatile usage over four days
     cannot produce a high-confidence order, and this file will not pretend it can.
   - Where there is no usage at all there is **no recommendation**, with a reason.
     An empty plan and a plan of zeroes mean different things.
   - The branch ranking answers "which branch leaked the most, and why" by running
     the same variance report per branch — so the ranking and the leakage screen
     cannot disagree.

   Isolation as everywhere else: org from the session, branch list already
   authorized and intersected by the route. */

import { listIngredients, listSuppliers } from "./_inventory.js";
import { balances, listMovements } from "./_movements.js";
import { varianceReport } from "./_variance.js";
import { getTargets } from "./_alerts.js";
import { toBase } from "./_units.js";

const DAY = 864e5;
const WEEK = 7 * DAY;

/* Movement types that mean "this left the store to be used". Identical to the
   variance engine's list, and for the same reason: transfers and supplier returns
   moved stock without consuming it, so treating them as demand would have one
   branch order for another branch's shelf. */
const CONSUMING = new Set(["consume", "issue", "waste"]);

const round = (n, places = 2) => Number(Number(n).toFixed(places));

/* Mean and spread of a series, and the coefficient of variation — the one number
   that says whether an average is worth forecasting from at all. */
function spread(values) {
  if (values.length === 0) return { mean: 0, sd: 0, cv: null };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (values.length === 1) return { mean, sd: 0, cv: null };
  const variance = values.reduce((total, v) => total + (v - mean) ** 2, 0) / (values.length - 1);
  const sd = Math.sqrt(variance);
  return { mean, sd, cv: mean > 0 ? sd / mean : null };
}

/* Weekly usage per ingredient, which is the right grain for a restaurant: demand
   is weekly-seasonal (weekends), so daily buckets are noise and monthly ones hide
   a trend. Reversed entries and reversals are both skipped, exactly as in the
   ledger's own totals. */
async function weeklyUsage(orgId, branchIds, { from, to }) {
  const weeks = Math.max(1, Math.ceil((to - from) / WEEK));
  const byIngredient = new Map();

  for (const branchId of branchIds) {
    const ledger = await listMovements(orgId, branchId, { from, to, limit: Infinity });
    for (const m of ledger) {
      if (m.reversedBy || m.reverses) continue;
      if (!CONSUMING.has(m.type)) continue;

      const row = byIngredient.get(m.ingredientId) || { buckets: new Array(weeks).fill(0), total: 0, lastAt: 0 };
      const index = Math.min(weeks - 1, Math.floor((m.at - from) / WEEK));
      const out = -m.qtyBase;
      row.buckets[index] += out;
      row.total += out;
      row.lastAt = Math.max(row.lastAt, m.at);
      byIngredient.set(m.ingredientId, row);
    }
  }

  return { weeks, byIngredient };
}

/* Confidence, graded from the evidence rather than announced.

   The rules are deliberately conservative: a recommendation the operator later
   finds wrong costs more trust than one that admitted it was rough. */
export function gradeConfidence({ days, weeksWithUsage, cv, stale }) {
  const reasons = [];
  if (days < 14) reasons.push("shortHistory");
  if (weeksWithUsage < 2) reasons.push("fewWeeks");
  if (cv !== null && cv > 0.6) reasons.push("volatile");
  if (stale) reasons.push("staleSales");

  let level = "high";
  if (reasons.length === 1) level = "medium";
  if (reasons.length > 1) level = "low";
  /* Any single one of these on its own is enough to rule out "high": a rate from
     one week is a guess whatever its spread looks like. */
  if (days < 14 || weeksWithUsage < 2) level = reasons.length > 1 ? "low" : "medium";
  return { level, reasons };
}

/* What to buy, and how sure we are.

   `horizonDays` is what the plan covers — the days of trading the delivery has to
   last. Lead time is added on top per ingredient, because an order that arrives in
   three days must cover those three days too. */
export async function purchasePlan(orgId, branchIds, {
  from, to = Date.now(), horizonDays = 7, targets: givenTargets, stale = false,
} = {}) {
  const targets = givenTargets || (await getTargets(orgId));
  const ingredients = await listIngredients(orgId);
  const byId = new Map(ingredients.map((i) => [i.id, i]));
  /* Lead time belongs to the supplier, not the ingredient — the same tomato is
     next-day from one merchant and weekly from another. */
  const leadBySupplier = new Map((await listSuppliers(orgId)).map((s) => [s.id, Number(s.leadTimeDays) || 0]));
  const start = from || to - 30 * DAY;
  const days = Math.max(1, Math.round((to - start) / DAY));

  const { weeks, byIngredient } = await weeklyUsage(orgId, branchIds, { from: start, to });
  const stock = await balances(orgId, branchIds, { ingredients, to });

  const lines = [];
  const skipped = [];

  for (const row of stock) {
    const ingredient = byId.get(row.ingredientId);
    if (!ingredient) continue;
    const usage = byIngredient.get(row.ingredientId);

    if (!usage || usage.total <= 0) {
      /* No demand signal. Named with a reason rather than dropped, so the plan can
         be read as complete — and so the missing ledger entries are visible. */
      skipped.push({ ingredientId: row.ingredientId, name: row.name, reason: "nousage" });
      continue;
    }

    /* Rate per day, from the weekly buckets that actually exist. Buckets before the
       first recorded movement are counted: a quiet week is real demand information,
       whereas a week before the ingredient was ever stocked is not. */
    const firstWeek = usage.buckets.findIndex((b) => b > 0);
    const live = usage.buckets.slice(firstWeek === -1 ? 0 : firstWeek);
    const { mean, sd, cv } = spread(live);
    const perDay = mean / 7;
    const weeksWithUsage = live.filter((b) => b > 0).length;

    const leadDays = leadBySupplier.get(ingredient.supplierId) || 0;
    const coverNeededDays = horizonDays + leadDays;
    const needBase = perDay * coverNeededDays - row.qtyBase;

    /* The range is the same arithmetic at one standard deviation either side of the
       weekly mean — an honest band, not a decorative one. */
    const band = (sd / 7) * coverNeededDays;
    const low = Math.max(0, needBase - band);
    const high = Math.max(0, needBase + band);

    const confidence = gradeConfidence({ days, weeksWithUsage, cv, stale });
    const coverDays = perDay > 0 ? row.qtyBase / perDay : null;

    /* Pack rounding is stated, not silently applied, because the operator orders in
       cases and reconciles in kilograms. */
    const packSize = Number(ingredient.packSize) > 0 ? Number(ingredient.packSize) : 1;
    /* One pack in base units, via the platform's own conversion table rather than a
       second copy of it here. */
    const perPackBase = toBase(packSize, ingredient.purchaseUnit || ingredient.stockUnit) || 0;
    const packs = needBase > 0 && perPackBase > 0 ? Math.ceil(needBase / perPackBase) : 0;

    lines.push({
      ingredientId: row.ingredientId,
      name: row.name,
      category: row.category || "",
      supplierId: ingredient.supplierId || "",
      stockUnit: ingredient.stockUnit,
      purchaseUnit: ingredient.purchaseUnit || ingredient.stockUnit,
      onHandBase: round(row.qtyBase, 4),
      onHand: row.qty,
      perDayBase: round(perDay, 4),
      coverDays: coverDays === null ? null : round(coverDays, 1),
      /* Order nothing when the shelf already covers the horizon — a plan that
         always says "buy" is a catalogue, not a recommendation. */
      orderBase: round(Math.max(0, needBase), 4),
      rangeBase: { low: round(low, 4), high: round(high, 4) },
      packs,
      packSize,
      confidence: confidence.level,
      confidenceReasons: confidence.reasons,
      urgent: coverDays !== null && coverDays <= leadDays,
      assumptions: [
        "usageFromLedger",
        ...(leadDays > 0 ? ["leadTime"] : ["noLeadTime"]),
        ...(packs > 0 ? ["packRounding"] : []),
      ],
      basis: {
        days, weeks: live.length, weeksWithUsage,
        weeklyMeanBase: round(mean, 4),
        weeklySdBase: round(sd, 4),
        cv: cv === null ? null : round(cv, 2),
        leadDays,
      },
    });
  }

  /* Ordered by how soon it bites: what's already past its lead time first, then
     the least cover. */
  lines.sort((a, b) =>
    Number(b.urgent) - Number(a.urgent) ||
    (a.coverDays ?? Infinity) - (b.coverDays ?? Infinity));

  return {
    horizonDays,
    period: { from: start, to, days, weeks },
    lines,
    skipped,
    targets,
    /* One honest summary of the whole plan's standing, for a screen that must not
       imply more certainty than the weakest half of its rows. */
    confidence: worstOf(lines.map((l) => l.confidence)),
  };
}

const RANK = { low: 0, medium: 1, high: 2 };
function worstOf(levels) {
  if (levels.length === 0) return null;
  return levels.reduce((worst, level) => (RANK[level] < RANK[worst] ? level : worst), "high");
}

/* Which branch leaked the most, and why.

   One variance report per branch, then the group total from the same call the
   leakage screen makes, so a ranking can never contradict the report behind it.
   A single-branch scope still returns one row: the owner's view and the branch
   manager's view are the same computation. */
export async function branchRanking(orgId, branchIds, {
  salesByBranch = new Map(), from, to = Date.now(), method, targets: givenTargets,
} = {}) {
  const targets = givenTargets || (await getTargets(orgId));
  const rows = [];

  for (const branchId of branchIds) {
    const report = await varianceReport(orgId, [branchId], {
      salesRows: salesByBranch.get(branchId) || [], from, to, method,
    });
    rows.push({
      branchId,
      revenue: report.totals.revenue,
      theoreticalCostPct: report.totals.theoreticalCostPct,
      actualCostPct: report.totals.actualCostPct,
      overTarget: report.totals.actualCostPct !== null
        ? round(report.totals.actualCostPct - targets.foodCostPct, 1) : null,
      waste: report.totals.waste,
      unexplained: report.totals.unexplained,
      /* The "why": the three ingredients carrying most of this branch's leak. */
      drivers: report.items.slice(0, 3).map((i) => ({
        ingredientId: i.ingredientId, name: i.name, value: i.value.unexplained,
      })),
      recipeCoverage: report.quality.recipeCoverage,
    });
  }

  rows.sort((a, b) => (b.unexplained || 0) - (a.unexplained || 0));
  return { rows, targets };
}
