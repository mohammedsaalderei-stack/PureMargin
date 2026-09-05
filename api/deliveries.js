/* GET /api/deliveries — what the Loyverse webhook has actually delivered.

   Separate from `api/sales.js`, which reads the till. That one answers "what
   did we sell"; this answers "did the integration work, and what did each
   delivery do to stock". Neither can be derived from the other: a receipt can
   sit in the till having never been delivered here, and a delivery can arrive
   and deduct nothing because the dish has no recipe. Reading the till would
   show the first as though it had worked and hide the second entirely.

   `view:dashboard`, the same gate the Sales screen uses: this is the day's
   takings arriving, plus what happened to them. The rows are already scoped
   to the organization by the key, and narrowed to the caller's branches here. */

import { requireAuth } from "./_auth.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { posTokenFor } from "./_accounts.js";
import { branchList } from "./_data.js";
import { listDeliveries } from "./_receiptlog.js";
import { ingestionStatus } from "./_loyversehook.js";

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });

  try {
    /* Branches come from the POS, as everywhere. A till that will not answer
       means no roster rather than an error — the log is still readable, it
       just cannot put names to the store ids. */
    let roster = [];
    try {
      roster = await branchList(await posTokenFor(session.username));
    } catch { /* no connection, or the till is down */ }

    const scope = await scopeFor(session.account, roster.map((b) => b.id));
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });
    if (!scope.capabilities.includes("view:dashboard")) {
      return res.status(403).json({ error: "forbidden" });
    }

    const branches = effectiveBranches(parseBranchParam(req.query?.branches), scope.authorized);
    const allowed = new Set(branches.map(String));

    const rows = await listDeliveries(orgId, { limit: 200 });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      /* Whether receipts are arriving at all, so an empty list can say which
         empty it is: nothing configured, configured and never fired, or a
         quiet night. Three very different things that look identical as a
         blank screen. */
      ingestion: await ingestionStatus(orgId),
      branchNames: Object.fromEntries(roster.map((b) => [String(b.id), b.name])),
      deliveries: rows.filter((r) => !allowed.size || allowed.has(String(r.branchId))),
    });
  } catch (err) {
    console.error("deliveries endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
