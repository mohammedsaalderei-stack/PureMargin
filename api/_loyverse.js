/* Loyverse, as a till a business may connect beside its own.

   PureMargin has a register, and a business that sells on it needs nothing
   else. One that already rings its sales up on Loyverse can connect that
   instead of — or as well as — moving: its receipts are read from Loyverse's
   API and joined to the register's, so every report sees one set of sales.

   Everything that is true of Loyverse and not of tills in general is in this
   file: the address, how a token is presented, how pages are walked, what the
   fields are called, and the 31 days of history a plan without the add-on is
   allowed. What leaves it is a receipt in the register's own shape
   (`toReceipt`), so nothing downstream knows there were two tills.

   ── What a Loyverse line's money means ────────────────────────────────────

   The register keeps a line's total with included VAT inside it and added
   VAT outside it, and `_aggregate.js` works profit out on that footing.
   Loyverse's `total_money` on a line is after *all* of the line's taxes, the
   added ones too. Carried across as it stands, a business that adds VAT at
   the till would have it counted as turnover on every dish. So added taxes
   come off the line here, and the included ones are stated as the rate the
   receipt works out to, which is how the register states its own.

   ── Reading without hammering ─────────────────────────────────────────────

   A dashboard asks every thirty seconds and Loyverse limits how often it may
   be asked. So: what was read is kept for 45 seconds; after that only what
   changed since is asked for (`updated_at_min`), which is one small request;
   and the whole window is walked again every quarter of an hour, in case
   anything was missed. A read that fails leaves the last good one in place
   and says so, because a morning's sales vanishing from the dashboard for one
   dropped request reads as a disaster and is not one.

   The cache is this process's own. Nothing from Loyverse is written to the
   store: the receipts are Loyverse's records and stay there. */

import crypto from "node:crypto";

const DAY = 864e5;
const CACHE_MS = 45 * 1000;
const FULL_MS = 15 * 60 * 1000;
const STALE_OK_MS = 6 * 60 * 60 * 1000;
const OVERLAP_MS = 2 * 60 * 1000;
/* After a read fails, Loyverse is not asked again for this long. Every screen
   and every thirty-second poll would otherwise repeat the failed request, which
   against a rate limit is how a short refusal becomes a long one. */
const RETRY_MS = 30 * 1000;

/* A plan without Unlimited Sales History answers 402 for anything older
   than 31 days. A day inside that, so a request made at the edge is not
   refused for a few seconds' difference between two clocks. */
export const LIMITED_DAYS = 30;
export const MAX_DAYS = 366;

/* 250 receipts a page. The walk stops at this many pages or this long,
   whichever comes first, and says that it stopped: a history cut short and
   presented as whole is worse than one that knows it is short. Loyverse lists
   newest first, so what is cut is the oldest. */
const PAGE = 250;
const MAX_PAGES = 40;
const INCREMENT_PAGES = 8;
const BUDGET_MS = 20 * 1000;
const CALL_MS = 12 * 1000;

export const PROVIDER = "Loyverse";
const base = () => String(process.env.LOYVERSE_API_BASE || "https://api.loyverse.com/v1.0").replace(/\/+$/, "");

/* Why a read failed, as a word the screens can translate:
   token       Loyverse rejected the access token
   permission  the token may not read this
   plan        the history asked for is beyond what the plan allows
   ratelimit   asked too often
   unreachable no answer at all
   upstream    anything else Loyverse said */
export class LoyverseError extends Error {
  constructor(code, { status = 0, detail = "" } = {}) {
    super(detail || code);
    this.code = code;
    this.status = status;
    this.detail = String(detail || "").slice(0, 200);
  }
}

const CODES = { 401: "token", 402: "plan", 403: "permission", 429: "ratelimit" };

const detailOf = (body) => {
  try {
    const parsed = JSON.parse(body);
    const first = Array.isArray(parsed?.errors) ? parsed.errors[0] : null;
    return String(first?.details || first?.code || parsed.details || parsed.message || parsed.error || "");
  } catch {
    return String(body || "").slice(0, 160);
  }
};

