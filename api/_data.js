/* The figures every screen reads, from the business's own sales.

   Sales are the receipts the register writes (`_till.js`); branches are the
   stores the business sets up itself (`_stores.js`). There is no other till
   behind this any more and nothing upstream to fetch, cache or wait for: a
   sale rung up a second ago is in the next figure read. */

import { buildAdvice } from "./_advice.js";
import { marginLayer } from "./_margin.js";
import { aggregate } from "./_aggregate.js";
import { applyEdits } from "./_saleedits.js";

/* Everything vendor-specific — base URL, auth, endpoint names, field names,
   pagination — lives in _pos.js. Read per call rather than captured at module
   load, so changing POS_PROVIDER takes effect without a cold start. */
/* Nothing is cached any more; kept so tests written against the old cache still run. */
export function clearCache() {}

const DAY = 864e5;
const hourLabel = (h) => {
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${suffix}`;
};

/* ------------------------------------------------------------------ */
/*  Forecast — trend plus widening uncertainty                          */
/* ------------------------------------------------------------------ */
function buildForecast(daily) {
  const recent = daily.slice(-14);
  const earlier = daily.slice(-28, -14);
  const avg = (rows) => (rows.length ? rows.reduce((s, r) => s + r.sales, 0) / rows.length : 0);

  const recentAvg = avg(recent) || 1;
  const earlierAvg = avg(earlier) || recentAvg;
  const dailyGrowth = Math.max(-0.004, Math.min(0.006, (recentAvg / earlierAvg - 1) / 14));

  const series = [];
  let conservative = 0, base = 0, optimistic = 0;

  for (let d = 1; d <= 30; d++) {
    const centre = recentAvg * Math.pow(1 + dailyGrowth, d);
    // Uncertainty grows with distance; a month out genuinely is less certain.
    const spread = 0.12 + (d / 30) * 0.22;
    const lo = Math.round(centre * (1 - spread));
    const hi = Math.round(centre * (1 + spread));
    const mid = Math.round(centre);

    conservative += lo;
    base += mid;
    optimistic += hi;
    series.push({ day: d, conservative: lo, base: mid, optimistic: hi });
  }

  return { conservative, base, optimistic, series };
}

/* ------------------------------------------------------------------ */
/*  Menu engineering                                                    */
/*  The classic four-quadrant read every F&B consultant runs: how often */
/*  a dish sells against what it brings in per sale. Without item costs */
/*  from the POS this uses revenue per unit as a stand-in for margin,   */
/*  which the UI states plainly rather than implying true profit.       */
/* ------------------------------------------------------------------ */
function menuMatrix(items) {
  const priced = items
    .filter((i) => i.qty > 0)
    .map((i) => ({ ...i, perUnit: i.revenue / i.qty }));

  if (priced.length < 2) return { items: [], medianQty: 0, medianPerUnit: 0 };

  const median = (values) => {
    const v = [...values].sort((a, b) => a - b);
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  };

  const medianQty = median(priced.map((i) => i.qty));
  const medianPerUnit = median(priced.map((i) => i.perUnit));

  const classify = (i) => {
    const popular = i.qty >= medianQty;
    const rich = i.perUnit >= medianPerUnit;
    if (popular && rich) return "star";      // sells well, earns well
    if (popular && !rich) return "workhorse"; // sells well, earns little
    if (!popular && rich) return "puzzle";    // earns well, rarely ordered
    return "drag";                            // neither
  };

  return {
    medianQty,
    medianPerUnit: Math.round(medianPerUnit),
    items: priced.map((i) => ({
      name: i.name,
      category: i.category,
      qty: Math.round(i.qty),
      revenue: Math.round(i.revenue),
      perUnit: Math.round(i.perUnit),
      quadrant: classify(i),
    })),
  };
}

/* ------------------------------------------------------------------ */
/*  Observations                                                        */
/*  Structured, not prose, so the interface renders them in either      */
/*  language. Only things that are actually true of the numbers.        */
/* ------------------------------------------------------------------ */
function observations(m) {
  const out = [];
  const sum = (rows) => rows.reduce((s, r) => s + r.sales, 0);

  const last7 = m.daily.slice(-7);
  const prior7 = m.daily.slice(-14, -7);
  const a = sum(last7), b = sum(prior7);
  if (b > 0) {
    const pct = Number((((a - b) / b) * 100).toFixed(1));
    if (Math.abs(pct) >= 2) {
      out.push({ id: "trend", tone: pct >= 0 ? "good" : "warn", values: { pct: Math.abs(pct) } });
    }
  }

  const best = m.daily.reduce((x, y) => (y.sales > x.sales ? y : x), m.daily[0]);
  if (best) out.push({ id: "bestDay", tone: "neutral", values: { day: best.label, amount: best.sales } });

  const top = m.items[0];
  if (top) out.push({ id: "topItem", tone: "neutral", values: { name: top.name, share: top.share } });

  const peak = m.hours.reduce((x, y) => (y.receipts > x.receipts ? y : x), m.hours[0]);
  const quiet = m.hours.filter((h) => h.receipts > 0).sort((x, y) => x.receipts - y.receipts)[0];
  if (peak && quiet && peak.label !== quiet.label) {
    out.push({
      id: "spread",
      tone: "neutral",
      values: { peak: peak.label, quiet: quiet.label, ratio: Math.round(peak.receipts / Math.max(quiet.receipts, 1)) },
    });
  }

  if (m.stores.length >= 2) {
    const first = m.stores[0], last = m.stores[m.stores.length - 1];
    if (last.sales > 0) {
      const gap = Math.round(((first.sales - last.sales) / last.sales) * 100);
      if (gap >= 15) out.push({ id: "branchGap", tone: "warn", values: { top: first.name, bottom: last.name, pct: gap } });
    }
  }

  const weekend = m.daily.filter((d) => [4, 5].includes(new Date(d.date).getDay()));
  const weekday = m.daily.filter((d) => ![4, 5].includes(new Date(d.date).getDay()));
  if (weekend.length && weekday.length) {
    const we = sum(weekend) / weekend.length;
    const wd = sum(weekday) / weekday.length;
    if (wd > 0) {
      const lift = Math.round(((we - wd) / wd) * 100);
      if (Math.abs(lift) >= 10) out.push({ id: "weekend", tone: "neutral", values: { pct: Math.abs(lift), up: lift > 0 } });
    }
  }

  return out.slice(0, 5);
}

function finish(m) {
  const peak = m.hours.reduce((a, b) => (b.receipts > a.receipts ? b : a), m.hours[0] || { label: "—" });
  const withBase = {
    ...m,
    totals: { ...m.totals, peakHour: peak.label },
    forecast: buildForecast(m.daily),
    menu: menuMatrix(m.items),
    updatedAt: new Date().toISOString(),
  };
  const withObs = { ...withBase, observations: observations(withBase) };
  const withAdvice = { ...withObs, advice: buildAdvice(withObs) };
  return { ...withAdvice, margin: marginLayer(withAdvice) };
}

/* ---------------------------------------------------------------- */
/*  Live POS                                                          */
/* Nothing has been sold yet. The interface turns this into "start selling"
   rather than presenting zeros as if they were a quiet month. */
export class NotConnected extends Error {
  constructor() {
    super("nothing sold yet");
    this.code = "notconnected";
  }
}

/* The store a business has before it names any: every account starts with
   one, and its receipts are filed under this id. */
export const REGISTER_BRANCH = { id: "register", name: "Register" };

/* How far back reports read: the sixty days a period is compared with, and a
   margin. */
export const REGISTER_WINDOW_DAYS = 62;

/* The receipts in reporting shape: the window a period is compared with, and
   the names of the stores they were sold in. */
export function registerOnlyRaw(register, now = Date.now(), names = {}, windowDays = REGISTER_WINDOW_DAYS) {
  const since = now - windowDays * DAY;
  const receipts = (register || []).filter((r) => new Date(r.receipt_date).getTime() >= since);
  const sold = receipts.map((r) => String(r.store_id || REGISTER_BRANCH.id));
  const branches = [...new Set([...Object.keys(names), ...sold])];
  if (!branches.length) branches.push(REGISTER_BRANCH.id);
  return {
    now,
    fetchedAt: now,
    since: new Date(since).toISOString(),
    receiptCount: receipts.length,
    registerCount: receipts.length,
    receipts,
    limitedHistory: false,
    historyDays: windowDays,
    catalogue: new Map(),
    storeNames: Object.fromEntries(branches.map((id) => [id, names[id] || (id === REGISTER_BRANCH.id ? REGISTER_BRANCH.name : id)])),
    allBranches: branches,
  };
}

/* What every report reads. A business that has sold nothing yet is told so
   (`NotConnected`) rather than shown a dashboard of zeros. */
function salesRaw(register, names, now = Date.now(), windowDays = REGISTER_WINDOW_DAYS) {
  if (!register?.length) throw new NotConnected();
  return registerOnlyRaw(register, now, names, windowDays);
}

/* A long period's days, grouped so a chart of a year is fifty-odd bars and
   not three hundred and sixty-five: by day up to a quarter, by week up to a
   little over a year, by month beyond. Each bucket keeps the date it starts
   on, and the sums are exact, so the bars add up to the period's total. */
export function bucketSeries(daily, timeZone = "Asia/Dubai") {
  const days = daily.length;
  const bucket = days <= 92 ? "day" : days <= 400 ? "week" : "month";
  if (bucket === "day") return { bucket, series: daily };
  const groups = [];
  for (const [i, d] of daily.entries()) {
    const key = bucket === "week" ? Math.floor(i / 7) : d.date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      const at = new Date(`${d.date}T12:00:00Z`);
      g = {
        key,
        date: d.date,
        label: bucket === "week"
          ? at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone })
          : at.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone }),
        sales: 0, receipts: 0, tax: 0,
      };
      groups.push(g);
    }
    g.sales += d.sales || 0;
    g.receipts += d.receipts || 0;
    g.tax += d.tax || 0;
  }
  return {
    bucket,
    series: groups.map(({ key, ...g }) => ({ ...g, sales: Math.round(g.sales * 100) / 100, tax: Math.round(g.tax * 100) / 100 })),
  };
}

/* Receipts as the register wrote them, with no corrections applied.

   The sale list shows what was rung up beside what it was changed to, so it
   must not be handed something already corrected. */
export async function rawReceipts({ days = 7, register = null, now = Date.now() } = {}) {
  const since = now - days * DAY;
  return (register || []).filter((r) => new Date(r.receipt_date).getTime() >= since);
}

export async function getMetrics({ overrides = {}, branches = null, edits = {}, register = null, names = {}, costs = null, timeZone, period = null, now = Date.now() } = {}) {
  /* The usual figures are the last 30 days. `period` asks for a longer one as
     well — `{ key, days }` — read over twice its length so it has a period
     before it to compare with. */
  const windowDays = period?.days ? Math.max(REGISTER_WINDOW_DAYS, period.days * 2 + 2) : REGISTER_WINDOW_DAYS;
  const raw = salesRaw(register, names, now, windowDays);

  /* `branches` is already authorized and intersected by the caller. null means
     the whole organization. */
  const scoped =
    branches === null ||
    (raw.allBranches.length > 0 && branches.length === raw.allBranches.length)
      ? null
      : branches;

  /* Corrections are applied to the receipts before anything is counted: a
     figure derived from an uncorrected receipt and adjusted afterwards can
     only ever be the headline total — the item, daily and hourly series would
     still carry the sale the owner said never happened. */
  const corrected = { ...raw, catalogue: costs || raw.catalogue, receipts: applyEdits(raw.receipts, edits) };

  const shaped = finish(aggregate(corrected, { overrides, branches: scoped, timeZone }));

  let longer = null;
  if (period?.days > 30) {
    const long = aggregate(corrected, { overrides, branches: scoped, timeZone, periodDays: period.days });
    const { bucket, series } = bucketSeries(long.daily, timeZone);
    longer = {
      key: period.key,
      days: period.days,
      from: long.daily[0]?.date || null,
      bucket,
      series,
      totals: {
        sales: long.totals.sales, receipts: long.totals.receipts, avgTicket: long.totals.avgTicket,
        tax: long.totals.tax, salesExVat: long.totals.salesExVat,
        salesDelta: long.totals.salesDelta, receiptsDelta: long.totals.receiptsDelta, avgTicketDelta: long.totals.avgTicketDelta,
      },
    };
  }
  return {
    ...shaped,
    connected: true,
    source: "PureMargin",
    period: longer,
    allBranches: raw.allBranches,
    /* Provenance inputs, passed through rather than recomputed downstream so
       there is exactly one account of where a figure came from. */
    fetch: {
      at: raw.fetchedAt,
      since: raw.since,
      receiptCount: raw.receiptCount,
      limitedHistory: false,
      historyDays: raw.historyDays,
      wentUpstream: false,
      branchNames: raw.storeNames,
      editCount: Object.keys(edits || {}).length,
      registerCount: raw.registerCount || 0,
      overrideCount: Object.keys(overrides).length,
    },
  };
}

/* One receipt's lines in the shape the variance engine reads. */
function linesOf(r) {
  return {
    branchId: String(r.store_id || REGISTER_BRANCH.id),
    at: new Date(r.receipt_date).getTime(),
    lines: (r.line_items || []).map((li) => ({
      name: li.item_name || "",
      variant: li.variant_name || "",
      scale: Number(li.variant_scale) > 0 ? Number(li.variant_scale) : 1,
      qty: Number(li.quantity) || 0,
      revenue: Number(li.total_money) || 0,
    })),
  };
}

/* Sold quantities per menu item, scoped and dated — the sales half of
   theoretical consumption. Refunds are excluded (a refunded sale consumed no
   ingredients, see `_aggregate.js` on why the food still counts as cost) and
   owner corrections applied (a voided sale consumed nothing either). */
export async function salesLines({ from, to = Date.now(), branches = null, edits = {}, register = null, names = {} } = {}) {
  const raw = registerOnlyRaw(register, to, names);
  const allowed = branches === null ? null : new Set(branches.map(String));
  const rows = new Map();

  for (const r of applyEdits(raw.receipts, edits)) {
    if (r.receipt_type === "REFUND" || r.cancelled_at) continue;
    const receipt = linesOf(r);
    if (allowed && !allowed.has(receipt.branchId)) continue;
    if (from && receipt.at < from) continue;
    if (to && receipt.at > to) continue;
    for (const li of receipt.lines) {
      const name = li.name || "Unnamed item";
      const mapKey = `${receipt.branchId}||${name}||${li.variant}`;
      const row = rows.get(mapKey) || { branchId: receipt.branchId, name, variant: li.variant, qty: 0, drawQty: 0, revenue: 0, lines: 0 };
      row.qty += li.qty;
      /* Portions of the plain recipe, for a variant drawn at a scale. */
      row.drawQty += li.qty * li.scale;
      row.revenue += li.revenue;
      row.lines += 1;
      rows.set(mapKey, row);
    }
  }

  return {
    lines: [...rows.values()],
    fetch: { at: raw.fetchedAt, since: raw.since, receiptCount: raw.receiptCount, limitedHistory: false, historyDays: raw.historyDays },
  };
}

/* A compact text version of the same numbers, for the model to reason over. */
export function toContext(m) {
  const money = (n) => `${m.currency} ${Math.round(n).toLocaleString("en-AE")}`;
  /* No earlier sales means no comparison, and the model must not be handed a
     number to quote as one. */
  const change = (d) => (d === null || d === undefined ? "no earlier sales to compare with" : `${d >= 0 ? "+" : ""}${d}% vs the 30 days before`);
  const busiest = [...m.hours].sort((a, b) => b.receipts - a.receipts).slice(0, 3);
  const quietest = [...m.hours].filter((h) => h.receipts > 0).sort((a, b) => a.receipts - b.receipts).slice(0, 3);

  return `SOURCE: ${m.source}${m.connected ? "" : " — tell the user these are sample figures if they ask about accuracy"}
PERIOD: last 30 days, compared with the 30 days before.

Total sales ${money(m.totals.sales)} (${change(m.totals.salesDelta)}).
Of that, VAT collected ${money(m.totals.tax || 0)}; sales without VAT ${money(m.totals.salesExVat ?? m.totals.sales)} — profit is worked on this.
Cost of goods ${money(m.totals.cost || 0)}. GROSS PROFIT ${money(m.totals.grossProfit || 0)}, a gross margin of ${m.totals.marginPct ?? 0}% (${m.totals.costedMarginPct ?? "unknown"}% on the dishes whose cost is known).
Discounts given ${money(m.totals.discounts || 0)}.
Cost data covers ${m.costCoverage ?? 0}% of turnover.
Orders ${m.totals.receipts.toLocaleString()} (${change(m.totals.receiptsDelta)}).
Average ticket ${money(m.totals.avgTicket)} (${change(m.totals.avgTicketDelta)}).

BRANCHES: ${m.stores.map((s) => `${s.name} — ${money(s.sales)}, ${s.receipts} orders`).join("; ")}.

TOP ITEMS: ${m.items.map((i) => `${i.name} (${i.category}) — ${Math.round(i.qty)} sold, ${money(i.revenue)}, ${i.share}% of top-item revenue`).join("; ")}.

BUSIEST HOURS: ${busiest.map((h) => `${h.label} (${h.receipts} orders)`).join(", ")}.
QUIETEST HOURS: ${quietest.map((h) => `${h.label} (${h.receipts} orders)`).join(", ")}.

DAILY SALES: ${m.daily.map((d) => `${d.label}: ${Math.round(d.sales)}`).join(", ")}.

FORECAST (next 30 days): cautious ${money(m.forecast.conservative)}, likely ${money(m.forecast.base)}, good ${money(m.forecast.optimistic)}.

PROFIT BY ITEM: ${(m.items || []).filter((i) => i.hasCost).map((i) => `${i.name} — ${money(i.profit)} profit at ${i.marginPct}% margin`).join("; ") || "none priced yet"}.

${
  (m.missingCosts || []).length
    ? `COSTS MISSING for ${m.missingCosts.length} items: ${m.missingCosts.map((i) => `${i.name} (sells at ${money(i.unitPrice)})`).join("; ")}.
These are excluded from net profit, so the margin above is understated. When the user asks about profit, margin, or these items, say plainly that the cost is missing and ask them for the approximate cost of the specific item — one item at a time, the highest-selling one first. Tell them they can enter it on the Menu screen, where every missing cost is listed. Never guess a cost.`
    : "All sold items have a cost, so net profit is complete."
}

The figure above is GROSS profit — revenue minus cost of goods, before any
overhead. It is not net profit and must never be called that. Rent, salaries
and other overheads are recorded separately, in the OPEX domain; for net profit
call the calculate_net_profit tool, which subtracts them on the server.

NOT AVAILABLE here: staff and labour cost broken down per person. Customer-level history.`;
}
