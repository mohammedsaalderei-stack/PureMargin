import { requireAuth } from "./_auth.js";
import { scopeFor } from "./_org.js";
import { recordAudit } from "./_audit.js";
import { listCosts, saveCost, endCost, deleteCost, costsFor, monthlyTotal } from "./_fixedcosts.js";

/* Rent, salaries and the rest of what goes out regardless of trade.

   GET     ?from&to   — the list, and what it comes to over that window
   POST               — add or amend one
   DELETE  ?id&end=1  — end it from today, keeping the history
   DELETE  ?id        — remove it entirely

   Two ways out on purpose. Ending is the honest one: rent that stopped in
   March still applied in February, and a report over February has to keep
   costing it. Deleting is for the entry that should never have existed —
   a typo, a duplicate — where keeping it would only ever mislead. */

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const scope = await scopeFor(session.account, []);
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });

    /* Reading is part of knowing what a branch costs to run, so anybody who
       can see the dashboard can see these. Changing them is the owner's:
       salaries are on this screen. */
    const mayRead = scope.capabilities.includes("view:dashboard");
    const mayWrite = scope.capabilities.includes("manage:billing")
      || scope.capabilities.includes("manage:users");
    if (!mayRead) return res.status(403).json({ error: "forbidden" });

    if (req.method === "GET") {
      const { from, to } = req.query || {};
      const costs = await listCosts(orgId, { includeEnded: req.query?.all === "1" });
      const window = from && to
        ? await costsFor(orgId, {
          from: Number(from), to: Number(to), branches: scope.authorized,
        })
        : { total: 0, lines: [] };
      /* `monthly` is what the simplified screen shows: every entry expressed
         as what it costs in a month, added up. `window` stays alongside it
         because a report over an arbitrary date range still needs the per-day
         apportionment, and the two answer different questions. */
      return res.status(200).json({ costs, window, monthly: monthlyTotal(costs), mayWrite });
    }

    if (!mayWrite) return res.status(403).json({ error: "notowner" });

    if (req.method === "POST") {
      const { cost, error } = await saveCost(orgId, req.body || {});
      if (error) return res.status(400).json({ error });
      await recordAudit(orgId, {
        actor: session.username,
        action: "fixedcost.save",
        target: cost.id,
        detail: { name: cost.name, amount: cost.amount, period: cost.period },
      });
      return res.status(200).json({ cost });
    }

    if (req.method === "DELETE") {
      const id = String(req.query?.id || "");
      if (!id) return res.status(400).json({ error: "id" });

      const out = req.query?.end === "1"
        ? await endCost(orgId, id)
        : await deleteCost(orgId, id);
      if (out.error) return res.status(404).json({ error: out.error });

      await recordAudit(orgId, {
        actor: session.username,
        action: req.query?.end === "1" ? "fixedcost.end" : "fixedcost.delete",
        target: id,
        detail: {},
      });
      return res.status(200).json(out);
    }

    return res.status(405).json({ error: "Use GET, POST or DELETE." });
  } catch (err) {
    console.error("fixed costs failed:", err?.message || err);
    return res.status(500).json({ error: "server" });
  }
}
