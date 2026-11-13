/* Sales and delivery channels: where a business sells, and what each place
   takes for it.

   ── What is kept ─────────────────────────────────────────────────────────

     channels:<org>          the channels, each with its fee rules
     channels:<org>:prices   what each item is listed at on each channel

   ── Fee rules are dated and never rewritten ──────────────────────────────

   A commission is a term of a contract and contracts change. A rule is
   written with the day it starts and is never edited afterwards: a new rate
   is a new rule from a new day, and a mistake is corrected by a newer rule
   that outranks it (`ruleAt` in `shared/channelmath.js`). So the question
   "what did Talabat take in March" has one answer whenever it is asked.

   The order itself goes further and keeps a copy of the rule it was costed
   under (`channel_fee_rule` on the receipt, written by `api/till.js`), with
   the amounts it came to. A report reads those, so a fee changed today moves
   no figure from yesterday — not by recalculating carefully, but by not
   recalculating at all.

   ── Prices are history too ───────────────────────────────────────────────

   A channel price is appended, not replaced, for the same reason: "the fees
   changed after the prices were last set" is one of the things this module
   exists to notice, and it can only be noticed if both have dates. */

import { getJSON, setJSON } from "./_store.js";
import {
  CHANNEL_TYPES, CHANNEL_PRESETS, EMPTY_RULE, IN_STORE_ID, readRule, ruleAt, orderEconomics,
  itemEconomics, compareItem, priceFor, itemKeyOf,
} from "../shared/channelmath.js";

const KEY = (orgId) => `channels:${orgId}`;
const PRICES = (orgId) => `channels:${orgId}:prices`;
const text = (v, max) => String(v ?? "").trim().slice(0, max);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const slug = (s) => String(s).toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "channel";
const MAX_CHANNELS = 30;
const MAX_RULES = 200;
const MAX_PRICE = 100000;
const DAY = 864e5;
export const DEFAULT_MIN_MARGIN_PCT = 15;
export const STALE_FEE_DAYS = 90;

