/* The role table, alone in its own file.

   It lived in _org.js, which meant _tabs.js had to import from _org.js while
   _org.js imported back from _tabs.js — a cycle. ESM tolerates cycles right up
   until one module reads another's binding while that module is still
   evaluating, and then the failure is a temporal-dead-zone error naming a
   minified identifier that appears nowhere in the source. Not a risk worth
   carrying for the sake of one fewer file. */

/* ── Roles ────────────────────────────────────────────────────

   Capabilities are coarse on purpose. A permission per button produces a
   matrix nobody can reason about; these are the five jobs the direction
   document names, with the scope rule each one defaults to.

   scope:
     all      — every branch the organization has
     assigned — only the branches explicitly assigned to the member
*/
export const ROLES = {
  owner: {
    label: "Owner",
    scope: "all",
    can: [
      "view:dashboard", "view:profitability", "view:forecast", "view:inventory",
      "view:costs", "view:reports", "export",
      "manage:recipes", "manage:inventory", "manage:costs",
      "manage:users", "manage:integrations", "manage:billing",
      "manage:purchasing", "adjust:sales",
    ],
  },
  ops: {
    label: "Operations manager",
    /* Assigned rather than all: an ops manager covering three of nine
       branches must not see the other six. An owner can assign all of them. */
    scope: "assigned",
    can: [
      "view:dashboard", "view:profitability", "view:forecast", "view:inventory",
      "view:costs", "view:reports", "export",
      "manage:recipes", "manage:inventory", "manage:purchasing",
      "adjust:sales",
    ],
  },
  branch_manager: {
    label: "Branch manager",
    scope: "assigned",
    can: [
      "view:dashboard", "view:profitability", "view:inventory", "view:reports",
      "export", "manage:inventory", "manage:purchasing",
      /* A till mistake is found at the branch, usually on the day. Sending
         every wrong-price correction to the owner means most are never made,
         and the figures stay wrong in a way everyone on site can see. */
      "adjust:sales",
    ],
  },
  chef: {
    label: "Chef / Inventory lead",
    scope: "assigned",
    /* Recipes, stock and waste — deliberately no costs or profitability.

       This used to also withhold `approve:counts`, so that a chef recorded a
       physical count and somebody else approved the adjustment it wrote. There
       are no counts any more: stock is deliveries in and sales out, and neither
       is a number anybody types, so there is no adjustment to hold back and
       nothing for a second person to approve. Reversing a movement is still
       held apart, which is where that separation now lives. */
    can: ["view:inventory", "manage:recipes", "manage:inventory"],
  },
  cashier: {
    label: "Cashier",
    scope: "assigned",
    /* The till. A cashier reads the day's table; nothing back-of-house, and
       nothing financial beyond their own shift's view.

       Deliberately no `adjust:sales`. The person who rang a sale up wrong is
       usually the person who would be correcting it, and a till where the
       operator can quietly remove their own transactions is the oldest hole
       in retail. Corrections belong to whoever the shift reports to. */
    can: ["view:dashboard"],
  },
  accountant: {
    label: "Accountant",
    scope: "assigned",
    /* Costs, purchases, reports and exports, but no recipe or integration
       administration — straight from the direction document's table. */
    /* "Costs, purchases, reports and exports" — so purchasing is theirs, and
       `view:inventory` comes with it because a purchase order is unreadable
       without the item master behind it. Still no recipes, users or
       integrations. */
    can: [
      "view:costs", "view:reports", "view:profitability", "export", "manage:costs",
      "view:inventory", "manage:purchasing", "adjust:sales",
    ],
  },
};

export const ROLE_KEYS = Object.keys(ROLES);

export function isRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, role);
}
export function can(role, capability) {
  return Boolean(ROLES[role]?.can.includes(capability));
}