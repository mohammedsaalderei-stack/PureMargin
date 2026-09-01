import { requireAuth } from "./_auth.js";
import { scopeFor } from "./_org.js";
import { recordAudit } from "./_audit.js";
import { listVarCosts, saveVarCost, deleteVarCost, totalOf } from "./_varcosts.js";

/* One-off spends, by day.

   GET     ?month=YYYY-MM  — that month's entries and their total
   POST                    — add one, or amend one by id
   DELETE  ?id             — remove it

   The same read/write split as the constant costs beside it: anybody who can
   see the dashboard can read what the place costs to run, and changing the
   numbers belongs to whoever runs the account. */

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const scope = await scopeFor(session.account, []);
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });

    const mayRead = scope.capabilities.includes("view:dashboard");
    const mayWrite = scope.capabilities.includes("manage:billing")
      || scope.capabilities.includes("manage:users");
    if (!mayRead) return res.status(403).json({ error: "forbidden" });

    if (req.method === "GET") {
      const month = /^\d{4}-\d{2}$/.test(String(req.query?.month || ""))
        ? String(req.query.month)
        : null;
      const costs = await listVarCosts(orgId, { month });
      return res.status(200).json({ costs, total: totalOf(costs), month, mayWrite });
    }

    if (!mayWrite) return res.status(403).json({ error: "notowner" });

    if (req.method === "POST") {
      const { cost, created, error } = await saveVarCost(orgId, req.body || {});
      if (error) return res.status(400).json({ error });
      await recordAudit(orgId, {
        actor: session.username,
        action: created ? "varcost.add" : "varcost.update",
        target: cost.id,
        detail: { title: cost.title, amount: cost.amount, date: cost.date },
      });
      return res.status(200).json({ cost });
    }

    if (req.method === "DELETE") {
      const id = String(req.query?.id || "");
      if (!id) return res.status(400).json({ error: "id" });

      const out = await deleteVarCost(orgId, id);
      if (out.error) return res.status(404).json({ error: out.error });

      await recordAudit(orgId, {
        actor: session.username,
        action: "varcost.delete",
        target: id,
        detail: {},
      });
      return res.status(200).json(out);
    }

    return res.status(405).json({ error: "Use GET, POST or DELETE." });
  } catch (err) {
    console.error("variable costs failed:", err?.message || err);
    return res.status(500).json({ error: "server" });
  }
}
