import { requireAuth } from "./_auth.js";
import { getMetrics, NotConnected } from "./_data.js";
import { getJSON } from "./_store.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { applyScope } from "./_scope-metrics.js";
import { provenance } from "./_provenance.js";
import { lastSync } from "./_sync.js";
import { listEdits } from "./_saleedits.js";
import { netProfit } from "./_profit.js";
import { registerContext, rosterFor } from "./_till.js";
import { menuCosts } from "./_recipes.js";

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
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
    /* A longer period than the usual 30 days, when the overview asks for one:
       90 days, a year, or everything since the first sale. Sales are the
       register's own, so how far back is up to the business, not a till's
       API. Anything else asked for is the usual 30 days. */
    const asked = String(req.query?.period || "");
    const PERIODS = { 90: 90, 365: 365 };
    /* The business's sales, and its own stores as the branches. */
    const { register, names, firstSaleAt } = await registerContext(session.account, {
      days: asked === "all" ? "all" : PERIODS[asked] ? PERIODS[asked] * 2 + 2 : undefined,
    });
    const DAY = 864e5;
    const historyDays = firstSaleAt ? Math.max(1, Math.ceil((Date.now() - firstSaleAt) / DAY)) : 0;
    const period = asked === "all"
      ? { key: "all", days: Math.max(31, historyDays) }
      : PERIODS[asked] ? { key: asked === "90" ? "quarter" : "year", days: PERIODS[asked] } : null;
    const allBranches = (await rosterFor(session.account)).map((b) => b.id);
    const scope = await scopeFor(session.account, allBranches);
    const effective = effectiveBranches(parseBranchParam(req.query?.branches), scope.authorized);

    /* Owner corrections to what the till reported. Loaded per organization and
       applied inside the aggregation, so a voided sale is absent from every
       series rather than subtracted from the headline alone. */
    const edits = await listEdits(scope.org?.id);

    /* Each dish's cost from its recipe, priced from the deliveries the
       branches in view actually received — the same figure the Recipes
       screen shows. Without it every dish read as costing nothing. */
    const costs = await menuCosts(scope.org?.id, effective);

    const metrics = await getMetrics({
      overrides,
      edits,
      register,
      names,
      costs,
      timeZone: scope.org?.timezone || "Asia/Dubai",
      period,
      branches: effective,
    });
    const scoped = applyScope(metrics, effective, allBranches);

    const { fetch: _fetch, allBranches: _all, ...payload } = scoped;

    /* What the business actually kept, for whoever is allowed to see it.

       Gated on `view:profitability` rather than sent to everyone and hidden in
       the browser: overheads are rent and wages, and a cashier's device should
       not be holding the payroll bill in a JSON response it was told not to
       draw. The same capability already gates the margin screens.

       Computed through `_profit.js`, which the assistant also calls, so the
       dashboard and an answer to "what did I make last month" cannot come out
       differently. It is not aggregated per branch: rent belongs to the
       business, and dividing it between branches is an allocation rule nobody
       has stated. When the view is narrowed to one branch the sales half would
       shrink while the overheads did not, so the figure is simply withheld
       rather than shown wrong. */
    const wholeBusiness = effective.length === 0 || effective.length === allBranches.length;
    const profit = scope.capabilities.includes("view:profitability") && wholeBusiness
      ? await netProfit(scope.org?.id, {
        /* Without VAT, which is owed, not earned; and coverage as the 0–1
           share `netProfit` expects. It was handed the percentage, so 78%
           costed read as 78 and the "this is an upper bound" warning, which
           checks for less than 1, never showed. */
        netSales: payload.totals?.salesExVat ?? payload.totals?.sales ?? 0,
        cogs: payload.totals?.cost ?? 0,
        coverage: Number.isFinite(payload.costCoverage) ? payload.costCoverage / 100 : null,
      })
      : null;

    // Never cached at the edge: the whole point is that it changes.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ...payload,
      /* How far back this business's sales go, so the screen can say where a
         long period starts rather than drawing a flat line with a confident
         label. */
      firstSaleAt: firstSaleAt ? new Date(firstSaleAt + 7 * DAY).toISOString() : null,
      profit,
      scope: { ...scoped.scope, role: scope.role },
      ageSeconds: 0,
      provenance: provenance(scoped, {
        role: scope.role,
        ageSeconds: 0,
        lastSync: await lastSync(scope.org?.id),
      }),
    });
  } catch (err) {
    if (err instanceof NotConnected) {
      return res.status(409).json({ error: "notconnected" });
    }
    console.error("metrics failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
