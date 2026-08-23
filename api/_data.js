// Pulls sales from Loyverse and shapes them into the metrics the UI needs.
// With no LOYVERSE_ACCESS_TOKEN set, returns realistic sample data instead,
// so the app is fully usable before the POS is connected.

import { buildAdvice } from "./_advice.js";
import { marginLayer } from "./_margin.js";

const BASE = "https://api.loyverse.com/v1.0";
/* Short, because the dashboard polls and people expect today's number to
   move. Loyverse rate-limits, so this still shields the API from a room
   full of tablets all refreshing at once — the cache is keyed by token, so
   every device on one account shares a single upstream call. */
const CACHE_MS = 45 * 1000;
/* Keyed by token so two businesses on one deployment never see each
   other's figures out of a shared cache. */
const cache = new Map();

export function clearCache() {
  cache.clear();
}

const DAY = 864e5;
const hourLabel = (h) => {
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${suffix}`;
};
const pctChange = (now, before) =>
  before > 0 ? Number((((now - before) / before) * 100).toFixed(1)) : 0;

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
/*  Live Loyverse                                                     */
/* ---------------------------------------------------------------- */
async function call(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    /* Loyverse explains itself in the body; a bare status code sends people
       hunting for a problem the response already named. */
    const body = await res.text().catch(() => "");
    let detail = "";
    try {
      const parsed = JSON.parse(body);
      detail = parsed.details || parsed.message || parsed.error || "";
    } catch {
      detail = body.slice(0, 160);
    }
    const label =
      res.status === 402 ? "Loyverse only returns the last 31 days of receipts on this plan (Unlimited Sales History is not enabled)" :
      res.status === 401 ? "The access token was rejected" :
      res.status === 403 ? "That token doesn't have permission to read this" :
      res.status === 429 ? "Loyverse is rate-limiting the connection" :
      `Loyverse returned ${res.status}`;
    throw new Error(detail ? `${label}: ${detail}` : label);
  }
  return res.json();
}

async function allReceipts(token, sinceIso) {
  const out = [];
  let cursor = null;

  // Loyverse paginates; cap the walk so a huge account can't hang the request.
  for (let page = 0; page < 12; page++) {
    const qs = new URLSearchParams({ created_at_min: sinceIso, limit: "250" });
    if (cursor) qs.set("cursor", cursor);
    const data = await call(`/receipts?${qs}`, token);
    out.push(...(data.receipts || []));
    cursor = data.cursor;
    if (!cursor) break;
  }
  return out;
}

/* Loyverse caps receipt history at 31 days unless the account has the
   Unlimited Sales History add-on; asking for more returns 402 rather than a
   short list. So: ask for 60 days to make month-on-month comparison
   possible, and quietly narrow to 30 if the plan won't allow it. The
   narrowed case is flagged, because it means there's no prior period to
   compare against and the interface must not imply otherwise. */
async function fetchReceipts(token, now) {
  const wide = new Date(now - 60 * DAY).toISOString();
  try {
    return { receipts: await allReceipts(token, wide), limitedHistory: false };
  } catch (err) {
    if (!/\b402\b|PAYMENT_REQUIRED|31 days/i.test(err.message)) throw err;
    const narrow = new Date(now - 30 * DAY).toISOString();
    return { receipts: await allReceipts(token, narrow), limitedHistory: true };
  }
}

/* The catalogue: cost and photo per item.

   Receipts don't carry cost, so net profit is impossible from receipts
   alone — this is why the app could only ever show turnover. The items
   endpoint has `cost` on each variant, so we read it once and join it to
   the line items by name.

   Loyverse paginates items too, and an item can have several variants at
   different costs; we key on both the item name and the variant name so a
   large latte and a small one aren't averaged together. */
async function fetchCatalogue(token) {
  const byName = new Map();
  let cursor = null;

  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ limit: "250" });
    if (cursor) qs.set("cursor", cursor);
    const data = await call(`/items?${qs}`, token);

    for (const item of data.items || []) {
      const image = item.image_url || null;
      for (const variant of item.variants || [{}]) {
        const cost = Number(variant.cost) || 0;
        const key = variant.variant_name
          ? `${item.item_name}||${variant.variant_name}`
          : item.item_name;
        byName.set(key, { cost, image, category: item.category_id || null });
      }
      // Fallback entry so a line item without a variant name still resolves.
      if (!byName.has(item.item_name)) {
        const first = (item.variants || [])[0] || {};
        byName.set(item.item_name, { cost: Number(first.cost) || 0, image, category: null });
      }
    }

    cursor = data.cursor;
    if (!cursor) break;
  }

  return byName;
}

async function liveMetrics(token, overrides = {}) {
  const now = Date.now();

  const [storesRes, history, catalogue] = await Promise.all([
    call("/stores", token),
    fetchReceipts(token, now),
    // A catalogue failure shouldn't take the dashboard down; it just means
    // no cost data, and the interface says so.
    fetchCatalogue(token).catch((err) => {
      console.error("Couldn't read the catalogue:", err.message);
      return new Map();
    }),
  ]);
  const { receipts, limitedHistory } = history;

  /* An owner-entered cost always wins over the POS value — they know what
     they actually pay, and Loyverse costs are often left at zero. */
  const costFor = (itemName, variantName) => {
    const override = overrides[itemName];
    if (typeof override === "number" && override > 0) return override;
    const keyed = variantName ? catalogue.get(`${itemName}||${variantName}`) : null;
    return keyed?.cost || catalogue.get(itemName)?.cost || 0;
  };
  const imageFor = (itemName) => catalogue.get(itemName)?.image || null;

  const storeNames = Object.fromEntries((storesRes.stores || []).map((s) => [s.id, s.name]));
  const cutoff = now - 30 * DAY;

  const byDay = new Map();
  const byHour = new Map();
  const byStore = new Map();
  const byItem = new Map();
  const byPayment = new Map();
  let currentSales = 0, currentReceipts = 0, priorSales = 0, priorReceipts = 0;
  let totalCost = 0;
  let totalDiscounts = 0;

  for (const r of receipts) {
    if (r.receipt_type === "REFUND" || r.cancelled_at) continue;
    const ts = new Date(r.receipt_date).getTime();
    const value = Number(r.total_money) || 0;

    if (ts < cutoff) {
      priorSales += value;
      priorReceipts += 1;
      continue;
    }

    currentSales += value;
    currentReceipts += 1;

    const d = new Date(ts);
    const key = d.toISOString().slice(0, 10);
    const day = byDay.get(key) || { sales: 0, receipts: 0 };
    day.sales += value;
    day.receipts += 1;
    byDay.set(key, day);

    const h = d.getHours();
    byHour.set(h, (byHour.get(h) || 0) + 1);

    for (const pay of r.payments || []) {
      const method = pay.name || pay.type || "Other";
      byPayment.set(method, (byPayment.get(method) || 0) + (Number(pay.money_amount) || 0));
    }

    const sid = r.store_id || "unknown";
    const st = byStore.get(sid) || { sales: 0, receipts: 0 };
    st.sales += value;
    st.receipts += 1;
    byStore.set(sid, st);

    for (const li of r.line_items || []) {
      const name = li.item_name || "Unnamed item";
      const qty = Number(li.quantity) || 0;
      const revenue = Number(li.total_money) || 0;
      const unitCost = costFor(name, li.variant_name);

      const it = byItem.get(name) || {
        qty: 0,
        revenue: 0,
        cost: 0,
        unitCost,
        image: imageFor(name),
        category: li.variant_name || "—",
        hasCost: unitCost > 0,
      };
      it.qty += qty;
      it.revenue += revenue;
      it.cost += unitCost * qty;
      it.unitCost = unitCost || it.unitCost;
      it.hasCost = it.hasCost || unitCost > 0;
      byItem.set(name, it);

      totalCost += unitCost * qty;
    }
  }

  const daily = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    const key = d.toISOString().slice(0, 10);
    const row = byDay.get(key) || { sales: 0, receipts: 0 };
    daily.push({
      date: key,
      label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      sales: Math.round(row.sales),
      receipts: row.receipts,
    });
  }

  const hours = [];
  for (let h = 0; h < 24; h++) {
    const count = byHour.get(h) || 0;
    if (count > 0 || (h >= 8 && h <= 23)) {
      hours.push({ hour: h, label: hourLabel(h), receipts: count });
    }
  }

  const netProfit = currentSales - totalCost;
  const marginPct = currentSales > 0 ? (netProfit / currentSales) * 100 : 0;

  const itemsRaw = [...byItem.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 14);
  const itemTotal = itemsRaw.reduce((s, i) => s + i.revenue, 0) || 1;

  const paymentTotal = [...byPayment.values()].reduce((a, b) => a + b, 0) || 1;
  const todayKey = new Date(now).toISOString().slice(0, 10);
  const todayRow = byDay.get(todayKey) || { sales: 0, receipts: 0 };
  const ydayKey = new Date(now - DAY).toISOString().slice(0, 10);
  const ydayRow = byDay.get(ydayKey) || { sales: 0, receipts: 0 };

  return finish({
    connected: true,
    source: "Loyverse POS",
    payments: [...byPayment.entries()]
      .map(([method, amount]) => ({
        method,
        amount: Math.round(amount),
        share: Number(((amount / paymentTotal) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.amount - a.amount),
    today: {
      sales: Math.round(todayRow.sales),
      receipts: todayRow.receipts,
      avgTicket: todayRow.sales / Math.max(todayRow.receipts, 1),
      delta: pctChange(todayRow.sales, ydayRow.sales),
      topItem: itemsRaw[0]?.name || "—",
      topItemQty: Math.round(itemsRaw[0]?.qty || 0),
    },
    extras: { discounts: 0, refunds: 0, cost: 0 },
    currency: (receipts[0] && receipts[0].currency) || "AED",
    daily,
    hours,
    stores: [...byStore.entries()]
      .map(([id, v]) => ({
        id,
        name: storeNames[id] || "Unnamed branch",
        sales: Math.round(v.sales),
        receipts: v.receipts,
      }))
      .sort((a, b) => b.sales - a.sales),
    items: itemsRaw.map((i) => {
      const profit = i.revenue - i.cost;
      return {
        ...i,
        revenue: Math.round(i.revenue),
        cost: Math.round(i.cost),
        profit: Math.round(profit),
        marginPct: i.revenue > 0 ? Number(((profit / i.revenue) * 100).toFixed(1)) : 0,
        share: Math.round((i.revenue / itemTotal) * 100),
      };
    }),
    limitedHistory,
    /* Cost coverage matters more than it looks: a 100% margin almost always
       means costs are missing, not that everything is free. The interface
       uses this to say which it is. */
    costCoverage: (() => {
      const withCost = [...byItem.values()].filter((i) => i.hasCost);
      const revenueWithCost = withCost.reduce((sum, i) => sum + i.revenue, 0);
      return currentSales > 0 ? Math.round((revenueWithCost / currentSales) * 100) : 0;
    })(),
    missingCosts: [...byItem.entries()]
      .filter(([, i]) => !i.hasCost && i.qty > 0)
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 12)
      .map(([name, i]) => ({
        name,
        qty: Math.round(i.qty),
        revenue: Math.round(i.revenue),
        unitPrice: Math.round(i.revenue / Math.max(i.qty, 1)),
        image: i.image,
      })),
    totals: {
      sales: Math.round(currentSales),
      receipts: currentReceipts,
      avgTicket: currentSales / Math.max(currentReceipts, 1),
      cost: Math.round(totalCost),
      netProfit: Math.round(netProfit),
      marginPct: Number(marginPct.toFixed(1)),
      discounts: Math.round(totalDiscounts),
      salesDelta: limitedHistory ? null : pctChange(currentSales, priorSales),
      receiptsDelta: limitedHistory ? null : pctChange(currentReceipts, priorReceipts),
      avgTicketDelta: limitedHistory
        ? null
        : pctChange(
            currentSales / Math.max(currentReceipts, 1),
            priorSales / Math.max(priorReceipts, 1)
          ),
    },
  });
}

/* Raised when a real account has no POS connected. The caller turns this
   into a "connect your POS" state rather than inventing numbers. */
export class NotConnected extends Error {
  constructor() {
    super("No POS connected");
    this.code = "notconnected";
  }
}

/* Raised when a POS *is* connected but couldn't be read. The reason is
   passed through, so the person can see whether the token was rejected,
   the permissions are wrong, or the service is simply down. */
export class PosUnreachable extends Error {
  constructor(detail) {
    super(detail);
    this.code = "pos";
    this.detail = detail;
  }
}

/* Live figures or an honest failure. There is no sample path: someone
   looking at this app should only ever be looking at their own service. */
/* The business's own name and currency, straight from the POS. Asking
   someone to type a name we can simply read is a needless question. */
export async function fetchMerchant(token) {
  try {
    const data = await call("/merchants", token);
    const merchant = Array.isArray(data?.merchants) ? data.merchants[0] : data;
    return {
      business: merchant?.business_name || merchant?.name || "",
      currency: merchant?.currency || "AED",
      email: merchant?.email || "",
    };
  } catch (err) {
    // Not fatal — the connection still works without the name.
    console.error("Couldn't read the merchant record:", err.message);
    return null;
  }
}

/* The organization's branches, straight from the POS.

   Permissions need the list of branches that exist before any figures are
   computed — assigning a branch manager to a branch shouldn't require pulling
   a month of receipts first. This is the cheap read for that. */
export async function branchList(posToken) {
  const token = posToken || process.env.LOYVERSE_ACCESS_TOKEN || "";
  if (!token) throw new NotConnected();
  const data = await call("/stores", token);
  return (data?.stores || []).map((s) => ({
    id: String(s.id),
    name: s.name || "Unnamed branch",
  }));
}

export async function getMetrics(posToken, { maxAge = CACHE_MS, overrides = {} } = {}) {
  const token = posToken || process.env.LOYVERSE_ACCESS_TOKEN || "";
  if (!token) throw new NotConnected();

  /* Overrides change the figures, so they belong in the cache key —
     otherwise entering a cost wouldn't show up until the cache expired. */
  const overrideStamp = Object.keys(overrides).length
    ? `:${Object.entries(overrides).sort().map(([k, v]) => `${k}=${v}`).join(",").length}:${JSON.stringify(overrides).length}`
    : "";
  const key = token.slice(0, 24) + overrideStamp;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < maxAge) return hit.value;

  let value;
  try {
    value = await liveMetrics(token, overrides);
  } catch (err) {
    console.error("Loyverse fetch failed:", err.message);
    throw new PosUnreachable(err.message);
  }

  cache.set(key, { at: Date.now(), value });
  return value;
}

/* Seconds since these figures were actually fetched, so the interface can
   say "updated 12 seconds ago" rather than implying they're instantaneous. */
export function cacheAge(posToken) {
  const token = posToken || process.env.LOYVERSE_ACCESS_TOKEN || "";
  const hit = cache.get(token.slice(0, 24));
  return hit ? Math.round((Date.now() - hit.at) / 1000) : null;
}

/* A compact text version of the same numbers, for the model to reason over. */
export function toContext(m) {
  const money = (n) => `${m.currency} ${Math.round(n).toLocaleString("en-AE")}`;
  const busiest = [...m.hours].sort((a, b) => b.receipts - a.receipts).slice(0, 3);
  const quietest = [...m.hours].filter((h) => h.receipts > 0).sort((a, b) => a.receipts - b.receipts).slice(0, 3);

  return `SOURCE: ${m.source}${m.connected ? "" : " — tell the user these are sample figures if they ask about accuracy"}
PERIOD: last 30 days, compared with the 30 days before.

Total sales ${money(m.totals.sales)} (${m.totals.salesDelta >= 0 ? "+" : ""}${m.totals.salesDelta}%).
Cost of goods ${money(m.totals.cost || 0)}. NET PROFIT ${money(m.totals.netProfit || 0)}, a margin of ${m.totals.marginPct ?? 0}%.
Discounts given ${money(m.totals.discounts || 0)}.
Cost data covers ${m.costCoverage ?? 0}% of turnover.
Orders ${m.totals.receipts.toLocaleString()} (${m.totals.receiptsDelta >= 0 ? "+" : ""}${m.totals.receiptsDelta}%).
Average ticket ${money(m.totals.avgTicket)} (${m.totals.avgTicketDelta >= 0 ? "+" : ""}${m.totals.avgTicketDelta}%).

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

NOT AVAILABLE: staff and labour cost, rent and overheads — "net profit" here means after cost of goods only. Customer-level history.`;
}
