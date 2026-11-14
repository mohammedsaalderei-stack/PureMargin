/* The margin read: one score, and the four things worth acting on.

   All derived, none generated. The same figures always produce the same
   score and the same cards, so anything here can be checked against the
   receipts it came from. */

/* The score itself lives in `shared/purity.js`, so the Overview can score a
   picked range with the same rule the server uses for the last 30 days. */
import { pureScore } from "../shared/purity.js";

export { pureScore };

/* The single item contributing most actual profit — not most revenue.
   They're often different items, and that difference is the whole point. */
export function starProduct(m) {
  const priced = (m.items || []).filter((i) => i.hasCost && i.profit > 0);
  if (!priced.length) return null;
  return [...priced].sort((a, b) => b.profit - a.profit)[0];
}

/* High margin, low volume. These are the ones worth pushing: every extra
   sale keeps more than the average sale does. */
export function hiddenChampions(m) {
  const priced = (m.items || []).filter((i) => i.hasCost && i.qty > 0);
  if (priced.length < 3) return [];

  const qtys = priced.map((i) => i.qty).sort((a, b) => a - b);
  const medianQty = qtys[Math.floor(qtys.length / 2)];
  const avgMargin =
    priced.reduce((sum, i) => sum + i.marginPct, 0) / priced.length;

  return priced
    .filter((i) => i.marginPct > avgMargin + 8 && i.qty < medianQty)
    .sort((a, b) => b.marginPct - a.marginPct)
    .slice(0, 3);
}

/* Where margin is leaking. Each finding names the figure behind it. */
export function leakage(m) {
  const out = [];
  const priced = (m.items || []).filter((i) => i.hasCost && i.revenue > 0);

  // An item whose cost eats most of what it earns.
  const heavy = priced
    .filter((i) => i.marginPct < 25 && i.revenue > 0)
    .sort((a, b) => a.marginPct - b.marginPct)[0];
  if (heavy) {
    out.push({
      id: "cost",
      severity: heavy.marginPct < 10 ? "high" : "medium",
      values: { name: heavy.name, margin: heavy.marginPct, cost: heavy.unitCost },
    });
  }

  // Discounting that has stopped being occasional.
  const discountPct =
    m.totals.sales > 0 ? (m.totals.discounts / m.totals.sales) * 100 : 0;
  if (discountPct > 4) {
    out.push({
      id: "discounts",
      severity: discountPct > 9 ? "high" : "medium",
      values: { pct: Number(discountPct.toFixed(1)), amount: m.totals.discounts },
    });
  }

  // Costs missing on enough of the menu that the margin can't be trusted.
  if ((m.costCoverage ?? 0) < 80 && (m.missingCosts || []).length) {
    out.push({
      id: "nocost",
      severity: (m.costCoverage ?? 0) < 40 ? "high" : "medium",
      values: { count: m.missingCosts.length, coverage: m.costCoverage ?? 0 },
    });
  }

  return out.slice(0, 3);
}

export function marginLayer(m) {
  return {
    score: pureScore(m),
    star: starProduct(m),
    champions: hiddenChampions(m),
    leakage: leakage(m),
  };
}
