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

const pctChange = (now, before) =>
  before > 0 ? Number((((now - before) / before) * 100).toFixed(1)) : 0;

/* One pass over the receipts. Everything downstream is derived from what this
   accumulates, so a branch filter applied here reaches every figure —
   including the item, daily and hourly series that a post-hoc filter on the
   finished payload could never split. */
export function aggregate({ receipts, limitedHistory, catalogue, storeNames, now }, { overrides = {}, branches = null } = {}) {
  /* Restrict to the scoped branches before anything is counted. */
  const allowed = branches === null ? null : new Set(branches.map(String));
  if (allowed) {
    receipts = receipts.filter((r) => allowed.has(String(r.store_id || "unknown")));
  }

  /* An owner-entered cost always wins over the POS value — they know what
     they actually pay, and Loyverse costs are often left at zero. */
  const costFor = (itemName, variantName) => {
    const override = overrides[itemName];
    if (typeof override === "number" && override > 0) return override;
    const keyed = variantName ? catalogue.get(`${itemName}||${variantName}`) : null;
    return keyed?.cost || catalogue.get(itemName)?.cost || 0;
  };
  const imageFor = (itemName) => catalogue.get(itemName)?.image || null;

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

  return {
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
  };
}
