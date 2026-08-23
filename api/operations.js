/* The operational plan over HTTP — stage 5.

   `view:forecast` reads the purchase plan and `view:profitability` the branch
   ranking; a chef who can see neither still gets the alerts screen, which is the
   list they act on. Both halves are computed for the intersected branch scope, so
   an owner gets the group and a branch manager gets their own kitchen from the same
   call — the document's "one dashboard, many branches" rule, not one session per
   branch.

   GET ?from=&to=&horizon=&method=
*/

import { requireAuth } from "./_auth.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { posTokenFor } from "./_accounts.js";
import { branchList, salesLines, NotConnected, PosUnreachable } from "./_data.js";
import { COST_METHODS, DEFAULT_COST_METHOD } from "./_costing.js";
import { purchasePlan, branchRanking } from "./_operations.js";
import { getTargets } from "./_alerts.js";

const DAY = 864e5;
/* Sales older than this make a forecast a description of history rather than a
   prediction, which the document says must lower confidence rather than pass
   unmentioned. */
const STALE_MS = 12 * 36e5;

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
      /* The purchase plan runs off the ledger and needs no POS at all. */
    }

    const scope = await scopeFor(session.account, roster.map((b) => b.id));
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });

    const canPlan = scope.capabilities.includes("view:forecast");
    const canRank = scope.capabilities.includes("view:profitability");
    if (!canPlan && !canRank) return res.status(403).json({ error: "forbidden" });

    const branches = effectiveBranches(parseBranchParam(req.query?.branches), scope.authorized);
    const to = Number(req.query?.to) > 0 ? Number(req.query.to) : Date.now();
    const from = Number(req.query?.from) > 0 ? Number(req.query.from) : to - 30 * DAY;
    const horizonDays = Math.min(30, Math.max(1, Number(req.query?.horizon) || 7));
    const method = COST_METHODS.includes(String(req.query?.method || ""))
      ? String(req.query.method) : DEFAULT_COST_METHOD;

    let sales = { lines: [], fetch: null };
    let salesError = null;
    try {
      sales = await salesLines(posToken, { from, to, branches });
    } catch (err) {
      salesError = err instanceof NotConnected ? "notconnected"
        : err instanceof PosUnreachable ? "unreachable" : "failed";
    }

    /* Stale or absent sales don't stop the plan; they downgrade its confidence,
       which is what the reader needs to know. */
    const stale = Boolean(salesError) ||
      (sales.fetch?.at ? Date.now() - sales.fetch.at > STALE_MS : false);

    const targets = await getTargets(orgId);

    const plan = canPlan
      ? await purchasePlan(orgId, branches, { from, to, horizonDays, targets, stale })
      : null;

    /* The ranking needs sales split per branch, because a branch's food cost
       percentage is its own sales against its own usage. */
    const salesByBranch = new Map();
    for (const line of sales.lines) {
      const rows = salesByBranch.get(line.branchId) || [];
      rows.push(line);
      salesByBranch.set(line.branchId, rows);
    }

    const ranking = canRank
      ? await branchRanking(orgId, branches, { salesByBranch, from, to, method, targets })
      : null;

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      plan,
      ranking: ranking?.rows || null,
      targets,
      period: { from, to, horizonDays },
      branches,
      branchNames: Object.fromEntries(roster.map((b) => [b.id, b.name])),
      /* Provenance and staleness, so a recommendation is never read as fresher
         than the data under it. */
      sales: { error: salesError, stale, ...(sales.fetch || {}) },
    });
  } catch (err) {
    console.error("operations endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
