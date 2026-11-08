/* Folding receipts into metrics — the branch-scopable core.

   This used to live inside the Loyverse fetch, which meant every figure was
   aggregated across the whole organization before anyone could ask about a
   single branch. Splitting it out is what makes a branch scope produce real
   numbers rather than an organization total wearing a branch label: the fetch
   happens once and is cached, and this runs per scope over the same receipts.

   `branches` is the already-authorized, already-intersected list from
   `_org.js`. It is a filter over receipts, nothing more — this module makes no
   authorization decision and must never be handed a list straight from a
   request. An empty list means "no branches", which correctly produces zeros;
   `null` means "no filter", which is the whole organization.

   The return value is the pre-derivation shape: `_data.js` adds the forecast,
   advice and margin layers on top. */

const DAY = 864e5;

const hourLabel = (h) => {
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${suffix}`;
};

/* Change against an earlier figure, or null when there was nothing earlier.
   It used to be 0 when the earlier period had no sales, so a business's first
   week read "up 0.0%" — a comparison with nothing, presented as a flat one. */
const pctChange = (now, before) =>
  before > 0 ? Number((((now - before) / before) * 100).toFixed(1)) : null;

/* The calendar day and hour a moment falls in, in the business's own time.

   Days were cut at midnight UTC and hours read in the server's zone, so on a
   server running in UTC a sale at 1am in Dubai landed on the day before and
   in the 9pm bar of the busiest-hours chart. */
const formatters = new Map();
function localParts(ts, timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}
export const DEFAULT_TIMEZONE = "Asia/Dubai";
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* One pass over the receipts. Everything downstream is derived from what this
   accumulates, so a branch filter applied here reaches every figure —
   including the item, daily and hourly series that a post-hoc filter on the
   finished payload could never split. */
export function aggregate({ receipts, limitedHistory, catalogue, storeNames, now }, { overrides = {}, branches = null, timeZone = DEFAULT_TIMEZONE, periodDays = 30 } = {}) {
  const span = Math.max(1, Math.floor(Number(periodDays) || 30));
  const zone = (() => { try { localParts(0, timeZone); return timeZone; } catch { return DEFAULT_TIMEZONE; } })();
  const dayOf = (ts) => localParts(ts, zone).date;
  /* Restrict to the scoped branches before anything is counted. */
  const allowed = branches === null ? null : new Set(branches.map(String));
  if (allowed) {
    receipts = receipts.filter((r) => allowed.has(String(r.store_id || "unknown")));
  }

  /* An owner-entered cost always wins over the POS value — they know what
     they actually pay, and POS costs are often left at zero. */
  /* What one sold line cost the business, or 0 when nobody knows.

     In order: a cost the owner typed for the dish; the variant's own recipe;
     the cost the receipt carries for a product sold as it comes; the dish's
     recipe, scaled for a variant drawn at a different size. Add-ons the
     register costed are added on top. `catalogue` is the recipe costing
     (`menuCosts`), per portion. */
  const lineCost = (li) => {
    const name = li.item_name || "Unnamed item";
    const qty = Number(li.quantity) || 0;
    const addons = Number(li.addon_cost) > 0 ? Number(li.addon_cost) : 0;
    const override = overrides[name];
    if (typeof override === "number" && override > 0) return { cost: override * qty + addons, known: true };
    const keyed = li.variant_name ? catalogue.get(`${name}||${li.variant_name}`) : null;
    if (keyed?.cost > 0) return { cost: keyed.cost * qty + addons, known: true };
    if (Number(li.cost) > 0) return { cost: Number(li.cost) + addons, known: true };
    const base = catalogue.get(name)?.cost || 0;
    const scale = Number(li.variant_scale) > 0 ? Number(li.variant_scale) : 1;
    return base > 0 ? { cost: base * scale * qty + addons, known: true } : { cost: addons, known: false };
  };

  /* A line's takings without the VAT in them. VAT collected is owed to the
     tax authority, not kept, so profit and margin are worked out on sales
     before it — counting it as turnover overstated gross profit by exactly the
     VAT, and pushed every margin up by it. Added-on VAT is already outside a
     line's total; included VAT is inside it and is taken out. */
  const exVat = (li, r) => {
    const total = Number(li.total_money) || 0;
    const pct = Number(r.vat_pct) || 0;
    return r.vat_mode === "inclusive" && pct > 0 ? total / (1 + pct / 100) : total;
  };
  let currentTax = 0, currentRefundTax = 0;
  let lineRevenue = 0, costedRevenue = 0, costedCost = 0;
  const imageFor = (itemName) => catalogue.get(itemName)?.image || null;

  /* The period is the last 30 days by the business's calendar — today and
     the 29 before it, the same days the chart draws — and the period before
     it is the 30 days ahead of that. It was 30×24 hours back from this
     moment, so the headline took in part of a day the chart did not, and the
     "previous period" was everything older still in the window, not 30 days. */
  const currentFrom = dayOf(now - (span - 1) * DAY);
  const priorFrom = dayOf(now - (2 * span - 1) * DAY);
  const periodOf = (ts) => {
    const key = dayOf(ts);
    return key >= currentFrom ? "current" : key >= priorFrom ? "prior" : null;
  };

  const byDay = new Map();
  const byHour = new Map();
  const byStore = new Map();
  const byItem = new Map();
  const byPayment = new Map();
  let currentSales = 0, currentReceipts = 0, priorSales = 0, priorReceipts = 0;
  let totalCost = 0;
  let totalDiscounts = 0;
  let currentRefunds = 0, priorRefunds = 0;

  for (const r of receipts) {
    /* A cancelled receipt is skipped outright: nothing was sold, nothing was
       refunded, nothing happened. */
    if (r.cancelled_at) continue;

    const ts = new Date(r.receipt_date).getTime();

    /* Money given back.

       ── What this used to do, and why it was wrong ───────────────────────

       Refund receipts were skipped with the same `continue` as cancellations,
       and `extras.refunds` was the literal `0`. So a refunded sale stayed in
       the turnover at full value for ever: the original SALE receipt is not
       modified by a refund — Loyverse writes a separate REFUND receipt
       pointing back at it through `refund_for` — and skipping that second
       receipt meant the money was never taken off anything. An owner who
       refunded a table saw the sale, saw no refund, and the two never met.

       ── On the sign, which is not documented ─────────────────────────────

       Loyverse's API reference and the community typings both leave the sign
       of `total_money` on a REFUND unstated, and this app has never had a
       fixture that pins it. So the magnitude is taken and subtracted
       explicitly, which is correct whichever way the sign arrives rather than
       correct only if a guess holds. `receipt_type` is what says this is a
       refund; the sign is not asked to carry that meaning.

       ── The cost deliberately stays ──────────────────────────────────────

       Only the money comes back. A refund never returns the food to the
       shelf — a served burger does not — and the same reasoning applies here: the ingredients were consumed, so they
       remain a cost. Netting them off as well would make a refunded meal look
       free to produce. */
    if (r.receipt_type === "REFUND") {
      const refunded = Math.abs(Number(r.total_money) || 0);
      const period = periodOf(ts);
      if (period === "prior") priorRefunds += refunded;
      else if (period === "current") {
        currentRefunds += refunded;
        currentRefundTax += Math.abs(Number(r.total_tax) || 0);

        /* Taken off the day and the branch it was refunded on, so the chart
           and the branch ranking still add up to the headline figure. */
        const rk = dayOf(ts);
        const rd = byDay.get(rk) || { sales: 0, receipts: 0, tax: 0 };
        rd.sales -= refunded;
        rd.tax -= Math.abs(Number(r.total_tax) || 0);
        byDay.set(rk, rd);

        const rsid = r.store_id || "unknown";
        const rst = byStore.get(rsid) || { sales: 0, receipts: 0 };
        rst.sales -= refunded;
        byStore.set(rsid, rst);
      }
      /* Not counted as a receipt. A refund is not an order, and folding it
         into the count would make the average ticket meaningless.

         Item-level attribution is deliberately left alone. A refund receipt
         lists the items, but which of three identical lines came back is a
         policy question rather than a fact the receipt states, and guessing it
         would put a wrong number on a specific dish — worse than a right
         number on the total. Noted as an open policy item. */
      continue;
    }

    const value = Number(r.total_money) || 0;

    const period = periodOf(ts);
    if (!period) continue;
    if (period === "prior") {
      priorSales += value;
      priorReceipts += 1;
      continue;
    }

    currentSales += value;
    currentReceipts += 1;
    currentTax += Math.abs(Number(r.total_tax) || 0);
    /* Declared, reported and never added to: every dashboard said no
       discounts were given. A receipt states what was knocked off it — the
       till's and the register's alike — so the figure is simply summed. */
    totalDiscounts += Math.abs(Number(r.total_discount) || 0);

    const local = localParts(ts, zone);
    const key = local.date;
    const day = byDay.get(key) || { sales: 0, receipts: 0, tax: 0 };
    day.sales += value;
    day.receipts += 1;
    day.tax += Math.abs(Number(r.total_tax) || 0);
    byDay.set(key, day);

    const h = local.hour;
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
      const net = exVat(li, r);
      const { cost, known } = lineCost(li);
      const unitCost = known && qty > 0 ? cost / qty : 0;
      lineRevenue += net;
      if (known) { costedRevenue += net; costedCost += cost; }

      const it = byItem.get(name) || {
        qty: 0,
        revenue: 0,
        netRevenue: 0,
        cost: 0,
        unitCost,
        image: imageFor(name),
        category: li.variant_name || "—",
        hasCost: known,
      };
      it.qty += qty;
      it.revenue += revenue;
      it.netRevenue += net;
      it.cost += cost;
      it.unitCost = unitCost || it.unitCost;
      it.hasCost = it.hasCost || known;
      byItem.set(name, it);

      totalCost += cost;
    }
  }

  const daily = [];
  for (let i = span - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    const key = dayOf(d.getTime());
    const row = byDay.get(key) || { sales: 0, receipts: 0, tax: 0 };
    daily.push({
      date: key,
      label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: zone }),
      /* To the fil, so the days add up to the period's total; rounding each
         day to a whole dirham first let the two drift apart. */
      sales: Math.round(row.sales * 100) / 100,
      receipts: row.receipts,
      tax: Math.round((row.tax || 0) * 100) / 100,
    });
  }

  const hours = [];
  for (let h = 0; h < 24; h++) {
    const count = byHour.get(h) || 0;
    if (count > 0 || (h >= 8 && h <= 23)) {
      hours.push({ hour: h, label: hourLabel(h), receipts: count });
    }
  }

  /* Sales after the money given back, which is what every figure below is
     built on. Both periods are netted, so the comparison is like for like. */
  const netSales = currentSales - currentRefunds;
  const priorNetSales = priorSales - priorRefunds;

  /* Turnover less the cost of the goods sold, and nothing else.

     Called gross profit because that is what it is. It was called net profit
     for a long time, and in Arabic and Urdu it was labelled "what is left
     after deducting the expenses" — a claim the number cannot support, since
     rent, wages and every other standing cost in `_fixedcosts.js` are absent
     from `totalCost`. An owner reading it was being told their business kept
     more than it does.

     Net profit is a real thing this product could report, and reporting it
     needs the fixed and variable cost ledgers folded in with an agreed period
     and no double counting. Until that exists the honest name is this one. */
  /* Profit is worked on sales without VAT (see `exVat`); `sales` stays what
     the customers paid, which is what the drawer and the card machine show. */
  const salesExVat = netSales - (currentTax - currentRefundTax);
  const grossProfit = salesExVat - totalCost;
  const marginPct = salesExVat > 0 ? (grossProfit / salesExVat) * 100 : 0;
  /* The margin on the part of the menu whose cost is known. The headline
     margin treats every uncosted dish as free; this one leaves them out, so
     it is the figure that can be scored and compared. Null with nothing
     costed. */
  const costedMarginPct = costedRevenue > 0 ? ((costedRevenue - costedCost) / costedRevenue) * 100 : null;

  const itemsRaw = [...byItem.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 14);
  const itemTotal = itemsRaw.reduce((s, i) => s + i.revenue, 0) || 1;

  const paymentTotal = [...byPayment.values()].reduce((a, b) => a + b, 0) || 1;
  const todayKey = dayOf(now);
  const todayRow = byDay.get(todayKey) || { sales: 0, receipts: 0 };
  const ydayKey = dayOf(now - DAY);
  const ydayRow = byDay.get(ydayKey) || { sales: 0, receipts: 0 };

  return {
    connected: true,
    source: "POS",
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
    extras: { discounts: Math.round(totalDiscounts), refunds: Math.round(currentRefunds), cost: Math.round(totalCost) },
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
      const profit = i.netRevenue - i.cost;
      return {
        ...i,
        revenue: Math.round(i.revenue),
        netRevenue: Math.round(i.netRevenue),
        cost: Math.round(i.cost),
        profit: Math.round(profit),
        /* Null when the dish's cost is unknown: a 100% margin on a dish
           nobody has costed is the most flattering wrong number there is. */
        marginPct: i.hasCost && i.netRevenue > 0 ? Number(((profit / i.netRevenue) * 100).toFixed(1)) : null,
        share: Math.round((i.revenue / itemTotal) * 100),
      };
    }),
    limitedHistory,
    /* Cost coverage matters more than it looks: a 100% margin almost always
       means costs are missing, not that everything is free. The interface
       uses this to say which it is. */
    /* Line by line, and both sides without VAT. It was costed items' line
       revenue over receipt totals that included VAT, so a fully costed menu
       topped out near 95% and could never read as complete; and an item with
       one costed variant counted all of its sales as costed. */
    costCoverage: lineRevenue > 0 ? Math.round((costedRevenue / lineRevenue) * 100) : 0,
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
      sales: Math.round(netSales * 100) / 100,
      receipts: currentReceipts,
      avgTicket: netSales / Math.max(currentReceipts, 1),
      /* To the fil: net profit is worked from these, and rounding each to a
         whole dirham first made it disagree with the gross profit beside it. */
      cost: round2(totalCost),
      /* VAT collected in the period, net of refunds, and sales without it —
         the base that profit and margin are worked on. */
      tax: round2(currentTax - currentRefundTax),
      salesExVat: round2(salesExVat),
      grossProfit: round2(grossProfit),
      costedMarginPct: costedMarginPct === null ? null : Number(costedMarginPct.toFixed(1)),
      /* The old name, still emitted and carrying the same number it always
         did. The Flutter client reads it, and renaming a field out from under
         a shipped app breaks a screen for everybody who has not updated.
         Nothing in this repository reads it any more; it goes when the mobile
         client has moved. */
      netProfit: Math.round(grossProfit),
      /* Refunds, separately, because the spec is right that netting them away
         silently leaves nobody able to see how much was handed back. */
      refunds: Math.round(currentRefunds),
      marginPct: Number(marginPct.toFixed(1)),
      discounts: Math.round(totalDiscounts),
      salesDelta: limitedHistory ? null : pctChange(netSales, priorNetSales),
      receiptsDelta: limitedHistory ? null : pctChange(currentReceipts, priorReceipts),
      avgTicketDelta: limitedHistory
        ? null
        : pctChange(
            netSales / Math.max(currentReceipts, 1),
            priorNetSales / Math.max(priorReceipts, 1)
          ),
    },
  };
}
