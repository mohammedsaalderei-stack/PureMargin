/* Targets, thresholds and alerts — stage 4, phase 7.

   The document's rule for the whole product is that every feature must end in an
   actionable answer: what happened, why, what it cost, and what to do next. The
   phases so far answer the first three. This one exists for the fourth.

   An alert here is therefore never a number with an exclamation mark. It is a
   finding with a threshold it crossed, the evidence behind it, and one recommended
   action. Four rules keep that honest:

   1. **A threshold is the owner's, not ours.** Every alert names the target it
      breached, and every target is editable. A hard-coded rule of thumb dressed up
      as an insight is how software loses the operator's trust.
   2. **Nothing is predicted from nothing.** Days of cover and projected stockouts
      need a usage rate; where the period recorded no usage the alert says the rate
      is unknown instead of promising a date. The direction document is explicit:
      state what is missing rather than issue an unsupported recommendation.
   3. **Severity is money, not novelty.** Alerts are ranked by financial effect
      where one is known, so the first thing on the list is the thing worth doing.
   4. **Wording lives in the interface.** Each alert carries a `kind`, an `action`
      key and its numbers — never a sentence — because the platform speaks four
      languages and an English string in an API is a bug in three of them.

   Isolation follows every other phase: org id from the session, branch list already
   authorized and intersected by the route. */

import { listIngredients } from "./_inventory.js";
import { balances } from "./_movements.js";
import { varianceReport } from "./_variance.js";
import { getJSON, setJSON } from "./_store.js";

const TARGETS = (orgId) => `inv:${orgId}:targets`;
const DAY = 864e5;

/* The defaults are ordinary restaurant practice, not a claim about this kitchen:
   a 30% food cost target, a 5% usage variance tolerance, a week of cover, and
   sixty days without movement before stock counts as dead. They exist so the
   screen says something useful on day one, and every one of them is editable. */
export const TARGET_DEFAULTS = {
  foodCostPct: 30,
  variancePct: 5,
  /* Money below which a variance isn't worth an owner's attention, so a 400%
     variance on parsley doesn't outrank a 3% one on beef. */
  varianceFloor: 50,
  coverDays: 7,
  slowMovingDays: 60,
  expiryDays: 7,
};

const clamp = (n, min, max, fallback) => {
  const value = Number(n);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
};

export async function getTargets(orgId) {
  const saved = (await getJSON(TARGETS(orgId))) || {};
  return { ...TARGET_DEFAULTS, ...saved };
}

/* Bounded rather than trusted: a target of 0% food cost or 10,000 cover days
   would produce an alert on every row forever, which is the same as no alerts. */
export async function saveTargets(orgId, input = {}) {
  const current = await getTargets(orgId);
  const next = {
    foodCostPct: clamp(input.foodCostPct, 1, 100, current.foodCostPct),
    variancePct: clamp(input.variancePct, 0, 100, current.variancePct),
    varianceFloor: clamp(input.varianceFloor, 0, 1e6, current.varianceFloor),
    coverDays: clamp(input.coverDays, 1, 90, current.coverDays),
    slowMovingDays: clamp(input.slowMovingDays, 7, 365, current.slowMovingDays),
    expiryDays: clamp(input.expiryDays, 1, 90, current.expiryDays),
  };
  await setJSON(TARGETS(orgId), next);
  return next;
}

/* Severity has three levels and they mean something specific:
     critical — money is being lost now, or stock is already impossible (negative).
     warning  — a threshold is crossed and there is time to act.
     info     — worth knowing, nothing is on fire. */
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };

/* Every alert kind, with the action the operator should take. The action is a key
   the interface translates; pairing it with the kind here means an alert cannot be
   added without deciding what somebody is supposed to do about it. */
export const ALERT_KINDS = {
  foodcost: { severity: "warning", action: "reviewPricing" },
  variance: { severity: "critical", action: "investigateUsage" },
  stockout: { severity: "critical", action: "orderNow" },
  reorder: { severity: "warning", action: "reorder" },
  negative: { severity: "critical", action: "countStock" },
  slowmoving: { severity: "info", action: "reduceHolding" },
  expiry: { severity: "warning", action: "useFirst" },
  norate: { severity: "info", action: "recordIssues" },
};

/* Everything that needs doing, ranked.

   One pass over the same figures the leakage screen uses, so an alert can never
   disagree with the report it came from — they are the same computation, asked a
   different question. */
