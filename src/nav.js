/* Where every screen lives.

   The app had one list of nineteen tabs, shown whole in a sidebar on a
   computer and in a drawer on a phone. Everything was one tap away and
   nothing could be found: the register sat between the dashboard and the
   sales list, stock between the assistant and the alerts.

   Now there are portals — the parts of a restaurant's day — chosen at the
   top, the way a shopping app switches between its stores. Each portal has
   at most four essentials in the bar at the bottom, and anything else it
   holds is one tap further, under More. The register is a portal of its own
   and takes the whole screen: a cashier mid-shift should see a till, not a
   back office with a till in it.

   This file decides placement only. What a person may open is still the
   server's answer (`/api/scope` → tabs); a screen they cannot open is left
   out, and a portal left with nothing is not shown. Every screen in
   `SCREEN_FEATURE` must appear exactly once here or under ACCOUNT, which
   `_nav.test.mjs` checks, so a new screen cannot be built and left
   unreachable. */

export const PORTALS = [
  { id: "business", primary: ["overview", "sales", "costs", "ask"], more: ["channels", "watch", "menu", "forecast", "advice"] },
  { id: "register", primary: ["till"], more: [] },
  { id: "kitchen", primary: ["inventory", "recipes", "alerts", "plan"], more: ["variance"] },
  { id: "team", primary: ["employees", "messages", "team"], more: [] },
];

/* Not a portal: your own account, reached from the avatar. */
export const ACCOUNT = ["settings", "billing"];

export function portalOf(tab) {
  return PORTALS.find((p) => p.primary.includes(tab) || p.more.includes(tab))?.id || null;
}

/* The portals this person has, each cut to the screens they may open. */
export function layoutFor(allowedIds) {
  const allowed = new Set(allowedIds || []);
  return PORTALS
    .map((p) => ({
      id: p.id,
      primary: p.primary.filter((id) => allowed.has(id)),
      more: p.more.filter((id) => allowed.has(id)),
    }))
    .map((p) => {
      /* A portal whose essentials are all closed to this person but which
         still has something under More shows that instead, so nothing they
         may open is hidden behind a button they never see. */
      if (!p.primary.length && p.more.length) return { ...p, primary: p.more.slice(0, 4), more: p.more.slice(4) };
      return p;
    })
    .filter((p) => p.primary.length || p.more.length);
}

/* Where a person lands in a portal: the first essential they may open. */
export function landingOf(layout, portalId) {
  const p = layout.find((x) => x.id === portalId);
  return p ? p.primary[0] || p.more[0] || null : null;
}