async function call(path, token, fetchImpl) {
  const ask = fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await ask(`${base()}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CALL_MS),
    });
  } catch (err) {
    throw new LoyverseError("unreachable", { detail: String(err?.message || err) });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LoyverseError(CODES[res.status] || "upstream", { status: res.status, detail: detailOf(body) });
  }
  try {
    return await res.json();
  } catch {
    throw new LoyverseError("upstream", { status: res.status, detail: "not JSON" });
  }
}

/* ── One receipt, in the register's shape ───────────────────────────────── */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round(n * 100) / 100;

export function toReceipt(raw) {
  const number = String(raw?.receipt_number || raw?.id || "").slice(0, 80);
  const at = new Date(raw?.receipt_date || raw?.created_at || "").getTime();
  if (!number || !Number.isFinite(at)) return null;

  let lines = 0;
  let included = 0;
  const line_items = (Array.isArray(raw.line_items) ? raw.line_items : []).map((li) => {
    const taxes = Array.isArray(li?.line_taxes) ? li.line_taxes : [];
    const of = (type) => taxes.filter((t) => t?.type === type).reduce((s, t) => s + num(t.money_amount), 0);
    const qty = num(li?.quantity);
    const total = round2(num(li?.total_money) - of("ADDED"));
    lines += total;
    included += of("INCLUDED");
    /* What Loyverse was told the item costs. Kept apart from `cost`, which is
       the register's word for a product's cost and outranks a recipe; this
       one is consulted only when PureMargin has no recipe for the dish. */
    const cost = num(li?.cost_total) || num(li?.cost) * qty;
    return {
      item_id: String(li?.item_id || ""),
      variant_id: String(li?.variant_id || ""),
      item_name: String(li?.item_name || ""),
      variant_name: li?.variant_name ? String(li.variant_name) : "",
      quantity: qty,
      price: num(li?.price),
      total_money: total,
      total_discount: num(li?.total_discount),
      ...(cost > 0 ? { pos_cost: round2(cost) } : {}),
    };
  });

  const pct = included > 0 && lines > included ? Math.round((included / (lines - included)) * 1e6) / 1e4 : 0;
  return {
    /* Loyverse's own number, unchanged: owner corrections and the stock
       already taken for a sale are both filed under it. */
    id: number,
    receipt_number: number,
    receipt_type: raw.receipt_type === "REFUND" ? "REFUND" : "SALE",
    refund_for: raw.refund_for ? String(raw.refund_for) : null,
    source: "loyverse",
    receipt_date: new Date(at).toISOString(),
    cancelled_at: raw.cancelled_at || null,
    store_id: String(raw.store_id || "unknown"),
    total_money: num(raw.total_money),
    total_tax: num(raw.total_tax),
    total_discount: num(raw.total_discount),
    vat_mode: pct > 0 ? "inclusive" : "added",
    vat_pct: pct,
    dining_option: raw.dining_option ? String(raw.dining_option).slice(0, 40) : null,
    payments: (Array.isArray(raw.payments) ? raw.payments : []).map((p) => ({
      name: String(p?.name || p?.type || "Other").slice(0, 40),
      type: String(p?.type || "").slice(0, 20),
      money_amount: num(p?.money_amount),
    })),
    line_items,
  };
}

const storeOf = (s) => ({ id: String(s?.id || ""), name: String(s?.name || "").trim().slice(0, 60) });

/* ── Walking the pages ──────────────────────────────────────────────────── */

async function walk(token, query, { pages, fetchImpl, deadline }) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < pages; page += 1) {
    const qs = new URLSearchParams({ ...query, limit: String(PAGE) });
    if (cursor) qs.set("cursor", cursor);
    const data = await call(`/receipts?${qs}`, token, fetchImpl);
    rows.push(...(Array.isArray(data?.receipts) ? data.receipts : []));
    cursor = data?.cursor || null;
    if (!cursor) return { rows, truncated: false };
    if (Date.now() > deadline) break;
  }
  return { rows, truncated: true };
}

async function storesOf(token, fetchImpl) {
  const data = await call("/stores", token, fetchImpl);
  return (Array.isArray(data?.stores) ? data.stores : []).map(storeOf).filter((s) => s.id);
}

/* Is this a token Loyverse accepts, and which stores does it reach? Asked
   before a token is kept, so a mistyped one is refused at the form and not
   discovered as an empty dashboard. */
export async function checkToken(token, { fetchImpl } = {}) {
  return { stores: await storesOf(String(token || "").trim(), fetchImpl) };
}

/* ── The cache ──────────────────────────────────────────────────────────── */

const keyOf = (token) => crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 32);
const cache = new Map();
const limitedUntil = new Map();
const noIncrement = new Set();
const inflight = new Map();
const failed = new Map();

export function clearLoyverseCache(token = null) {
  if (token) {
    const k = keyOf(token);
    cache.delete(k); limitedUntil.delete(k); noIncrement.delete(k); failed.delete(k);
    return;
  }
  cache.clear(); limitedUntil.clear(); noIncrement.clear(); failed.clear();
}

/* For tests: make everything remembered look `ms` older than it is. A
   function and not a clock passed in from outside, for the reason
   `__forceMemory` is one — nothing in production can call it by accident of
   configuration. */
export function __age(ms) {
  for (const e of cache.values()) { e.at -= ms; e.fullAt -= ms; e.syncedAt -= ms; }
  for (const [k, until] of limitedUntil) limitedUntil.set(k, until - ms);
  for (const f of failed.values()) f.at -= ms;
}

async function readAll(token, days, now, fetchImpl) {
  const k = keyOf(token);
  const started = Date.now();
  let limited = (limitedUntil.get(k) || 0) > now;
  let window = limited ? Math.min(days, LIMITED_DAYS) : days;
  const attempt = async (d) => {
    const since = now - d * DAY;
    const [stores, got] = await Promise.all([
      storesOf(token, fetchImpl),
      walk(token, { created_at_min: new Date(since).toISOString() }, { pages: MAX_PAGES, fetchImpl, deadline: started + BUDGET_MS }),
    ]);
    return { since, stores, ...got };
  };
  let out;
  try {
    out = await attempt(window);
  } catch (err) {
    /* The plan talking, not a fault: read what it does allow, and remember
       for a while so the refusal is not asked for on every read. */
    if (!(err instanceof LoyverseError) || err.code !== "plan" || window <= LIMITED_DAYS) throw err;
    limitedUntil.set(k, now + STALE_OK_MS);
    limited = true;
    window = LIMITED_DAYS;
    out = await attempt(window);
  }
  const byId = new Map();
  for (const raw of out.rows) { const r = toReceipt(raw); if (r) byId.set(r.receipt_number, r); }
  const entry = {
    at: now, fullAt: now, syncedAt: started, asked: days, days: window, since: out.since,
    byId, stores: out.stores, limited, truncated: out.truncated,
  };
  cache.set(k, entry);
  entry.full = true;
  return entry;
}

/* Only what changed since the last read: new sales, and old ones refunded
   against or cancelled. */
async function readChanges(token, entry, now, fetchImpl) {
  const started = Date.now();
  const got = await walk(token, { updated_at_min: new Date(entry.syncedAt - OVERLAP_MS).toISOString() },
    { pages: INCREMENT_PAGES, fetchImpl, deadline: started + BUDGET_MS });
  for (const raw of got.rows) { const r = toReceipt(raw); if (r) entry.byId.set(r.receipt_number, r); }
  entry.since = Math.max(entry.since, now - entry.days * DAY);
  for (const [id, r] of entry.byId) if (new Date(r.receipt_date).getTime() < entry.since) entry.byId.delete(id);
  entry.at = now;
  entry.syncedAt = started;
  entry.full = false;
  /* More changed than one visit could carry: walk the whole window next time. */
  if (got.truncated) entry.fullAt = 0;
  return entry;
}

async function refresh(token, days, now, fetchImpl) {
  const k = keyOf(token);
  const entry = cache.get(k);
  const covers = entry && entry.asked >= days;
  if (covers && now - entry.at < CACHE_MS) return { entry, wentUpstream: false };
  if (covers && now - entry.fullAt < FULL_MS && !noIncrement.has(k)) {
    try {
      return { entry: await readChanges(token, entry, now, fetchImpl), wentUpstream: true };
    } catch (err) {
      /* A till that does not take the question is asked the long way from
         now on; any other failure is a failure. */
      if (!(err instanceof LoyverseError) || err.status !== 400) throw err;
      noIncrement.add(k);
    }
  }
  return { entry: await readAll(token, Math.max(days, covers ? entry.asked : 0), now, fetchImpl), wentUpstream: true };
}

/* The connected Loyverse account's sales over the last `days` (or "all": as
   far back as a year), oldest first, with the stores they were sold in.

   Throws `LoyverseError` when Loyverse cannot be read and nothing is
   remembered. With something remembered, that is returned with `error` set
   and `fetchedAt` saying how old it is. */
export async function loyverseSales(token, { days = 62, now = Date.now(), fetchImpl } = {}) {
  const k = keyOf(token);
  const wanted = days === "all" ? MAX_DAYS : Math.min(MAX_DAYS, Math.max(1, Math.ceil(Number(days) || 1)));

  /* What to hand back when Loyverse cannot be read: what was read before, if
     it is recent enough and the connection itself has not been refused;
     otherwise the failure. */
  const fallBack = (failure, { wentUpstream }) => {
    const kept = cache.get(k);
    const refused = failure.code === "token" || failure.code === "permission";
    if (refused) cache.delete(k);
    if (!kept || refused || now - kept.at > STALE_OK_MS) throw failure;
    return shape(kept, wanted, now, { wentUpstream, error: { code: failure.code, detail: failure.detail } });
  };
  const recentFailure = () => {
    const f = failed.get(k);
    return f && now - f.at < RETRY_MS ? f.error : null;
  };

  let earlier = recentFailure();
  if (earlier) return fallBack(Object.assign(earlier, { remembered: true }), { wentUpstream: false });

  /* Two screens opening at once share one walk. */
  const running = inflight.get(k);
  if (running && running.days >= wanted) {
    await running.promise.catch(() => {});
    earlier = recentFailure();
    if (earlier) return fallBack(Object.assign(earlier, { remembered: true }), { wentUpstream: false });
  }

  let got;
  const promise = refresh(token, wanted, now, fetchImpl);
  inflight.set(k, { days: wanted, promise });
  try {
    got = await promise;
  } catch (err) {
    const failure = err instanceof LoyverseError ? err : new LoyverseError("upstream", { detail: String(err?.message || err) });
    failure.remembered = false;
    failed.set(k, { at: now, error: failure });
    return fallBack(failure, { wentUpstream: true });
  } finally {
    if (inflight.get(k)?.promise === promise) inflight.delete(k);
  }
  failed.delete(k);
  return shape(got.entry, wanted, now, { wentUpstream: got.wentUpstream, error: null });
}

function shape(entry, wanted, now, { wentUpstream, error }) {
  const from = Math.max(entry.since, now - wanted * DAY);
  const receipts = [...entry.byId.values()]
    .filter((r) => new Date(r.receipt_date).getTime() >= from)
    .sort((a, b) => new Date(a.receipt_date) - new Date(b.receipt_date));
  return {
    receipts,
    stores: entry.stores,
    fetchedAt: entry.at,
    since: entry.since,
    historyDays: entry.days,
    limitedHistory: entry.limited,
    truncated: entry.truncated,
    wentUpstream,
    /* The whole window was walked on this read, rather than only what
       changed: the reads worth a line in the sync log. */
    full: Boolean(wentUpstream && !error && entry.full),
    error,
  };
}
