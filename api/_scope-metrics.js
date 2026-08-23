/* Applying a branch scope to a metrics payload.

   The POS is queried once for the whole organization, so scoping happens on
   the aggregate that comes back. What can be narrowed exactly is narrowed;
   what cannot is labelled rather than quietly passed off as branch-specific.

   That distinction matters more than it looks. `stores` carries real per-branch
   sales and orders, so a branch total is exact. The item, daily and hourly
   series are aggregated across branches upstream in `_data.js`, so for a
   partial scope they are still organization-wide numbers. Presenting them as
   one branch's figures would be a wrong number with a confident label — the
   direction document asks for the opposite: say what is missing. So the
   response carries a `scope` block the interface can read, and the fields that
   aren't branch-exact are listed in it by name. */

/* Branch-exact fields, recomputed from the per-branch rows. */
function totalsFromStores(stores) {
  const sales = stores.reduce((s, b) => s + (Number(b.sales) || 0), 0);
  const receipts = stores.reduce((s, b) => s + (Number(b.receipts) || 0), 0);
  return { sales, receipts, avgTicket: receipts ? sales / receipts : 0 };
}

/* Aggregated upstream across all branches; cannot be split here. */
const ORG_WIDE_FIELDS = ["items", "daily", "hours", "payments", "today", "extras", "advice"];

export function applyScope(metrics, effective, allBranchIds) {
  const all = (allBranchIds || []).map(String);
  const scoped = (effective || []).map(String);

  /* Whole organization, or an organization with a single branch: the payload
     already is the answer. */
  const complete = scoped.length === all.length;

  const allowed = new Set(scoped);
  const stores = (metrics.stores || []).filter((s) => allowed.has(String(s.id)));

  const scope = {
    branches: scoped,
    branchCount: scoped.length,
    totalBranches: all.length,
    complete,
    /* Non-exact fields, named. An empty list means every figure in the payload
       matches the requested scope. */
    orgWideFields: complete ? [] : ORG_WIDE_FIELDS.filter((f) => metrics[f] !== undefined),
  };

  if (complete) return { ...metrics, stores, scope };

  /* A narrowed scope: the headline figures come from the branch rows, which
     are the only branch-exact source available. */
  const t = totalsFromStores(stores);
  return {
    ...metrics,
    stores,
    totals: {
      ...metrics.totals,
      sales: Math.round(t.sales),
      receipts: t.receipts,
      avgTicket: Math.round(t.avgTicket),
      /* Deltas and margin are derived from series this module can't split, so
         they'd be organization-wide values wearing a branch label. */
      salesDelta: null,
      receiptsDelta: null,
      avgTicketDelta: null,
    },
    scope,
  };
}
