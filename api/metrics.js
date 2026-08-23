import { requireAuth } from "./_auth.js";
import { getMetrics, branchList, cacheAge, NotConnected, PosUnreachable } from "./_data.js";
import { posTokenFor } from "./_accounts.js";
import { getJSON } from "./_store.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { applyScope } from "./_scope-metrics.js";

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const posToken = await posTokenFor(session.username);
    // ?fresh=1 skips the cache — used by the manual refresh button.
    const fresh = String(req.query?.fresh || "") === "1";
    const overrides = (await getJSON(`costs:${session.username}`)) || {};
    /* Branch scope. The POS reports which branches exist; the session decides
       which of those this user may read; the query string may only narrow that
       set further. A ?branches= value naming a branch outside the user's scope
       drops out of the intersection instead of being honoured or raising — the
       same request from an owner and from a branch manager is answered with
       each one's own scope.

       The branch roster is read first, so the scope is resolved before any
       figures are aggregated: the receipts outside it are never counted, rather
       than counted and filtered afterwards. */
    const allBranches = (await branchList(posToken)).map((b) => b.id);
    const scope = await scopeFor(session.account, allBranches);
    const effective = effectiveBranches(parseBranchParam(req.query?.branches), scope.authorized);

    const metrics = await getMetrics(posToken, {
      overrides,
      branches: effective,
      ...(fresh ? { maxAge: 0 } : {}),
    });
    const scoped = applyScope(metrics, effective, allBranches);

    // Never cached at the edge: the whole point is that it changes.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ...scoped,
      scope: { ...scoped.scope, role: scope.role },
      ageSeconds: cacheAge(posToken) ?? 0,
    });
  } catch (err) {
    if (err instanceof NotConnected) {
      return res.status(409).json({ error: "notconnected" });
    }
    if (err instanceof PosUnreachable) {
      return res.status(502).json({ error: "pos", detail: err.detail });
    }
    console.error("metrics failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
