/* Theoretical versus actual, over HTTP — stage 4, phase 6.

   `view:costs` reads it: this is a costing answer, so the accountant and the owner
   both get it, and it is read-only by nature — there is nothing here to write.

   The sales half comes from the POS, the actual half from the ledger, and both are
   restricted to the same intersected branch list, so the two sides of every
   comparison cover exactly the same ground. A branch manager asking this question
   gets their own kitchen; the owner gets the group in one answer, with the branch
   split kept on each row.

   GET ?from=&to=&method=  — the report for a period
*/

import { requireAuth } from "./_auth.js";
import { getMeta } from "./_inventory.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { posTokenFor } from "./_accounts.js";
import { branchList, salesLines, NotConnected, PosUnreachable } from "./_data.js";
import { COST_METHODS, DEFAULT_COST_METHOD } from "./_costing.js";
import { varianceReport } from "./_variance.js";
import { listEdits } from "./_saleedits.js";

const DAY = 864e5;

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });

  try {
    const posToken = await posTokenFor(session.username);

    let roster = [];
    try {
      roster = await branchList(posToken);
    } catch {
      /* No POS, or unreachable. The ledger half still works and says so below. */
    }

    const scope = await scopeFor(session.account, roster.map((b) => b.id));
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });
    if (!scope.capabilities.includes("view:costs")) return res.status(403).json({ error: "forbidden" });

    const branches = effectiveBranches(parseBranchParam(req.query?.branches), scope.authorized);

    /* Defaults to the last 30 days — the window the rest of the platform reports
       on, so the food-cost percentage here is comparable with the dashboard's. */
    const to = Number(req.query?.to) > 0 ? Number(req.query.to) : Date.now();
    const from = Number(req.query?.from) > 0 ? Number(req.query.from) : to - 30 * DAY;
    const method = COST_METHODS.includes(String(req.query?.method || ""))
      ? String(req.query.method) : DEFAULT_COST_METHOD;

    /* The sales side is allowed to be missing. When it is, the report still shows
       actual usage and says plainly that theoretical is unavailable — the document
       is explicit that an incomplete answer must state what's missing rather than
       present a confident one. */
    let sales = { lines: [], fetch: null };
    let salesError = null;
    try {
      sales = await salesLines(posToken, { from, to, branches, edits: await listEdits(orgId) });
    } catch (err) {
      salesError = err instanceof NotConnected ? "notconnected"
        : err instanceof PosUnreachable ? "unreachable" : "failed";
    }

    const report = await varianceReport(orgId, branches, {
      salesRows: sales.lines, from, to, method,
    });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      /* So the screen can explain why the unexplained column is quiet: with
         automatic depletion on, usage is derived from sales and the gap is
         found by counting instead. Without this the number reads as good news. */
      autoDepleteFromSales: (await getMeta(orgId)).autoDepleteFromSales,
      ...report,
      branchNames: Object.fromEntries(roster.map((b) => [b.id, b.name])),
      /* Provenance for the sales half: when it was fetched, how far back it
         reaches, and whether the POS truncated the window — which would
         understate theoretical usage. */
      sales: { error: salesError, ...(sales.fetch || {}) },
    });
  } catch (err) {
    console.error("variance endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
