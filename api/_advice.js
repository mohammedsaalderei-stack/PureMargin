/* Recommendations, derived rather than generated.
   Each one names the figures it rests on, states how confident it is and why,
   gives an execution plan, says what to watch and when to measure, and carries
   a caution. Nothing here is invented by a model: the same numbers always
   produce the same advice, which is what makes it checkable. */

const DAY = 864e5;

/* Confidence is a function of how much evidence sits behind the claim.
   A recommendation about an item that sold ten units is not the same
   kind of claim as one about an item that sold four hundred. */
function confidence({ receipts, units, freshHours }) {
  if (receipts >= 400 && units >= 60 && freshHours <= 48) return "high";
  if (receipts >= 150 && units >= 20) return "medium";
  return "low";
}

function basis(m, units, days = 30) {
  return { receipts: m.totals.receipts, units, days };
}

export function buildAdvice(m) {
  const out = [];
  const freshHours = 1;
  const items = m.menu?.items || [];
  const money = (n) => Math.round(n);

  /* 1. Protect the strongest earner. */
  const star = [...items].sort((a, b) => b.revenue - a.revenue)[0];
  if (star) {
    out.push({
      id: "protect-top",
      kind: "protect",
      subject: star.name,
      confidence: confidence({ receipts: m.totals.receipts, units: star.qty, freshHours }),
      figures: [
        { key: "sales", value: money(star.revenue) },
        { key: "qty", value: star.qty },
        { key: "perOrder", value: star.perUnit },
      ],
      period: { from: m.daily[0]?.date, to: m.daily[m.daily.length - 1]?.date },
      basis: basis(m, star.qty),
      measureInDays: 14,
    });
  }

  /* 2. Review the weakest item before cutting it. */
  const weakest = [...items].sort((a, b) => a.revenue - b.revenue)[0];
  if (weakest && weakest.name !== star?.name) {
    out.push({
      id: "review-weak",
      kind: "review",
      subject: weakest.name,
      confidence: confidence({ receipts: m.totals.receipts, units: weakest.qty, freshHours }),
      figures: [
        { key: "sales", value: money(weakest.revenue) },
        { key: "qty", value: weakest.qty },
        { key: "perOrder", value: weakest.perUnit },
      ],
      period: { from: m.daily[0]?.date, to: m.daily[m.daily.length - 1]?.date },
      basis: basis(m, weakest.qty),
      measureInDays: 14,
    });
  }

  /* 3. Fill the quietest trading hour. */
  const active = m.hours.filter((h) => h.receipts > 0);
  const quiet = [...active].sort((a, b) => a.receipts - b.receipts)[0];
  const peak = [...active].sort((a, b) => b.receipts - a.receipts)[0];
  if (quiet && peak && peak.receipts > quiet.receipts * 2) {
    out.push({
      id: "fill-quiet",
      kind: "hours",
      subject: quiet.label,
      /* The claim is about the quiet hour, so the evidence is the quiet
         hour's own order count — not the peak's. Stating one and scoring
         the other is how a four-order claim ends up labelled "high". */
      confidence: confidence({ receipts: quiet.receipts, units: quiet.receipts, freshHours }),
      figures: [
        { key: "quietOrders", value: quiet.receipts },
        { key: "peakOrders", value: peak.receipts },
        { key: "peakHour", value: peak.label },
      ],
      period: { from: m.daily[0]?.date, to: m.daily[m.daily.length - 1]?.date },
      basis: basis(m, quiet.receipts),
      measureInDays: 21,
    });
  }

  /* 4. Close the gap between branches. */
  if (m.stores.length >= 2) {
    const top = m.stores[0];
    const bottom = m.stores[m.stores.length - 1];
    if (bottom.sales > 0 && top.sales / bottom.sales >= 1.3) {
      out.push({
        id: "branch-gap",
        kind: "branch",
        subject: bottom.name,
        confidence: confidence({ receipts: bottom.receipts, units: bottom.receipts, freshHours }),
        figures: [
          { key: "sales", value: money(bottom.sales) },
          { key: "topBranch", value: top.name },
          { key: "gap", value: Math.round(((top.sales - bottom.sales) / bottom.sales) * 100) },
        ],
        period: { from: m.daily[0]?.date, to: m.daily[m.daily.length - 1]?.date },
        basis: basis(m, bottom.receipts),
        measureInDays: 30,
      });
    }
  }

  /* 5. Concentration risk — one dish carrying too much. */
  if (star && star.revenue / (m.totals.sales || 1) > 0.22) {
    out.push({
      id: "concentration",
      kind: "risk",
      subject: star.name,
      confidence: confidence({ receipts: m.totals.receipts, units: star.qty, freshHours }),
      figures: [
        { key: "share", value: Math.round((star.revenue / m.totals.sales) * 100) },
        { key: "sales", value: money(star.revenue) },
      ],
      period: { from: m.daily[0]?.date, to: m.daily[m.daily.length - 1]?.date },
      basis: basis(m, star.qty),
      measureInDays: 30,
    });
  }

  /* Never return nothing. A quiet month is itself worth remarking on, and
     an empty screen tells someone their app is broken rather than their
     week being thin. */
  if (out.length === 0) {
    out.push({
      id: "early",
      kind: "early",
      subject: String(m.totals.receipts),
      confidence: "low",
      figures: [
        { key: "sales", value: Math.round(m.totals.sales) },
        { key: "qty", value: m.totals.receipts },
        { key: "perOrder", value: Math.round(m.totals.avgTicket) },
      ],
      period: { from: m.daily[0]?.date, to: m.daily[m.daily.length - 1]?.date },
      basis: basis(m, m.totals.receipts),
      measureInDays: 14,
    });
  }

  return out.slice(0, 4);
}

export { DAY };
