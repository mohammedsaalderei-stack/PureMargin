/* What the signed-in account is allowed to see.

   The dashboard is free for everyone. Someone who has connected their POS
   can read their own week without paying — that's what makes the paid
   pieces worth buying. Settings and Packages are never gated either: an
   account locked out of everything still needs to reach its own account. */
export const FREE_FEATURES = ["table"];

export const SCREEN_FEATURE = {
  overview: "table",
  ask: "assistant",
  advice: "assistant",
  watch: "table",
  menu: "menu",
  forecast: "forecast",
  settings: null,
  billing: null,
};

/* Demo sessions — the shared-password route with no registered account —
   are deliberately ungated, so single-tenant deployments keep working
   exactly as they did before packages existed. */
export function entitlements(account) {
  const registered = Boolean(account?.account);
  const paid = account?.account?.plan?.items || [];
  const items = [...new Set([...FREE_FEATURES, ...paid])];
  return {
    registered,
    items,
    paid,
    expired: Boolean(account?.account?.plan?.expired),
    has: (feature) => !registered || !feature || items.includes(feature),
    /* "Has bought something", used to decide whether to open on Packages. */
    any: !registered || paid.length > 0,
  };
}
