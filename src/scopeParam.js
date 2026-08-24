/* The branch scope, as a request carries it.

   One convention, in one place: an empty selection means "every branch I'm
   authorized to see", which is exactly what the server assumes when the parameter
   is absent. So "all branches" needs no special value and no special case.

   What the client sends is only a *request*. Every route intersects it with the
   session's authorization (`effective_branches = requested ∩ authorized`), so a
   hand-edited parameter can narrow a view but never widen it. That is why passing
   the selection around like this is safe. */

export function scopeParam(branches = []) {
  if (!branches || branches.length === 0) return "";
  return branches.map(encodeURIComponent).join(",");
}

/* Appended to a query string that already has at least one parameter. */
export function scopeQuery(branches = []) {
  const value = scopeParam(branches);
  return value ? `&branches=${value}` : "";
}

/* A stable key for effect dependencies — arrays compare by identity, which would
   refetch on every render. */
export function scopeKey(branches = []) {
  return (branches || []).join(",");
}
