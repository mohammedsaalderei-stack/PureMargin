/* Audit log — who changed what, for the changes that carry weight.

   Scoped to an organization, because that's the unit an owner is accountable
   for. What belongs here is anything that alters access or the source of the
   figures: role and branch assignments, membership removal, the POS connection,
   and account deletion. Ordinary reads and dashboard use do not — a log nobody
   can scan is the same as no log.

   Recording is deliberately best-effort: an audit write that fails must not
   fail the action it describes, or a flaky store would lock an owner out of
   administering their team. It is logged to the console instead, which is where
   the operator can still see it. */

import { append, recent } from "./_journal.js";

const KEY = (orgId) => `audit:${orgId}`;

/* Every action the log can hold, with the phrasing the interface uses. Keeping
   the list closed means an unrecognised action can't quietly become an
   unlabelled row in someone's audit view. */
export const AUDIT_ACTIONS = {
  "member.add": "added to the team",
  "member.update": "role or branches changed",
  "member.remove": "removed from the team",
  "pos.connect": "POS connected",
  "pos.disconnect": "POS disconnected",
  "account.delete.request": "account deletion requested",
  "account.delete.cancel": "account deletion cancelled",
  "account.delete.now": "account deleted immediately",
  "security.signout.all": "signed out everywhere",
  "password.change": "password changed",
  "email.change": "sign-in email changed",

  /* Stage 4 — inventory master data. The document requires cost and recipe
     changes to be auditable; an ingredient's unit is a cost change in disguise,
     since every recipe quantity is read against it. */
  "ingredient.add": "ingredient added",
  "ingredient.update": "ingredient changed",
  "ingredient.archive": "ingredient archived",
  "ingredient.restore": "ingredient restored",
  "supplier.add": "supplier added",
  "supplier.update": "supplier changed",
  "supplier.remove": "supplier removed",

  /* Stage 4, phase 2 — the stock ledger. Movement reversals are named in the
     document explicitly; ordinary entries are here too because a balance nobody
     can attribute is the same problem one step earlier. */
  "stock.movement": "stock movement recorded",
  "stock.transfer": "stock transferred between branches",
  "stock.reverse": "stock movement reversed",
  "stock.policy": "negative-stock policy changed",

  /* Stage 4, phase 3 — stock counts. Approval is named in the document
     explicitly, and it is the step that writes adjustments into the ledger. */
  "count.open": "stock count opened",
  "count.submit": "stock count submitted for review",
  "count.reopen": "stock count sent back to draft",
  "count.approve": "stock count approved",
  "count.cancel": "stock count cancelled",

  /* Stage 4, phase 4 — purchasing. Receiving is where cost enters the system, so
     it is logged with the invoice it was billed on. */
  "po.save": "purchase order saved",
  "po.submit": "purchase order sent to supplier",
  "po.cancel": "purchase order cancelled",
  "po.receive": "delivery received",
  "po.return": "goods returned to supplier",

  /* Stage 4, phase 5 — recipes. A new version moves every future cost of sales,
     which is why the document names recipe changes as sensitive. */
  "recipe.create": "recipe created",
  "recipe.version": "new recipe version",
  "recipe.archive": "recipe archived",
  "recipe.restore": "recipe restored",

  /* Stage 4, phase 7 — targets. A threshold decides what the whole organization
     is warned about, so moving one is a sensitive change like a permission. */
  "targets.update": "cost targets and thresholds changed",

  /* The cost ledger. `fixedcosts.js` has been writing these three since it was
     added, and every one was dropped on the floor: `recordAudit` refuses an
     action it has no label for, and these had none. Salaries are typed on that
     screen, so an unlogged edit there is exactly the kind the log exists for.

     Constant costs distinguish `end` from `delete` because they mean different
     things — one closes a cost that really ran, the other erases one that
     should never have existed. Variable costs have only `delete`, because a
     single dated line preserves nothing by being kept. */
  "fixedcost.save": "constant cost added or amended",
  "fixedcost.end": "constant cost ended",
  "fixedcost.delete": "constant cost removed",
  "varcost.add": "variable cost added",
  "varcost.update": "variable cost amended",
  "varcost.delete": "variable cost removed",

  /* Corrections to what the till reported. These are the most sensitive
     entries in the log: a sale that stops counting is money leaving the
     figures, and the only defence against that being done quietly is that it
     is written down with who did it and why. */
  "sale.correct": "sale corrected",
  "sale.recorrect": "sale correction amended",
  "sale.void": "sale voided",
  "sale.restore": "sale correction removed",
};

export async function recordAudit(orgId, { actor, action, target = "", detail = {} }) {
  if (!orgId || !AUDIT_ACTIONS[action]) return null;
  try {
    return await append(KEY(orgId), { actor, action, target, detail });
  } catch (err) {
    console.error("audit write failed:", action, err.message);
    return null;
  }
}

export async function readAudit(orgId, limit = 50) {
  if (!orgId) return [];
  return recent(KEY(orgId), limit);
}
