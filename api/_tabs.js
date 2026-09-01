import { ROLES, ROLE_KEYS } from "./_roles.js";

/* Which tab needs what, and the exceptions an owner can make.

   The map lives on the server because it has to be the same answer twice: the
   nav decides what to draw from it, and the API decides what to serve. Keeping
   a second copy in the browser is how those two drift, and a tab that draws but
   cannot fetch is read as the software being broken rather than as a door that
   was never open.

   `null` means everybody. The assistant answers within whatever scope the
   caller already has, the board is how the team reaches each other, and
   settings is a person's own account. Everything else is earned. */
export const TAB_ACCESS = {
  /* The dashboard leads with net margin, carries food cost and a profitability
     score, and is the one screen where the money is largest on the page. That
     is not a till view. A cashier holding `view:dashboard` was being shown the
     business's margin because the tab happened to be named "overview" — the
     capability was right and the tab was mapped to the wrong one.

     Their landing screen is Cost calculation instead, which is the work they
     actually do: scan a bill, see it priced. */
  overview: "view:profitability",
  costs: "view:dashboard",
  ask: null,
  inventory: "view:inventory",
  alerts: "view:inventory",
  plan: "manage:purchasing",
  recipes: "manage:recipes",
  /* Leakage is shelved rather than deleted.

     It compares what the ledger says left the store against what sales say
     should have — and with automatic depletion on by default, consumption is
     now written from those same sales, so both sides are the same number and
     the screen reads zero however much is being wasted. Showing a screen that
     is structurally incapable of finding anything is worse than not showing
     it: a column of zeros looks like good news.

     The endpoint, the calculation and its tests all stay. Restoring it is
     putting this line back, which is what it should be if counting the shelf
     ever becomes the primary way leakage is found. */
  // variance: "view:costs",
  watch: "view:profitability",
  menu: "view:profitability",
  forecast: "view:forecast",
  advice: "view:profitability",
  messages: null,
  team: "manage:users",
  billing: "manage:billing",
  settings: null,
};

export const TAB_KEYS = Object.keys(TAB_ACCESS);

/* Tabs an owner should not be able to hand out.

   Team administration and billing are not views, they are controls: granting
   Team lets somebody change roles, which lets them grant themselves anything
   else, and the whole model stops meaning anything. An owner who genuinely
   wants a second administrator has a way to say so — make them an owner —
   and that decision should look like what it is rather than arriving through
   a tab picker. */
export const UNGRANTABLE = new Set(["team", "billing"]);

export function grantable() {
  return TAB_KEYS.filter((id) => !UNGRANTABLE.has(id) && TAB_ACCESS[id] !== null);
}

export function normaliseGrants(grants = {}) {
  const clean = (list) => [
    ...new Set((list || []).map(String).filter((id) => grantable().includes(id))),
  ];

  const users = {};
  for (const [name, list] of Object.entries(grants.users || {})) {
    const tabs = clean(list);
    if (tabs.length) users[String(name).trim().toLowerCase()] = tabs;
  }

  const roles = {};
  for (const [role, list] of Object.entries(grants.roles || {})) {
    if (!ROLE_KEYS.includes(role)) continue;
    const tabs = clean(list);
    if (tabs.length) roles[role] = tabs;
  }

  return { users, roles };
}

/* Extra tabs this member has been given, by role and by name.

   The two add together rather than one overriding the other: an owner who
   opens Recipes to every chef and then opens Leakage to one of them means
   both, and having the personal grant quietly replace the role grant would
   take away something nobody asked to remove. */
export function grantedTabs(org, username, role) {
  const grants = normaliseGrants(org?.tabGrants || {});
  const byRole = grants.roles[role] || [];
  const byName = grants.users[String(username || "").trim().toLowerCase()] || [];
  return [...new Set([...byRole, ...byName])];
}

/* The capabilities a grant implies.

   A granted tab carries the capability its screen needs, so the API serves it
   too. Granting the picture without the data would produce exactly the empty,
   failing screen this map exists to prevent. */
export function capabilitiesFor(org, username, role) {
  const base = ROLES[role]?.can || [];
  const extra = grantedTabs(org, username, role)
    .map((id) => TAB_ACCESS[id])
    .filter(Boolean);
  return [...new Set([...base, ...extra])];
}

export function allowedTabs(capabilities = []) {
  return TAB_KEYS.filter((id) => {
    const needed = TAB_ACCESS[id];
    return needed === null || capabilities.includes(needed);
  });
}
