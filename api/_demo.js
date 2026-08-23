/* Realistic sample figures for an account with no POS connected yet.

   The product is meant to be fully usable before a POS is linked — the
   interface says "you'll see sample figures, clearly marked" — so an account
   with no token gets these instead of an empty table. They are deterministic,
   so the dashboard doesn't jump between polls, and anchored to the current
   date so "today" and the 30-day window stay current.

   The shape is exactly what `_aggregate.js` expects from a Loyverse read:
   receipts, a catalogue keyed by item name, store names and the branch roster.
   Nothing downstream knows or cares that this didn't come from a real POS. */

const DAY = 864e5;

const STORES = [
  { id: "1", name: "Al Jimi Mall" },
  { id: "2", name: "Al Mutarad" },
];

/* name, price, cost, category. Two items deliberately carry no cost so the
   "cost coverage" and "missing costs" surfaces have something honest to show. */
const MENU = [
  { name: "Mixed grill", price: 92, cost: 38, category: "Grill" },
  { name: "Lamb ouzi", price: 110, cost: 52, category: "Rice" },
  { name: "Shawarma plate", price: 36, cost: 12, category: "Grill" },
  { name: "Grilled halloumi", price: 38, cost: 14, category: "Starters" },
  { name: "Fattoush", price: 32, cost: 11, category: "Salads" },
  { name: "Hummus", price: 22, cost: 7, category: "Starters" },
  { name: "Falafel wrap", price: 16, cost: 5, category: "Sandwiches" },
  { name: "Kunafa", price: 28, cost: 10, category: "Desserts" },
  { name: "Fresh juice", price: 18, cost: 6, category: "Drinks" },
  { name: "Karak chai", price: 8, cost: 2, category: "Drinks" },
  { name: "Daily soup", price: 20, cost: 0, category: "Starters" },
  { name: "Arabic coffee", price: 15, cost: 0, category: "Drinks" },
];

/* How often each item is chosen, so the menu reads like a real one — a couple
   of stars, a long tail, and the cheap drinks that round out every order. */
const WEIGHTS = [10, 6, 9, 7, 8, 7, 6, 5, 11, 14, 4, 8];

/* A small deterministic PRNG so two builds of the same window produce the same
   numbers. The dashboard polls every 30s; without this, every figure would
   flicker. */
function rng(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick(rand, items, weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/* Operating hours 8am–11pm. Lunch (12–14) and dinner (19–21) carry the day. */
const HOUR_WEIGHTS = {
  8: 1, 9: 2, 10: 3, 11: 6, 12: 12, 13: 14, 14: 10,
  15: 5, 16: 4, 17: 5, 18: 7, 19: 13, 20: 15, 21: 11, 22: 5, 23: 2,
};
const HOURS = Object.keys(HOUR_WEIGHTS).map(Number);
const HOUR_W = HOURS.map((h) => HOUR_WEIGHTS[h]);

const PAYMENTS = [
  { name: "Card", w: 6 },
  { name: "Cash", w: 4 },
];

function pickHour(rand) {
  return weightedPick(rand, HOURS, HOUR_W);
}

/* UAE weekend is Friday/Saturday; those days are meaningfully busier. */
function dailyBase(date) {
  const dow = date.getDay(); // 0 Sun … 5 Fri, 6 Sat
  let base = 16;
  if (dow === 5) base = 30; // Friday
  else if (dow === 6) base = 26; // Saturday
  else if (dow === 0) base = 20; // Sunday
  return base;
}

function buildCatalogue() {
  const m = new Map();
  for (const item of MENU) {
    m.set(item.name, { cost: item.cost, image: null, category: item.category });
  }
  return m;
}

export function demoStores() {
  return STORES.map((s) => ({ id: s.id, name: s.name }));
}

/* The raw upstream-shaped read, the same object `fetchRaw` produces for a live
   POS. `now` is taken from the caller so "today" tracks the real clock. */
export function demoRaw(now = Date.now()) {
  const rand = rng(20260823);
  const catalogue = buildCatalogue();
  const storeNames = Object.fromEntries(STORES.map((s) => [s.id, s.name]));
  const receipts = [];

  for (let i = 59; i >= 0; i--) {
    const day = new Date(now - i * DAY);
    const base = dailyBase(day);
    const count = base + Math.floor(rand() * 6) - 2;

    for (let n = 0; n < count; n++) {
      const hour = pickHour(rand);
      const minute = Math.floor(rand() * 60);
      const ts = new Date(day);
      ts.setHours(hour, minute, 0, 0);

      // Al Jimi is the busier branch.
      const store = rand() < 0.62 ? "1" : "2";

      const lineCount = 1 + Math.floor(rand() * 3) + (rand() < 0.25 ? 1 : 0);
      const lineItems = [];
      let total = 0;
      for (let l = 0; l < lineCount; l++) {
        const item = weightedPick(rand, MENU, WEIGHTS);
        const qty = rand() < 0.85 ? 1 : 2;
        const lineTotal = item.price * qty;
        total += lineTotal;
        lineItems.push({
          item_name: item.name,
          variant_name: "",
          quantity: qty,
          total_money: lineTotal,
        });
      }

      const pay = weightedPick(rand, PAYMENTS, PAYMENTS.map((p) => p.w));
      receipts.push({
        receipt_type: "SALE",
        cancelled_at: null,
        receipt_date: ts.toISOString(),
        total_money: total,
        currency: "AED",
        store_id: store,
        line_items: lineItems,
        payments: [{ name: pay.name, money_amount: total }],
      });
    }
  }

  return {
    now,
    fetchedAt: now,
    since: new Date(now - 60 * DAY).toISOString(),
    receiptCount: receipts.length,
    receipts,
    limitedHistory: false,
    catalogue,
    storeNames,
    allBranches: STORES.map((s) => s.id),
  };
}
