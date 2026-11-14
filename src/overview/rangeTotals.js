/* The Overview's figures for the range that is picked.

   The server works everything out for the last 30 days, and for a longer
   range (90 days, a year, all time) when one is asked for. A shorter range
   — today, the last 7 days — is summed here from the day rows.

   It used to be only the sales, orders and average ticket. Gross profit,
   margin, food cost and the purity score stayed on the 30 days whatever was
   picked, so on "Today" the profit beside a day's takings was a month's, and
   could be larger than the takings it came from. Each day now carries its
   own cost (`api/_aggregate.js`), so every figure on the screen covers the
   same days. `basis` says which days the profit figures actually cover, for
   the one case where they cannot follow: a payload from before the days
   carried their cost.

   Plain JavaScript, no React, so it can be tested on its own. */

import { pureScore } from "../../shared/purity.js";

export const DATE_RANGES = [
  { key: "daily", days: 1 },
  { key: "weekly", days: 7 },
  { key: "monthly", days: 30 },
  { key: "quarter", days: 90, long: true },
  { key: "year", days: 365, long: true },
  { key: "all", days: null, long: true },
];

/* Change against the period just before, or null when that period sold
   nothing — no comparison, rather than a flat one. */
const change = (now, before) => (before > 0 ? Number((((now - before) / before) * 100).toFixed(1)) : null);
const round2 = (n) => Math.round(n * 100) / 100;
const sum = (rows, k) => rows.reduce((s, d) => s + (Number(d[k]) || 0), 0);

/* Gross profit for a run of days, worked the way the server works the 30:
   sales without VAT less the cost of what sold. Margin on the costed dishes
   and cost coverage come from the line takings, as they do there. */
export function profitOfDays(rows) {
  const salesExVat = sum(rows, "sales") - sum(rows, "tax");
  const cost = sum(rows, "cost");
  const lineNet = sum(rows, "lineNet");
  const costedNet = sum(rows, "costedNet");
  const costedCost = sum(rows, "costedCost");
  const grossProfit = salesExVat - cost;
  return {
    totals: {
      cost: round2(cost),
      salesExVat: round2(salesExVat),
      grossProfit: round2(grossProfit),
      marginPct: salesExVat > 0 ? Number(((grossProfit / salesExVat) * 100).toFixed(1)) : 0,
      costedMarginPct: costedNet > 0 ? Number((((costedNet - costedCost) / costedNet) * 100).toFixed(1)) : null,
    },
    costCoverage: lineNet > 0 ? Math.round((costedNet / lineNet) * 100) : 0,
  };
}

/* Food cost as a share of sales without VAT, the base the margin beside it
   is worked on. It was over sales with VAT, so a menu whose margin said 65%
   (food cost 35%) read 33.3%: the VAT is owed to the tax authority, not a
   cushion under the food bill. Null with nothing sold. */
export function foodCostPct(totals) {
  const base = Number(totals?.salesExVat) || 0;
  return base > 0 ? Number((((Number(totals?.cost) || 0) / base) * 100).toFixed(1)) : null;
}

/* A range nobody sold in has no margin to score. Without this a quiet
   morning read "add item costs to score this", which is not the problem. */
export function scoreFor(totals, costCoverage) {
  if (!(Number(totals?.receipts) > 0)) return { value: null, state: "nosales" };
  return pureScore({ costCoverage, totals });
}

export function rangeTotals(data, range) {
  /* The server's own 30 days: its totals, its coverage and its score. */
  const thirty = (totals) => ({
    totals, basis: "monthly", costCoverage: data.costCoverage ?? 0, score: data.margin?.score || null,
  });

  /* A long range comes back from the server worked out for that period,
     with its own comparison and profit. Until it has, the 30 days stand in. */
  if (DATE_RANGES.find((r) => r.key === range)?.long && data.period?.key === range) {
    const totals = { ...data.totals, ...data.period.totals };
    const base = { series: data.period.series, period: data.period };
    if (data.period.totals?.grossProfit === undefined) return { ...base, ...thirty(totals) };
    const costCoverage = data.period.totals.costCoverage ?? 0;
    return { ...base, totals, basis: range, costCoverage, score: scoreFor(totals, costCoverage) };
  }

  const daily = data.daily || [];
  if (!daily.length) return { series: [], ...thirty(data.totals || {}) };
  const days = (DATE_RANGES.find((r) => r.key === range) || {}).days;
  const slice = days ? daily.slice(-days) : daily;
  if (!slice.length) return { series: [], ...thirty(data.totals || {}) };

  const sales = sum(slice, "sales");
  const receipts = sum(slice, "receipts");
  const tax = sum(slice, "tax");
  const avgTicket = receipts > 0 ? sales / receipts : 0;

  /* Each range against the one before it: today against yesterday, this
     week against last week. The cards used to show the 30-day comparison
     whatever range was picked, so "today" quoted a month's change. The
     30-day range keeps the server's, which can see the month before. */
  let deltas = {};
  if (days && days < daily.length && daily.length >= days * 2) {
    const prior = daily.slice(-days * 2, -days);
    const pSales = sum(prior, "sales");
    const pReceipts = sum(prior, "receipts");
    deltas = {
      salesDelta: change(sales, pSales),
      receiptsDelta: change(receipts, pReceipts),
      avgTicketDelta: pReceipts > 0 && receipts > 0 ? change(avgTicket, pSales / pReceipts) : null,
    };
  }
  const totals = { ...data.totals, sales, receipts, avgTicket, tax, ...deltas };

  /* Shorter than the 30 days, and the days know their cost: the range's own
     profit and score. The 30 days themselves keep the server's figures,
     which are the same days unrounded. */
  if (days && days < daily.length && slice.every((d) => d.cost !== undefined)) {
    const profit = profitOfDays(slice);
    const ranged = { ...totals, ...profit.totals };
    return { series: slice, totals: ranged, basis: range, costCoverage: profit.costCoverage, score: scoreFor(ranged, profit.costCoverage) };
  }
  return { series: slice, ...thirty(totals) };
}
