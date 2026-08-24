/* Scope metadata for a metrics payload.

   Since aggregation moved into `_aggregate.js`, a scoped payload is computed
   from the scoped receipts, so every figure in it — items, daily, hourly,
   totals — genuinely belongs to the requested branches. This module no longer
   has to withhold or relabel anything; it filters the branch roster to what the
   user may see and records which scope produced the numbers, so the interface
   can say what it is showing and the figure can be traced back to it.

   That provenance is the point: a total is only meaningful with the branch set
   and period it came from attached. */

export function applyScope(metrics, effective, allBranchIds) {
  const all = (allBranchIds || []).map(String);
  const scoped = (effective || []).map(String);
  const allowed = new Set(scoped);

  return {
    ...metrics,
    /* A branch outside the scope is absent, not flagged — a greyed-out row
       still discloses that a branch exists and what it's called. */
    stores: (metrics.stores || []).filter((s) => allowed.has(String(s.id))),
    scope: {
      branches: scoped,
      branchCount: scoped.length,
      totalBranches: all.length,
      /* Whether the figures cover the whole organization, which is what lets
         the interface label a total "all branches" instead of guessing. */
      complete: all.length > 0 && scoped.length === all.length,
      /* Every figure is aggregated from the scoped receipts. Kept as an
         explicit flag rather than left implicit, because the honest answer used
         to be "no" and anything reading this payload should be able to tell. */
      exact: true,
    },
  };
}
