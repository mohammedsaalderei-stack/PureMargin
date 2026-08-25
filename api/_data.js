// Pulls sales from the connected POS API and shapes them into the metrics
// the UI needs. Works with any Loyverse-compatible POS API; point POS_API_BASE
// at a different base URL to use another provider. With no token set, raises
// NotConnected so the interface prompts for a POS connection.

import { buildAdvice } from "./_advice.js";
import { marginLayer } from "./_margin.js";
import { aggregate } from "./_aggregate.js";

const BASE = process.env.POS_API_BASE || "https://api.loyverse.com/v1.0";
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
      res.status === 402 ? "The POS only returns the last 31 days of receipts on this plan" :
      res.status === 401 ? "The access token was rejected" :
      res.status === 403 ? "That token doesn't have permission to read this" :
      res.status === 429 ? "The POS API is rate-limiting the connection" :
      `The POS API returned ${res.status}`;
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

/* How far back this account is actually allowed to read.

   Loyverse caps receipt history at 31 days unless the account carries the
   Unlimited Sales History add-on; asking for more returns 402 rather than a
   short list. The previous version asked for 60 days and fell back to 30, so
   an account that had paid for unlimited history still only ever saw two
   months — the add-on bought nothing, and every screen kept saying "last 30
   days" because that was all there was.

   Now it finds the widest window the plan permits, cheaply. Each probe is a
   single-receipt request, so the ladder costs a handful of tiny calls rather
   than several full paginated walks, and only the window that wins is fetched
   in full.

   The ladder stops at a year. Beyond that the page cap below truncates the
   result anyway, and a silently truncated history is worse than a short one
   that knows it is short. */
const HISTORY_LADDER = [365, 180, 90, 60, 30];

/* Below this there is no prior period to compare against, and the interface
   must not imply otherwise. */
const COMPARISON_DAYS = 60;

async function probeWindow(token, sinceIso) {
  const qs = new URLSearchParams({ created_at_min: sinceIso, limit: "1" });
  await call(`/receipts?${qs}`, token);
}

function planRefused(err) {
  return /\b402\b|PAYMENT_REQUIRED|31 days/i.test(err?.message || "");
}

export async function widestHistoryDays(token, now = Date.now(), ladder = HISTORY_LADDER) {
  for (const days of ladder) {
    const since = new Date(now - days * DAY).toISOString();
    try {
      await probeWindow(token, since);
      return days;
    } catch (err) {
      if (!planRefused(err)) throw err;
    }
  }
  /* Every rung refused, which should not happen — 30 days is the floor the
     free plan allows. Take the floor rather than returning nothing. */
  return ladder[ladder.length - 1];
}

