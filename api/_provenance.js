/* Where a set of figures came from.

   A number on a dashboard is a claim, and this is the evidence for it: which
   source, fetched when, covering what period, over which branches, from how many
   receipts, and how much of the cost data behind the margin is actually present.

   It exists because the app's numbers are used to make decisions about money. An
   owner who can't tell "no sales yesterday" from "we couldn't reach the POS
   yesterday" will eventually act on the wrong one — and the two look identical
   on a chart. Everything here is derived from what the fetch reported; nothing is
   inferred or assumed current. */

export function provenance(metrics, { role, ageSeconds, lastSync }) {
  const f = metrics.fetch || {};
  const scope = metrics.scope || {};
  const names = f.branchNames || {};

  const from = f.since ? new Date(f.since).toISOString() : null;
  /* The window the figures are actually about (the last 30 days), as distinct
     from the window fetched — the prior 30 are read only to compare against. */
  const days = f.limitedHistory ? 30 : 60;

  return {
    source: metrics.source || "Loyverse POS",
    connected: Boolean(metrics.connected),

    /* Two different times, and the difference matters: `fetchedAt` is when the
       POS was last read, `ageSeconds` how stale what you're looking at is. */
    fetchedAt: f.at ? new Date(f.at).toISOString() : null,
    ageSeconds: ageSeconds ?? null,

    period: {
      reportedDays: 30,
      fetchedDays: days,
      from,
      to: new Date().toISOString(),
      /* On plans without Unlimited Sales History there is no prior period to
         compare with, which is why some deltas are null rather than zero. */
      limitedHistory: Boolean(f.limitedHistory),
    },

    receipts: {
      /* Fetched across the whole organization, versus counted after the branch
         scope was applied. A large gap is the honest explanation for why one
         branch's total is so much smaller than the account's. */
      fetched: f.receiptCount ?? null,
      counted: metrics.totals?.receipts ?? null,
    },

    branches: {
      ids: scope.branches || [],
      names: (scope.branches || []).map((id) => names[id] || id),
      count: scope.branchCount ?? null,
      total: scope.totalBranches ?? null,
      complete: Boolean(scope.complete),
      /* Stage 2 made this true: every figure is aggregated from the scoped
         receipts, not filtered afterwards. */
      exact: Boolean(scope.exact),
    },

    costs: {
      /* Margin is only as good as its cost coverage. 100% margin nearly always
         means missing costs rather than free stock, so this travels with it. */
      coveragePct: metrics.costCoverage ?? 0,
      itemsMissingCost: (metrics.missingCosts || []).length,
      ownerEntered: f.overrideCount || 0,
    },

    viewerRole: role || null,

    /* The last real upstream read, from the sync log — which can be older than
       `fetchedAt` suggests if the POS has been failing and the cache is being
       kept warm by successful earlier reads. */
    lastSync: lastSync
      ? { at: new Date(lastSync.at).toISOString(), ok: Boolean(lastSync.ok), error: lastSync.error || null }
      : null,
  };
}
