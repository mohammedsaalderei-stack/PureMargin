/* Alerts and targets over HTTP — stage 4, phase 7.

   Reading needs `view:inventory`: this is the operational list, and a chef acting
   on a stockout is exactly who it is for. Changing a target needs `manage:costs` —
   a threshold decides what the whole organization is told to worry about, so it
   belongs to the owner and the accountant, not to everyone who can read it.

   GET                — alerts for the period, plus the targets in force
   PUT { targets }    — change the thresholds
*/

import { requireAuth } from "./_auth.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { posTokenFor } from "./_accounts.js";
import { branchList, salesLines, NotConnected, PosUnreachable } from "./_data.js";
import { COST_METHODS, DEFAULT_COST_METHOD } from "./_costing.js";
import { buildAlerts, saveTargets } from "./_alerts.js";
import { recordAudit } from "./_audit.js";
import { listEdits } from "./_saleedits.js";

const DAY = 864e5;

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const posToken = await posTokenFor(session.username);

    let roster = [];
    try {
      roster = await branchList(posToken);
    } catch {
      /* The stock half of these alerts doesn't need the POS at all. */
    }

    const scope = await scopeFor(session.account, roster.map((b) => b.id));
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });

    if (req.method === "PUT") {
      if (!scope.capabilities.includes("manage:costs")) return res.status(403).json({ error: "forbidden" });
      const targets = await saveTargets(orgId, req.body?.targets || {});
      /* A threshold change alters what every user is warned about, which is
         exactly the kind of sensitive change the audit log exists for. */
      await recordAudit(orgId, {
        action: "targets.update", actor: session.username, target: "targets", detail: targets,
      });
      return res.status(200).json({ targets });
    }

    if (req.method !== "GET") return res.status(405).json({ error: "Use GET or PUT." });
    if (!scope.capabilities.includes("view:inventory")) return res.status(403).json({ error: "forbidden" });

    const branches = effectiveBranches(parseBranchParam(req.query?.branches), scope.authorized);
    const to = Number(req.query?.to) > 0 ? Number(req.query.to) : Date.now();
    const from = Number(req.query?.from) > 0 ? Number(req.query.from) : to - 30 * DAY;
    const method = COST_METHODS.includes(String(req.query?.method || ""))
      ? String(req.query.method) : DEFAULT_COST_METHOD;

    /* Sales are needed for the theoretical side and the food-cost target. Without
       them the stock alerts still stand, and the response says which half is
       missing rather than presenting a partial list as complete. */
    let sales = { lines: [], fetch: null };
    let salesError = null;
    try {
      sales = await salesLines(posToken, { from, to, branches, edits: await listEdits(orgId) });
    } catch (err) {
      salesError = err instanceof NotConnected ? "notconnected"
        : err instanceof PosUnreachable ? "unreachable" : "failed";
    }

    const out = await buildAlerts(orgId, branches, { salesRows: sales.lines, from, to, method });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ...out,
      canEditTargets: scope.capabilities.includes("manage:costs"),
      branchNames: Object.fromEntries(roster.map((b) => [b.id, b.name])),
      sales: { error: salesError, ...(sales.fetch || {}) },
    });
  } catch (err) {
    console.error("alerts endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