async function fetchReceipts(token, now) {
  const days = await widestHistoryDays(token, now);
  const since = new Date(now - days * DAY).toISOString();
  return {
    receipts: await allReceipts(token, since),
    limitedHistory: days < COMPARISON_DAYS,
    historyDays: days,
    since,
  };
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

/* The upstream read, with no aggregation in it.

   Kept separate from shaping so the expensive part (a month of receipts, the
   whole catalogue) happens once per token and is then re-aggregated cheaply for
   whatever branch scope each request has. */
async function fetchRaw(token) {
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

  return {
    now,
    /* What this read actually covered, kept with the data so the figures can
       always say where they came from rather than being asserted to be current. */
    fetchedAt: Date.now(),
    since: history.since,
    receiptCount: history.receipts.length,
    receipts: history.receipts,
    limitedHistory: history.limitedHistory,
    historyDays: history.historyDays,
    catalogue,
    storeNames: Object.fromEntries((storesRes.stores || []).map((s) => [s.id, s.name])),
    allBranches: (storesRes.stores || []).map((s) => String(s.id)),
  };
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
  const token = posToken || process.env.POS_ACCESS_TOKEN || process.env.LOYVERSE_ACCESS_TOKEN || "";
  /* No POS linked yet: there are no branches to report. Callers that only
     need the roster for scope resolution catch this and carry on with an
     empty list; the dashboard turns it into the connect-your-POS state. */
  if (!token) throw new NotConnected();

  /* The cached fetch already holds the roster, so a dashboard request that is
     about to aggregate anyway doesn't pay for a second /stores call — which
     matters because Loyverse rate-limits and this is now read on every metrics
     request to resolve the scope. */
  const hit = cache.get(token.slice(0, 24));
  if (hit) {
    return hit.raw.allBranches.map((id) => ({
      id,
      name: hit.raw.storeNames[id] || "Unnamed branch",
    }));
  }

  /* Wrapped like the metrics fetch is. This read moved ahead of `getMetrics`
     when scope resolution did, and an unwrapped failure here reached the
     endpoint as a generic 500 — which is precisely the "no sales" versus
     "couldn't ask" confusion the provenance work exists to remove. */
  let data;
  try {
    data = await call("/stores", token);
  } catch (err) {
    console.error("Loyverse branch list failed:", err.message);
    throw new PosUnreachable(err.message);
  }

  return (data?.stores || []).map((s) => ({
    id: String(s.id),
    name: s.name || "Unnamed branch",
  }));
}

export async function getMetrics(posToken, { maxAge = CACHE_MS, overrides = {}, branches = null } = {}) {
  const token = posToken || process.env.POS_ACCESS_TOKEN || process.env.LOYVERSE_ACCESS_TOKEN || "";
  /* No POS linked yet: refuse to invent figures. The interface turns this
     into the connect-your-POS state rather than presenting sample numbers as
     if they were the business's own. */
  if (!token) throw new NotConnected();

  /* The cache holds the raw upstream read, not the finished payload. Two
     requests with different branch scopes share one Loyverse call and are
     aggregated separately — which is the point of splitting the two, since the
     fetch is the expensive half and the scope changes per user. Overrides no
     longer belong in the key for the same reason: they're applied during
     aggregation, so entering a cost is reflected immediately without a
     refetch. */
  const key = token.slice(0, 24);
  const hit = cache.get(key);

  let raw = hit && Date.now() - hit.at < maxAge ? hit.raw : null;
  /* Whether this call went upstream. The sync log records real fetches only —
     the dashboard polls every thirty seconds and almost all of those are cache
     hits, which are not events worth logging. */
  let fetched = false;
  if (!raw) {
    try {
      raw = await fetchRaw(token);
    } catch (err) {
      console.error("Loyverse fetch failed:", err.message);
      throw new PosUnreachable(err.message);
    }
    fetched = true;
    cache.set(key, { at: Date.now(), raw });
  }

  /* `branches` is already authorized and intersected by the caller. null means
     the whole organization. */
  const scoped =
    branches === null ||
    (raw.allBranches.length > 0 && branches.length === raw.allBranches.length)
      ? null
      : branches;

  const shaped = finish(aggregate(raw, { overrides, branches: scoped }));
  return {
    ...shaped,
    allBranches: raw.allBranches,
    /* Provenance inputs, passed through rather than recomputed downstream so
       there is exactly one account of where a figure came from. */
    fetch: {
      at: raw.fetchedAt,
      since: raw.since,
      receiptCount: raw.receiptCount,
      limitedHistory: raw.limitedHistory,
      historyDays: raw.historyDays,
      wentUpstream: fetched,
      branchNames: raw.storeNames,
      // How many item costs came from the owner rather than the POS.
      overrideCount: Object.keys(overrides).length,
    },
  };
}

/* Sold quantities per menu item, scoped and dated — the sales half of
   theoretical consumption.

   The variance engine needs what was actually sold, per branch, inside a period.
   `aggregate` can't answer that: it keeps a thirty-day organization total, rounds
   money and drops all but the top items, which is right for a dashboard and
   useless for multiplying by a recipe. So this reads the same cached receipts and
   returns line-level quantities untouched.

   `branches` is the already-authorized, already-intersected list — a filter over
   receipts, exactly as in `aggregate`, and never a list straight from a request.
   Refunds and cancelled receipts are excluded: a refunded sale consumed no
   ingredients.

   The provenance of the read travels with it, because a variance figure resting
   on a stale or truncated sales history is a different claim from one that isn't. */
export async function salesLines(posToken, { from, to = Date.now(), branches = null, maxAge = CACHE_MS } = {}) {
  const token = posToken || process.env.POS_ACCESS_TOKEN || process.env.LOYVERSE_ACCESS_TOKEN || "";
  if (!token) throw new NotConnected();

  const key = token.slice(0, 24);
  const hit = cache.get(key);
  let raw = hit && Date.now() - hit.at < maxAge ? hit.raw : null;
  if (!raw) {
    try {
      raw = await fetchRaw(token);
    } catch (err) {
      console.error("Loyverse fetch failed:", err.message);
      throw new PosUnreachable(err.message);
    }
    cache.set(key, { at: Date.now(), raw });
  }

  const allowed = branches === null ? null : new Set(branches.map(String));
  const rows = new Map();

  for (const r of raw.receipts) {
    if (r.receipt_type === "REFUND" || r.cancelled_at) continue;
    const branchId = String(r.store_id || "unknown");
    if (allowed && !allowed.has(branchId)) continue;
    const at = new Date(r.receipt_date).getTime();
    if (from && at < from) continue;
    if (to && at > to) continue;

    for (const li of r.line_items || []) {
      const name = li.item_name || "Unnamed item";
      const variant = li.variant_name || "";
      const mapKey = `${branchId}||${name}||${variant}`;
      const row = rows.get(mapKey) || { branchId, name, variant, qty: 0, revenue: 0, lines: 0 };
      row.qty += Number(li.quantity) || 0;
      row.revenue += Number(li.total_money) || 0;
      row.lines += 1;
      rows.set(mapKey, row);
    }
  }

  return {
    lines: [...rows.values()],
    /* What the sales side of any variance below actually rests on. */
    fetch: {
      at: raw.fetchedAt,
      since: raw.since,
      receiptCount: raw.receiptCount,
      /* True when the POS wouldn't give us the whole window asked for, which
         understates theoretical usage and must never be silently absorbed. */
      limitedHistory: raw.limitedHistory,
      historyDays: raw.historyDays,
    },
  };
}

/* Seconds since these figures were actually fetched, so the interface can
   say "updated 12 seconds ago" rather than implying they're instantaneous. */
export function cacheAge(posToken) {
  const token = posToken || process.env.POS_ACCESS_TOKEN || process.env.LOYVERSE_ACCESS_TOKEN || "";
  if (!token) return null;
  const key = token.slice(0, 24);
  const hit = cache.get(key);
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
