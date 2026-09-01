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
  /* The costs package: everything that reads money rather than stock.

     The id used to be `billscan`, from when the only thing in it was a bill
     scanner. There is no scanner in it now — it is the cost ledger, the
     corrections to what the till reported, menu engineering and the forecast.
     Retired ids are translated forward in `entitlements()` below, so an
     account that bought `billscan` still opens all four. */
  menu: "costs",
  forecast: "costs",
  costs: "costs",
  sales: "costs",
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

/* Package ids that were retired, and what they mean now.

   Kept in step with `LEGACY_FEATURES` in `api/_accounts.js` — the server is
   authoritative, but the client decides which tabs to draw, and a client that
   did not know `billscan` means `costs` would grey out four screens the
   account still has. `pos_hardware` maps to nothing: it never gated a screen,
   so an account holding it loses no access.

   Deliberately a translation on read, never a rewrite. The stored record keeps
   saying what was actually sold. */
const LEGACY_FEATURES = {
  billscan: "costs",
  menu: "costs",
  forecast: "costs",
  pos_hardware: null,
};

export function normaliseFeatures(items = []) {
  const out = [];
  for (const raw of items) {
    const id = Object.prototype.hasOwnProperty.call(LEGACY_FEATURES, raw)
      ? LEGACY_FEATURES[raw]
      : raw;
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/* Demo sessions — the shared-password route with no registered account —
   are deliberately ungated, so single-tenant deployments keep working
   exactly as they did before packages existed. */
export function entitlements(account) {
  const registered = Boolean(account?.account);
  const paid = normaliseFeatures(account?.account?.plan?.items || []);
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