export async function buildAlerts(orgId, branchIds, {
  salesRows = [], from, to = Date.now(), method, targets: given,
} = {}) {
  const targets = given || (await getTargets(orgId));
  const ingredients = await listIngredients(orgId);
  const report = await varianceReport(orgId, branchIds, { salesRows, from, to, method });
  const stock = await balances(orgId, branchIds, { ingredients, to });

  /* The window the usage rate is measured over. A rate from three days of history
     is stated as such rather than annualised into a confident forecast. */
  const days = Math.max(1, Math.round(((to - (from || to - 30 * DAY)) / DAY)));
  const usageByIngredient = new Map(report.items.map((i) => [i.ingredientId, i]));

  const alerts = [];
  const add = (kind, fields) => alerts.push({
    kind,
    severity: fields.severity || ALERT_KINDS[kind].severity,
    action: ALERT_KINDS[kind].action,
    ...fields,
  });

  /* --- Costing targets: the one alert about the whole business, not an item. --- */
  if (report.totals.actualCostPct !== null && report.totals.actualCostPct > targets.foodCostPct) {
    add("foodcost", {
      id: "foodcost",
      actualPct: report.totals.actualCostPct,
      theoreticalPct: report.totals.theoreticalCostPct,
      targetPct: targets.foodCostPct,
      /* What closing the gap is worth over this period — the reason to act. */
      value: Math.round(((report.totals.actualCostPct - targets.foodCostPct) / 100) * report.totals.revenue),
      /* Stated so a breach computed over half a menu isn't read as fact. */
      coverage: report.quality.recipeCoverage,
    });
  }

  /* --- Unusual variance, per ingredient, past both thresholds. ------------- */
  for (const item of report.items) {
    const value = item.value.unexplained;
    if (value === null || value <= targets.varianceFloor) continue;
    const pct = item.theoreticalBase > 0
      ? (item.unexplainedBase / item.theoreticalBase) * 100 : null;
    /* No expectation to measure against means no percentage — the money alone
       carries it, and only above the floor. */
    if (pct !== null && pct < targets.variancePct) continue;

    add("variance", {
      id: `variance:${item.ingredientId}`,
      ingredientId: item.ingredientId,
      subject: item.name,
      value: Math.round(value),
      pct: pct === null ? null : Number(pct.toFixed(1)),
      targetPct: targets.variancePct,
      wasteValue: item.value.waste,
    });
  }

  /* --- Stock: cover, reorder, negative, dead stock, expiry. ---------------- */
  for (const row of stock) {
    const usage = usageByIngredient.get(row.ingredientId);
    const usedBase = usage ? usage.actualBase : 0;
    const perDay = usedBase / days;

    if (row.negative) {
      add("negative", {
        id: `negative:${row.ingredientId}`,
        ingredientId: row.ingredientId,
        subject: row.name,
        qty: row.qty,
        unit: row.stockUnit,
      });
      continue;
    }

    if (perDay > 0) {
      /* Days of cover, and the date the shelf runs out at today's rate. Lead
         time isn't subtracted here — it belongs to the supplier, and the
         purchasing screen owns that conversation. */
      const coverDays = (usage.actualBase > 0 ? row.qtyBase / (usedBase / days) : Infinity);
      if (coverDays <= targets.coverDays) {
        add("stockout", {
          id: `stockout:${row.ingredientId}`,
          ingredientId: row.ingredientId,
          subject: row.name,
          coverDays: Number(coverDays.toFixed(1)),
          targetDays: targets.coverDays,
          runsOutAt: to + coverDays * DAY,
          qty: row.qty,
          unit: row.stockUnit,
          /* The forecast's own assumptions, carried with it. */
          basis: { days, usedBase, perDayBase: Number(perDay.toFixed(4)) },
          severity: coverDays <= 1 ? "critical" : "warning",
        });
        continue;
      }
    } else if (row.qtyBase > 0 && row.reorderPoint !== null && row.reorderPoint !== undefined) {
      /* Stock on hand, a threshold set, and no usage recorded at all: the cover
         figure would be a fiction, so the gap in the ledger is the finding. */
      add("norate", {
        id: `norate:${row.ingredientId}`,
        ingredientId: row.ingredientId,
        subject: row.name,
        days,
      });
    }

    if (row.belowReorder && !row.negative) {
      add("reorder", {
        id: `reorder:${row.ingredientId}`,
        ingredientId: row.ingredientId,
        subject: row.name,
        qty: row.qty,
        reorderPoint: row.reorderPoint,
        parLevel: row.parLevel,
        unit: row.stockUnit,
      });
    }

    const idle = row.lastMovedAt ? Math.floor((to - row.lastMovedAt) / DAY) : null;
    if (row.qtyBase > 0 && idle !== null && idle >= targets.slowMovingDays) {
      add("slowmoving", {
        id: `slowmoving:${row.ingredientId}`,
        ingredientId: row.ingredientId,
        subject: row.name,
        idleDays: idle,
        targetDays: targets.slowMovingDays,
        qty: row.qty,
        unit: row.stockUnit,
      });
    }

    /* Expiry is inferred from shelf life and the last time stock came in, which
       is the best this data supports — batch-level expiry dates would be a
       stronger answer and a bigger change to the ledger. Stated as an estimate
       for exactly that reason. */
    const ingredient = ingredients.find((i) => i.id === row.ingredientId);
    if (ingredient?.shelfLifeDays && row.qtyBase > 0 && row.lastMovedAt) {
      const expiresAt = row.lastMovedAt + ingredient.shelfLifeDays * DAY;
      const daysLeft = Math.floor((expiresAt - to) / DAY);
      if (daysLeft <= targets.expiryDays) {
        add("expiry", {
          id: `expiry:${row.ingredientId}`,
          ingredientId: row.ingredientId,
          subject: row.name,
          daysLeft,
          shelfLifeDays: ingredient.shelfLifeDays,
          qty: row.qty,
          unit: row.stockUnit,
          estimated: true,
          severity: daysLeft <= 0 ? "critical" : "warning",
        });
      }
    }
  }

  alerts.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    (b.value || 0) - (a.value || 0) ||
    String(a.subject || "").localeCompare(String(b.subject || "")));

  return {
    alerts,
    targets,
    period: { from: from || to - 30 * DAY, to, days },
    counts: {
      critical: alerts.filter((a) => a.severity === "critical").length,
      warning: alerts.filter((a) => a.severity === "warning").length,
      info: alerts.filter((a) => a.severity === "info").length,
    },
    /* The same data-quality account the leakage report gives, because an empty
       alert list has two very different meanings. */
    quality: report.quality,
    totals: report.totals,
  };
}
