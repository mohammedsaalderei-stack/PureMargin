import { requireAuth } from "./_auth.js";
import { scopeFor } from "./_org.js";
import { recordAudit } from "./_audit.js";
import { listCosts, saveCost, endCost, deleteCost, monthlyEquivalent, monthlyTotal } from "./_fixedcosts.js";

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
      const costs = await listCosts(orgId, { includeEnded: req.query?.all === "1" });

      /* Each row carries what it comes to in a month, worked out here.

         The screen used to derive this itself — a chain of period checks
         beside the row — which made two implementations of one rule. They had
         already drifted: this file knew about weekly entries and the screen
         did not, so a weekly cost was listed as "a year". One answer, computed
         where the rule lives, and the screen renders what it is given.

         The response also used to carry a `window`: every cost apportioned
         across an arbitrary date range, per day. Nothing ever read it. The
         screen sent ?from&to on every load, the server walked the whole ledger
         to build it, and the result was discarded — so it is gone, along with
         the per-day rate table behind it. */
      return res.status(200).json({
        costs: costs.map((c) => ({ ...c, monthlyAmount: monthlyEquivalent(c) })),
        monthly: monthlyTotal(costs),
        mayWrite,
      });
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
