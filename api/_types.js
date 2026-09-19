/* What kind of business this is, and what that is allowed to change.

   ── The one rule ─────────────────────────────────────────────────────────

   Type controls presentation. It does not control authorization, entitlement,
   or what data exists.

   That is the specification's rule and it is worth restating here because it
   is the rule this file could most easily break. A tempting reading of "home
   business" is "hide the branch selector, hide purchasing, hide variance" —
   and every one of those would be a permission decision dressed up as a
   preference. A home baker who grows into two kitchens would find features
   they had been paying for missing, with nothing to tell them why.

   So nothing here hides a tab. A type reorders what somebody sees first, and
   that is the whole of its power. `_roles.js` decides what may be opened;
   `_tabs.js` maps that to tabs; this decides which of the permitted ones
   should lead.

   ── Why the priorities are what they are ─────────────────────────────────

   From how each kind of business actually spends its day:

   home_business  — cooks to order, sells direct. The question is what a batch
                    costs and what it should sell for, so recipes and costing
                    lead. There is rarely a till at all.
   food_truck     — one service, one queue, stock that runs out. Selling and
                    what is left lead; analysis can wait for the evening.
   cafe           — the same sale over and over with variations, where the
                    margin lives in the milk and the shot. Recipes sit beside
                    selling rather than behind it.
   restaurant     — several channels at different commissions, waste that
                    matters, and somebody whose job is to read the numbers.
                    The overview leads, as it does today.

   ── Legacy values ────────────────────────────────────────────────────────

   §7 of the specification names `home` and `truck` as values already in the
   wild that need migrating. Nothing in this repository ever wrote them, but
   the mobile client may have, and a value this file does not recognise would
   otherwise silently fall back to "no type" and reorder somebody's nav for no
   visible reason. They are mapped rather than rejected. */

export const BUSINESS_TYPES = ["home_business", "food_truck", "cafe", "restaurant"];

const LEGACY = { home: "home_business", truck: "food_truck", coffee: "cafe" };

/* Absent is a real state and not the same as "restaurant".

   An account that predates the question has never answered it, and guessing on
   its behalf would rearrange a nav somebody is used to. Null orders the tabs
   the way they have always been ordered. */
export function normaliseType(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const mapped = LEGACY[raw] || raw;
  return BUSINESS_TYPES.includes(mapped) ? mapped : null;
}

/* Which tabs lead, per type. Everything permitted and unnamed follows in the
   order it already has — this is a promotion, never a filter. */
const PRIORITY = {
  home_business: ["recipes", "costs", "inventory", "overview"],
  food_truck: ["sales", "inventory", "alerts", "overview"],
  cafe: ["sales", "recipes", "inventory", "alerts"],
  restaurant: ["overview", "sales", "menu", "plan", "inventory"],
};

export function priorityFor(type) {
  return PRIORITY[normaliseType(type)] || [];
}

/* The permitted tabs, reordered so this type's leading few come first.

   `tabs` is already the authorized list from `_tabs.js`; a priority naming a
   tab this person cannot open is skipped rather than granting it, which is the
   line between presentation and permission and the one thing in this file that
   must not be got wrong. */
export function orderTabs(type, tabs = []) {
  const permitted = tabs.filter(Boolean);
  const lead = priorityFor(type).filter((id) => permitted.includes(id));
  return [...lead, ...permitted.filter((id) => !lead.includes(id))];
}

/* ── What the client is told actually works ───────────────────────────────

   §7: "An unavailable module returns null and is absent from
   available_features." The temptation is to list everything the roadmap
   mentions so the response looks complete. §2 answers it: "Do not expose
   unfinished modules as working features."

   So this names only what exists today and is reachable by this person. There
   is no `orders` and no `channel_margin` in it, because there are no orders
   and no channel costs in this system — putting them here would make a client
   draw a screen with nothing behind it. */
const FEATURE_NEEDS = {
  inventory: "view:inventory",
  recipes: "manage:recipes",
  costs: "view:costs",
  purchasing: "manage:purchasing",
  profitability: "view:profitability",
  forecast: "view:forecast",
  staff: "manage:staff",
};

export function availableFeatures(capabilities = [], { posConnected = false } = {}) {
  const caps = Array.isArray(capabilities) ? capabilities : [];
  const out = Object.entries(FEATURE_NEEDS)
    .filter(([, need]) => caps.includes(need))
    .map(([name]) => name);

  /* Sales figures exist only where a till is connected. Listing the feature on
     an account with no connection would be describing an empty screen as an
     available module. */
  if (posConnected && caps.includes("view:dashboard")) out.push("pos_sales");

  /* The assistant is everybody's, and answers within whatever scope the caller
     already has. */
  out.push("assistant");
  return out.sort();
}