/* The calendar day a moment falls on, where the business is. */
export function dayIn(ts, timeZone = "Asia/Dubai") {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

function inStore(now) {
  return {
    id: IN_STORE_ID, name: "In-store", type: "in_store", preset: "in_store", branches: [], active: true,
    createdAt: now, updatedAt: now,
    /* No fees until somebody says there are some — a card machine's, say. */
    rules: [{ id: "r-0", branchId: null, validFrom: "2000-01-01", validTo: null, ...EMPTY_RULE, createdBy: "", createdAt: now }],
  };
}

async function readDoc(orgId, now = Date.now()) {
  const saved = orgId ? await getJSON(KEY(orgId)) : null;
  if (saved && Array.isArray(saved.list) && saved.list.length) {
    return { list: saved.list, settings: { minMarginPct: DEFAULT_MIN_MARGIN_PCT, ...(saved.settings || {}) } };
  }
  /* Every business sells at its own counter, so that channel always exists:
     it is the one every other is measured against. Not written until
     something else is, so reading costs nothing. */
  return { list: [inStore(now)], settings: { minMarginPct: DEFAULT_MIN_MARGIN_PCT } };
}

export async function listChannels(orgId, { now = Date.now() } = {}) {
  return (await readDoc(orgId, now)).list;
}

export async function channelSettings(orgId) {
  return (await readDoc(orgId)).settings;
}

export async function saveSettings(orgId, input = {}) {
  const doc = await readDoc(orgId);
  const pct = Number(input.minMarginPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 95) return { error: "minMarginPct" };
  const settings = { ...doc.settings, minMarginPct: Math.round(pct * 10) / 10 };
  await setJSON(KEY(orgId), { ...doc, settings });
  return { settings };
}

/* Add a channel, or change what it is called, where it runs and whether it
   is in use. Its fees are not changed here — those are rules, with dates. */
export async function saveChannel(orgId, input = {}, { now = Date.now() } = {}) {
  const doc = await readDoc(orgId, now);
  const existing = input.id ? doc.list.find((c) => c.id === String(input.id)) : null;
  if (input.id && !existing) return { error: "notfound" };
  const preset = CHANNEL_PRESETS.find((p) => p.key === input.preset) || null;
  const name = text(input.name, 40) || (existing ? existing.name : preset?.name || "");
  if (!name) return { error: "name" };
  const type = CHANNEL_TYPES.includes(input.type) ? input.type : existing?.type || preset?.type || "custom";
  if (!existing && doc.list.length >= MAX_CHANNELS) return { error: "toomany", limit: MAX_CHANNELS };
  const clash = doc.list.find((c) => c.id !== existing?.id && c.name.toLowerCase() === name.toLowerCase());
  if (clash) return { error: "duplicate" };

  let id = existing?.id;
  if (!id) {
    const used = new Set(doc.list.map((c) => c.id));
    id = `c-${slug(preset?.key || name)}`;
    for (let n = 2; used.has(id); n += 1) id = `c-${slug(preset?.key || name)}-${n}`;
  }
  const branches = Array.isArray(input.branches) ? [...new Set(input.branches.map(String))].slice(0, 50) : existing?.branches || [];
  const active = id === IN_STORE_ID ? true : input.active === undefined ? existing?.active ?? true : Boolean(input.active);
  const channel = {
    id, name, type: id === IN_STORE_ID ? "in_store" : type,
    preset: existing?.preset || preset?.key || null,
    branches, active,
    createdAt: existing?.createdAt || now, updatedAt: now,
    rules: existing?.rules || [],
  };
  const list = existing ? doc.list.map((c) => (c.id === id ? channel : c)) : [...doc.list, channel];
  await setJSON(KEY(orgId), { ...doc, list });
  return { channel, created: !existing };
}

/* A new fee rule. Appended; nothing already on file is touched. */
export async function addRule(orgId, channelId, input = {}, { by = "", now = Date.now(), timeZone } = {}) {
  const doc = await readDoc(orgId, now);
  const channel = doc.list.find((c) => c.id === String(channelId));
  if (!channel) return { error: "notfound" };
  const read = readRule(input);
  if (read.error) return { error: read.error };
  if ((channel.rules || []).length >= MAX_RULES) return { error: "toomany", limit: MAX_RULES };
  const branchId = input.branchId ? String(input.branchId) : null;
  const rule = {
    id: `r-${now.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    branchId,
    validFrom: input.validFrom || dayIn(now, timeZone),
    validTo: input.validTo || null,
    ...read.rule,
    createdBy: text(by, 60),
    createdAt: now,
  };
  const next = { ...channel, rules: [...(channel.rules || []), rule], updatedAt: now };
  await setJSON(KEY(orgId), { ...doc, list: doc.list.map((c) => (c.id === channel.id ? next : c)) });
  return { rule, channel: next };
}

/* ── Prices ──────────────────────────────────────────────────────────────── */

async function readPrices(orgId) {
  const saved = orgId ? await getJSON(PRICES(orgId)) : null;
  return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
}

/* What each item is listed at on a channel now: the last entry for it, left
   out when that entry took the price away again. */
export function currentPrices(doc, channelId) {
  const out = {};
  for (const [key, history] of Object.entries(doc?.[channelId] || {})) {
    const last = Array.isArray(history) ? history[history.length - 1] : null;
    if (last && Number(last.price) > 0) out[key] = Number(last.price);
  }
  return out;
}

export async function pricesFor(orgId) {
  const doc = await readPrices(orgId);
  return { doc, byChannel: Object.fromEntries(Object.keys(doc).map((id) => [id, currentPrices(doc, id)])) };
}

/* Set, change or clear listed prices on one channel. `price: null` takes a
   price off, after which the item sells there at the counter's price. */
export async function setPrices(orgId, channelId, entries, { by = "", now = Date.now() } = {}) {
  const channels = await listChannels(orgId, { now });
  if (!channels.some((c) => c.id === String(channelId))) return { error: "notfound" };
  if (!Array.isArray(entries) || !entries.length || entries.length > 2000) return { error: "prices" };
  const doc = await readPrices(orgId);
  const mine = { ...(doc[channelId] || {}) };
  let changed = 0;
  for (const e of entries) {
    const key = text(e?.itemKey, 140);
    if (!key) return { error: "prices" };
    const price = e.price === null || e.price === "" || e.price === undefined ? null : Number(e.price);
    if (price !== null && (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE)) return { error: "price", itemKey: key };
    const history = Array.isArray(mine[key]) ? mine[key] : [];
    const last = history[history.length - 1];
    if ((last ? Number(last.price) || null : null) === (price === null ? null : round2(price))) continue;
    mine[key] = [...history.slice(-49), { price: price === null ? null : round2(price), recommended: Boolean(e.recommended), at: now, by: text(by, 60) }];
    changed += 1;
  }
  if (changed) await setJSON(PRICES(orgId), { ...doc, [channelId]: mine });
  return { changed, prices: currentPrices({ [channelId]: mine }, channelId) };
}

/* Give one channel the prices another has now. */
export async function copyPrices(orgId, fromId, toId, opts = {}) {
  if (String(fromId) === String(toId)) return { error: "same" };
  const { byChannel } = await pricesFor(orgId);
  const from = byChannel[fromId] || {};
  const entries = Object.entries(from).map(([itemKey, price]) => ({ itemKey, price }));
  if (!entries.length) return { error: "empty" };
  return setPrices(orgId, toId, entries, opts);
}

/* ── For the register ────────────────────────────────────────────────────── */

const availableAt = (channel, branchId) => channel.active
  && (!channel.branches?.length || !branchId || channel.branches.includes(String(branchId)));

/* The channels a sale may be rung up under at a branch, each with the prices
   it lists and the rule in force now — enough for a till to price and cost a
   sale with no connection. */
export async function channelsForRegister(orgId, branchIds = [], { now = Date.now(), timeZone } = {}) {
  const [list, { byChannel }] = await Promise.all([listChannels(orgId, { now }), pricesFor(orgId)]);
  const day = dayIn(now, timeZone);
  return list.filter((c) => c.active).map((c) => ({
    id: c.id, name: c.name, type: c.type, branches: c.branches || [],
    prices: byChannel[c.id] || {},
    rule: stripRule(ruleAt(c.rules, day, null)),
    rules: Object.fromEntries(branchIds.map((b) => [b, stripRule(ruleAt(c.rules, day, b))]).filter(([, r]) => r)),
  }));
}

/* The channel a sale names, checked: it must exist, be in use, and run at
   that branch. No channel named is the counter. */
export async function channelForSale(orgId, channelId, branchId, { at = Date.now(), timeZone, anyState = false } = {}) {
  const list = await listChannels(orgId, { now: at });
  const id = channelId ? String(channelId) : IN_STORE_ID;
  const channel = list.find((c) => c.id === id);
  /* `anyState` is for a sale already made offline: a channel switched off
     since is still the channel it was sold on. */
  if (!channel || (!anyState && !availableAt(channel, branchId))) return { error: "channel" };
  const { byChannel } = await pricesFor(orgId);
  return {
    channel: { id: channel.id, name: channel.name, type: channel.type, prices: byChannel[channel.id] || {} },
    rule: stripRule(ruleAt(channel.rules, dayIn(at, timeZone), branchId)),
  };
}

function stripRule(rule) {
  if (!rule) return null;
  const { createdBy: _by, ...rest } = rule;
  return rest;
}

/* What a receipt came to on its channel, from the rule it was sold under.

   `costOf(line)` gives a line's recipe cost per unit or null. The discount on
   the receipt is the restaurant's own — the register has no way to enter one
   a platform paid for — so all of it counts against the sale. */
export function receiptEconomics(receipt, rule, costOf = () => null, { at = Date.now() } = {}) {
  const lines = (receipt.line_items || []).map((li) => {
    const qty = Number(li.quantity) || 0;
    return { price: qty > 0 ? (Number(li.gross_total_money ?? li.total_money) || 0) / qty : 0, qty, recipeCost: costOf(li) };
  });
  const e = orderEconomics({
    lines, rule: rule || EMPTY_RULE, vatPct: receipt.vat_pct, vatMode: receipt.vat_mode,
    discount: Number(receipt.total_discount) || 0,
  });
  return {
    subtotal: e.subtotal, tax: e.tax, merchant_discount: e.merchantDiscount,
    commission_amount: e.commission, payment_fee_amount: e.paymentFee, advertising_amount: e.advertising,
    fixed_fees: e.fixedFees, delivery_cost: e.deliveryCost, vat_on_platform_fee: e.vatOnFees,
    channel_cost: e.channelCost, net_revenue: e.netRevenue,
    recipe_cost: e.recipeCost, cost_complete: e.costComplete,
    contribution_profit: e.contribution, contribution_margin_percent: e.marginPct,
    calculated_at: new Date(at).toISOString(),
  };
}

/* A line's recipe cost per unit, from the costs the overview uses
   (`menuCosts`): the variant's own recipe, the cost a product carries, or
   the dish's recipe scaled for a variant drawn at a different size. */
export function lineCostFrom(costs) {
  return (li) => {
    const name = li.item_name || "";
    const qty = Number(li.quantity) || 0;
    const addons = Number(li.addon_cost) > 0 && qty > 0 ? Number(li.addon_cost) / qty : 0;
    const keyed = li.variant_name ? costs?.get(`${name}||${li.variant_name}`) : null;
    if (keyed?.cost > 0) return keyed.cost + addons;
    if (Number(li.cost) > 0 && qty > 0) return Number(li.cost) / qty + addons;
    const base = costs?.get(name)?.cost || 0;
    const scale = Number(li.variant_scale) > 0 ? Number(li.variant_scale) : 1;
    return base > 0 ? base * scale + addons : null;
  };
}

/* ── The menu, as each channel sees it ───────────────────────────────────── */

/* One row per sellable thing — an item, or each variant of one — with what it
   costs to make. `catalogue` is the register's (`catalogueOf`). */
export function menuRows(catalogue, costs) {
  const rows = [];
  for (const item of catalogue || []) {
    if (item.hidden) continue;
    const variants = (item.variants || []).filter((v) => v.price > 0);
    const baseCost = item.kind === "product"
      ? (Number(item.cost) > 0 ? Number(item.cost) : null)
      : costs?.get(item.name)?.cost ?? null;
    if (!variants.length) {
      if (!(item.price > 0)) continue;
      rows.push({ key: itemKeyOf(item.id), itemId: item.id, variantId: "", name: item.name, variant: "", category: item.category || "", price: item.price, cost: baseCost });
      continue;
    }
    for (const v of variants) {
      const own = costs?.get(`${item.name}||${v.name}`)?.cost ?? null;
      const scaled = baseCost !== null ? baseCost * (Number(v.scale) > 0 ? Number(v.scale) : 1) : null;
      rows.push({
        key: itemKeyOf(item.id, v.id), itemId: item.id, variantId: v.id, name: item.name, variant: v.name || "",
        category: item.category || "", price: v.price,
        cost: v.recipeId ? (own ?? (v.name ? null : baseCost)) : scaled,
      });
    }
  }
  return rows.map((r) => ({ ...r, cost: r.cost === null ? null : Math.round(r.cost * 10000) / 10000 }));
}

/* ── What needs looking at ──────────────────────────────────────────────────

   Kinds and numbers only; the wording is the screen's, in the reader's
   language. Capped per kind and channel, worst first, with the count of what
   was left out — forty near-identical lines are not forty alerts. */
const PER_KIND = 5;

export function channelAlerts({ channels, prices, rows, vatPct, vatMode, settings, pricesDoc = {}, now = Date.now(), timeZone, branchId = null }) {
  const day = dayIn(now, timeZone);
  const minMarginPct = Number(settings?.minMarginPct) || 0;
  const counter = channels.find((c) => c.id === IN_STORE_ID);
  const inStoreRule = ruleAt(counter?.rules, day, branchId) || EMPTY_RULE;
  const out = [];
  const more = {};
  const push = (list, kind, channel) => {
    list.sort((a, b) => a.rank - b.rank);
    for (const a of list.slice(0, PER_KIND)) out.push({ kind, channelId: channel.id, channel: channel.name, ...a.alert });
    if (list.length > PER_KIND) more[`${kind}:${channel.id}`] = list.length - PER_KIND;
  };

  for (const channel of channels) {
    if (!channel.active || channel.id === IN_STORE_ID) continue;
    const rule = ruleAt(channel.rules, day, branchId) || EMPTY_RULE;
    const listed = prices[channel.id] || {};
    const below = [];
    const unsafe = [];
    const discounted = [];

    for (const row of rows) {
      if (row.cost === null) continue;
      const price = listed[row.key] ?? row.price;
      const c = compareItem({ price, inStorePrice: row.price, recipeCost: row.cost, rule, inStoreRule, vatPct, vatMode, minMarginPct });
      const label = row.variant ? `${row.name} · ${row.variant}` : row.name;

      if (c.status === "red") {
        const safe = priceFor({ target: 0, recipeCost: row.cost, rule, vatPct, vatMode });
        unsafe.push({ rank: c.contribution, alert: { itemKey: row.key, item: label, severity: "critical", values: { price: round2(price), profit: c.contribution, marginPct: c.marginPct, minimum: safe, minMarginPct } } });
      } else if (c.inStoreContribution - c.contribution >= Math.max(1, c.inStoreContribution * 0.1)) {
        below.push({ rank: c.contribution - c.inStoreContribution, alert: { itemKey: row.key, item: label, severity: "warning", values: { inStore: c.inStoreContribution, here: c.contribution, recommended: c.recommended } } });
      }

      /* A discount the restaurant funds, taking a margin that was acceptable
         without it below the line. */
      if (rule.discountModel !== "none") {
        const without = itemEconomics({ price, recipeCost: row.cost, rule, vatPct, vatMode, applyDiscount: false });
        if (without.marginPct !== null && without.marginPct >= minMarginPct && c.marginPct !== null && c.marginPct < minMarginPct) {
          discounted.push({ rank: c.marginPct, alert: { itemKey: row.key, item: label, severity: "warning", values: { marginPct: c.marginPct, without: without.marginPct, minMarginPct } } });
        }
      }
    }
    push(unsafe, "belowMinimum", channel);
    push(below, "belowInStore", channel);
    push(discounted, "discountMargin", channel);

    /* The fees moved after the prices were last looked at. Only once there has
       been a change: a channel's first rule is setting it up, not changing it. */
    const rules = [...(channel.rules || [])].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const newest = rules[rules.length - 1];
    const lastPriced = Math.max(0, ...Object.values(pricesDoc[channel.id] || {}).map((h) => (Array.isArray(h) && h.length ? h[h.length - 1].at || 0 : 0)));
    if (rules.length > 1 && newest.createdAt > lastPriced) {
      out.push({ kind: "feesChanged", channelId: channel.id, channel: channel.name, severity: "warning", values: { since: newest.validFrom, commissionPct: newest.commissionPct } });
    }
    /* Nobody has confirmed these fees in three months. */
    if (newest && now - (newest.createdAt || 0) > STALE_FEE_DAYS * DAY) {
      out.push({ kind: "feesStale", channelId: channel.id, channel: channel.name, severity: "info", values: { days: Math.floor((now - newest.createdAt) / DAY) } });
    }
    /* In use, and nothing says what it costs. */
    if (!rules.length) {
      out.push({ kind: "noFees", channelId: channel.id, channel: channel.name, severity: "info", values: {} });
    }
  }
  return { alerts: out, more };
}

/* ── What each channel actually brought in ──────────────────────────────────

   Read from the snapshot each receipt carries. A receipt from before
   channels existed has none: it was sold at the counter, so it is costed
   there with today's recipe costs and the report says how many were. */
export function channelReport(receipts, { channels, costs, from, to = Date.now(), branches = null }) {
  const allowed = branches === null ? null : new Set(branches.map(String));
  const names = Object.fromEntries((channels || []).map((c) => [c.id, c.name]));
  const costOf = lineCostFrom(costs);
  const by = new Map();
  const sales = new Map();
  let estimated = 0;

  for (const r of receipts || []) {
    sales.set(r.receipt_number, r);
  }
  for (const r of receipts || []) {
    if (r.cancelled_at) continue;
    const at = new Date(r.receipt_date).getTime();
    if ((from && at < from) || at > to) continue;
    if (allowed && !allowed.has(String(r.store_id || "register"))) continue;
    const refund = r.receipt_type === "REFUND";
    const origin = refund ? sales.get(r.refund_for) : null;
    const id = r.channel_id || origin?.channel_id || IN_STORE_ID;
    const row = by.get(id) || {
      channelId: id, channel: names[id] || r.channel_name || origin?.channel_name || id,
      orders: 0, sales: 0, channelCost: 0, recipeCost: 0, contribution: 0, refunds: 0, items: new Map(), costComplete: true,
    };
    by.set(id, row);

    if (refund) {
      /* Only the money comes back; the food was made and the platform's
         terms for a refunded order are not something a receipt states. */
      const v = Math.max(0, Number(r.vat_pct) || 0) / 100;
      const back = Math.abs(Number(r.total_money) || 0) / (1 + v);
      row.refunds += back;
      row.sales -= back;
      row.contribution -= back;
      continue;
    }

    let e = r.channel_economics;
    if (!e) {
      e = receiptEconomics(r, EMPTY_RULE, costOf, { at });
      estimated += 1;
    }
    row.orders += 1;
    row.sales += e.subtotal;
    row.channelCost += e.channel_cost;
    row.recipeCost += e.recipe_cost;
    row.contribution += e.contribution_profit;
    if (e.cost_complete === false) row.costComplete = false;

    /* Each line's share of what the order made, by value, for the item
       ranking. Fees are an order's; splitting them by value is the only
       split a receipt supports. */
    const total = (r.line_items || []).reduce((s, li) => s + (Number(li.total_money) || 0), 0);
    for (const li of r.line_items || []) {
      const share = total > 0 ? (Number(li.total_money) || 0) / total : 0;
      const name = li.variant_name ? `${li.item_name} · ${li.variant_name}` : li.item_name || "";
      const unit = li.recipe_cost ?? costOf(li);
      const cost = unit === null || unit === undefined ? 0 : Number(unit) * (Number(li.quantity) || 0);
      const it = row.items.get(name) || { name, qty: 0, sales: 0, contribution: 0 };
      it.qty += Number(li.quantity) || 0;
      it.sales += e.subtotal * share;
      it.contribution += (e.net_revenue * share) - cost;
      row.items.set(name, it);
    }
  }

  const rows = [...by.values()].map((row) => {
    const items = [...row.items.values()].map((i) => ({ ...i, sales: round2(i.sales), contribution: round2(i.contribution) }));
    return {
      channelId: row.channelId, channel: row.channel, orders: row.orders,
      sales: round2(row.sales), channelCost: round2(row.channelCost), recipeCost: round2(row.recipeCost),
      contribution: round2(row.contribution), refunds: round2(row.refunds),
      avgProfitPerOrder: row.orders ? round2(row.contribution / row.orders) : null,
      costPct: row.sales > 0 ? Math.round((row.channelCost / row.sales) * 1000) / 10 : null,
      marginPct: row.sales > 0 ? Math.round((row.contribution / row.sales) * 1000) / 10 : null,
      costComplete: row.costComplete,
      topItems: [...items].sort((a, b) => b.contribution - a.contribution).slice(0, 5),
      bottomItems: [...items].sort((a, b) => a.contribution - b.contribution).slice(0, 3),
    };
  }).sort((a, b) => b.sales - a.sales);

  const selling = rows.filter((r) => r.orders > 0);
  const pick = (list, f) => (list.length ? list.reduce((x, y) => (f(y, x) ? y : x)).channelId : null);
  return {
    from: from ? new Date(from).toISOString() : null,
    to: new Date(to).toISOString(),
    rows,
    mostSales: pick(selling, (a, b) => a.sales > b.sales),
    mostProfit: pick(selling, (a, b) => a.contribution > b.contribution),
    leastProfitable: pick(selling.filter((r) => r.marginPct !== null), (a, b) => a.marginPct < b.marginPct),
    /* Receipts with no snapshot of their own, costed at the counter with
       today's recipe costs. */
    estimatedReceipts: estimated,
  };
}

/* How each channel's listed prices sit against the counter's, on average. */
export function pricingGap(rows, prices, channels) {
  return channels.filter((c) => c.id !== IN_STORE_ID && c.active).map((c) => {
    const listed = prices[c.id] || {};
    const diffs = rows.filter((r) => listed[r.key] > 0 && r.price > 0).map((r) => (listed[r.key] - r.price) / r.price);
    return {
      channelId: c.id, channel: c.name, priced: diffs.length,
      avgPct: diffs.length ? Math.round((diffs.reduce((s, d) => s + d, 0) / diffs.length) * 1000) / 10 : null,
    };
  });
}
