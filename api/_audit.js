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
