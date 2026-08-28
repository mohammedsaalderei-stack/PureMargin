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
  /* Menu engineering and the forecast were sold as packages of their own, and
     the pricing page no longer offers them — somebody who signed up saw two
     items on their Packages screen that they could not have bought and could
     not find a price for. Both are readings of trading performance against
     cost, which is what the Costs package is, so that is where they belong. */
  menu: "billscan",
  forecast: "billscan",
  // The AI bill scanner is its own package.
  costs: "billscan",
  // Team administration is gated by role, not by plan.
  team: null,
  /* The team board is never gated. It is how the people in an organization
     reach each other, and putting that behind a package would mean an expired
     plan silently cuts a restaurant's staff off from their own announcements. */
  messages: null,
  /* The back-of-house suite — inventory, recipes, leakage, alerts and the
     purchase plan — is one package. Role capabilities still decide who inside
     a team sees which of these screens. */
  inventory: "operations",
  recipes: "operations",
  variance: "operations",
  alerts: "operations",
  plan: "operations",
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
