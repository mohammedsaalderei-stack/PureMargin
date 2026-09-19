import { listCosts, monthlyTotal } from "./_fixedcosts.js";
import { listVarCosts, totalOf as varTotalOf, todayISO } from "./_varcosts.js";

/* What the business actually kept.

   ── Why this is its own file ─────────────────────────────────────────────

   Two things in this codebase want to answer "what is my net profit": the
   dashboard, which an owner reads every morning, and the assistant, which is
   asked it in words. `_domains.js` already says why that must not be two
   implementations — "a second implementation of cost of sales is exactly how
   the assistant's number starts disagreeing with the report" — and the same
   reasoning applies one level up. So the calculation lives here and both call
   it.

   ── The periods have to line up, and they did not ────────────────────────

   The assistant's version set a **rolling thirty days** of revenue and cost of
   goods against a **calendar month** of rent and a **month-to-date** total of
   variable spending.

   The last of those is the one that did real damage. On the third of the
   month, month-to-date variable costs cover three days while the revenue
   beside them covers thirty. Net profit came out high at the start of every
   month and sank as the month went on — a pattern with no cause in the
   business at all, produced entirely by the window. An owner watching it
   would have drawn a conclusion about their trading from an artefact of
   arithmetic.

   Everything here is therefore measured over one window: the same trailing
   thirty days the dashboard's sales figure already covers.

   ── Rent does not accrue in thirty-day units ─────────────────────────────

   A month is 30.44 days on average, so a monthly rent scaled to a thirty-day
   window is very slightly less than the bill. The alternative is to set a
   whole month's rent against thirty days of sales and call the 1.4% a rounding
   error, which is the kind of small deliberate wrongness that is impossible to
   find later. The window is stated in the result so the number can be
   explained rather than guessed at. */

export const TRAILING_DAYS = 30;

/* 365.25 / 12. The Gregorian average, so a leap year does not quietly change
   what a month is worth. */
const DAYS_PER_MONTH = 30.4375;

const DAY_MS = 864e5;
const round2 = (n) => Math.round(n * 100) / 100;

const isoDay = (ms) => todayISO(new Date(ms));

/* Operating costs over a window, and the pieces they are made of.

   Returned separately rather than as one total because "your overheads are
   forty thousand" is not actionable and "rent is thirty, wages eight, the rest
   is deliveries" is. */
export async function operatingCosts(orgId, { now = Date.now(), days = TRAILING_DAYS } = {}) {
  const from = isoDay(now - (days - 1) * DAY_MS);
  const to = isoDay(now);

  const fixed = await listCosts(orgId);
  const variable = await listVarCosts(orgId, { from, to });

  /* Monthly equivalents, scaled to the window. `monthlyTotal` already folds a
     yearly cost down to a month, so this is the one conversion left. */
  const fixedForWindow = monthlyTotal(fixed) * (days / DAYS_PER_MONTH);

  return {
    from,
    to,
    days,
    fixed: round2(fixedForWindow),
    fixedMonthly: round2(monthlyTotal(fixed)),
    variable: round2(varTotalOf(variable)),
    entries: { fixed: fixed.length, variable: variable.length },
  };
}

/* Turnover, less the cost of the goods, less what it costs to open the doors.

   `netSales` and `cogs` are passed in rather than recomputed, because the
   metrics engine has already worked them out against a particular branch scope
   and a particular window, and a second pass here would be free to disagree
   with the figure printed above it on the same screen.

   ── On what this number is worth ─────────────────────────────────────────

   `coverage` travels with it, and is not decoration. Cost of goods is summed
   from the dishes that have a cost; a menu where half the items have no recipe
   produces a COGS that is a lower bound, so the profit resting on it is an
   upper bound — flattering by an unknown amount. A profit figure that does not
   carry that caveat is a figure somebody will take to a bank.

   Null, not zero, when there is nothing to divide by. Zero is a claim. */
export async function netProfit(orgId, { netSales, cogs, coverage = null, now = Date.now(), days = TRAILING_DAYS } = {}) {
  const sales = Number(netSales) || 0;
  const goods = Number(cogs) || 0;
  const costs = await operatingCosts(orgId, { now, days });

  const gross = round2(sales - goods);
  const net = round2(gross - costs.fixed - costs.variable);

  return {
    period: { from: costs.from, to: costs.to, days: costs.days },
    netSales: round2(sales),
    costOfGoods: round2(goods),
    grossProfit: gross,
    fixedCosts: costs.fixed,
    fixedMonthly: costs.fixedMonthly,
    variableCosts: costs.variable,
    net,
    netMarginPct: sales > 0 ? round2((net / sales) * 100) : null,
    grossMarginPct: sales > 0 ? round2((gross / sales) * 100) : null,
    /* How much of the menu the cost side actually covers, 0–1. */
    costCoverage: coverage,
    /* Whether anybody has told us what it costs to open the doors. Without a
       single fixed cost on record, net profit and gross profit are the same
       number — and presenting that as a business with no overheads would be
       the most flattering lie this screen could tell. */
    hasOperatingCosts: costs.entries.fixed > 0 || costs.entries.variable > 0,
    formula: "net = netSales - costOfGoods - fixedCosts - variableCosts",
  };
}
