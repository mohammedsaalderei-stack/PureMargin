/* Profit purity: one score for how much of each sale a kitchen keeps, and
   whether trade is holding up.

   Shared because two places work it out from the same rule. The server
   scores the last 30 days for every metrics payload (`api/_margin.js`); the
   Overview scores whichever range is picked (today, 7 days, 90 days...) from
   the day rows. One formula, so the ring can never disagree with itself
   depending on which side drew it. Pure: no imports, no I/O. */

/* The margin scored here is GROSS margin: sales without VAT less the cost of
   the food in them. For a restaurant that is normally 60–75% (food cost
   25–40%), so these bounds are food-cost bounds read the other way round.

   They used to be 12% and 30%, which are net-margin numbers. Every kitchen
   above a 30% gross margin — nearly all of them — got full marks, and the
   score sat at 83 whatever the menu cost.

   GOOD_MARGIN 70 = food cost 30%, the target the food-cost card and the
   default alert target (`api/_alerts.js`) already use. Full marks.
   THIN_MARGIN 55 = food cost 45%, past the point most operators treat as a
   problem. Nothing for margin.
   Linear between, so 62.5% (food cost 37.5%) is half marks. */
const GOOD_MARGIN = 70;
const THIN_MARGIN = 55;

/* The score blends how much is kept with whether trade is holding up,
   because a healthy margin on collapsing sales isn't health. When there is
   no earlier period to compare with, it is margin alone, and says so. */
const MARGIN_WEIGHT = 0.65;
const TREND_WEIGHT = 0.35;

export function pureScore(m) {
  const coverage = m.costCoverage ?? 0;
  /* Scored on the dishes whose cost is known. The headline margin counts an
     uncosted dish as free, so a menu half-costed would score as if the other
     half made pure profit. */
  const margin = m.totals.costedMarginPct ?? m.totals.marginPct ?? 0;

  /* Without cost data the margin is fiction, so the score says so rather
     than reporting a confident 100. */
  if (coverage < 25) {
    return { value: null, state: "nocost", coverage };
  }

  const marginPart = Math.max(0, Math.min(1, (margin - THIN_MARGIN) / (GOOD_MARGIN - THIN_MARGIN)));

  /* No earlier period (a business in its first month, or a range whose
     period before it sold nothing) is not flat trade. Scoring it as a
     neutral half used to hand every new business the same 17.5 points, so
     the score is margin alone and `noTrend` lets the screen say why. */
  const delta = m.totals.salesDelta;
  const noTrend = typeof delta !== "number" || !Number.isFinite(delta);

  /* Trend: flat is neutral, growth adds, decline subtracts. Capped at ±20%
     so one freak week can't dominate the score in either direction. */
  const trendPart = noTrend ? null : Math.max(0, Math.min(1, 0.5 + delta / 40));

  const value = noTrend
    ? Math.round(marginPart * 100)
    : Math.round((marginPart * MARGIN_WEIGHT + trendPart * TREND_WEIGHT) * 100);

  const state =
    value >= 75 ? "strong" : value >= 50 ? "steady" : value >= 30 ? "watch" : "weak";

  return { value, state, coverage, margin, marginPart, trendPart, noTrend };
}
