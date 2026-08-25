/* Organizations, branches, roles, and permissions — stage 1 of the product
   direction.

   Two ideas do all the work here:

   1. An organization is the tenant boundary. Every account belongs to exactly
      one, and the POS connection lives on the organization's owner, so a group
      of branches is one connection and one dataset rather than one per person.
   2. Isolation is a security control, not a navigation model. An owner still
      sees every branch in a single view; what isolation forbids is reading
      outside your authorized scope. So this module resolves a scope per
      request and intersects it with whatever the client asked for — it never
      splits the owner's session per branch.

   Branches are not created here. They come from the POS (`/stores`), which is
   already the system of record for which locations exist; inventing a parallel
   branch table would immediately disagree with it. This module only decides
   who may see which of those branch ids.

   Nothing in here trusts the client. Scope is derived from the authenticated
   session's account, and the branch list arriving in a query string is only
   ever used to narrow that scope, never to widen it. */

import crypto from "crypto";
import { getJSON, setJSON, del } from "./_store.js";
import { capabilitiesFor } from "./_tabs.js";
import { getAccount, normalise } from "./_accounts.js";

const ORG_KEY = (id) => `org:${id}`;

/* Persist an organization record. Exported so the tab-grant route can write
   one without reaching for the store key directly — the key shape is this
   module's business, and a second place that knows it is a second place to
   fix when it changes. */
export async function saveOrg(org) {
  if (!org?.id) return null;
  await setJSON(ORG_KEY(org.id), org);
  return org;
}

/* An owner can add a member before that person has an account. This index is
   what makes the seat find them: without it, registering would create a fresh
   organization and quietly orphan the membership they were given. */
const INVITE_KEY = (username) => `invite:${normalise(username)}`;

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
      "approve:counts", "manage:purchasing",
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
      "manage:recipes", "manage:inventory", "approve:counts", "manage:purchasing",
    ],
  },
  branch_manager: {
    label: "Branch manager",
    scope: "assigned",
    can: [
      "view:dashboard", "view:profitability", "view:inventory", "view:reports",
      "export", "manage:inventory", "approve:counts", "manage:purchasing",
    ],
  },
  chef: {
    label: "Chef / Inventory lead",
    scope: "assigned",
    /* Recipes, counts and waste — deliberately no costs or profitability, and
       deliberately no `approve:counts`: a chef records a count, and somebody
       else approves the adjustment it writes into the ledger. That separation is
       the entire point of the count workflow. */
    can: ["view:inventory", "manage:recipes", "manage:inventory"],
  },
  cashier: {
    label: "Cashier",
    scope: "assigned",
    /* The till. A cashier scans bills through the costs screen and reads the
       day's table; nothing back-of-house, nothing financial beyond their own
       shift's view. */
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
      "view:inventory", "manage:purchasing",
    ],
  },
};

export const ROLE_KEYS = Object.keys(ROLES);

export function isRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLES, role);
}

/* ── Organization records ─────────────────────────────────────

   members is keyed by username so a lookup during a request is one read and
   no scanning:
     { role, branches: [] }   branches only meaningful when scope is "assigned"
*/

export async function getOrg(id) {
  return id ? getJSON(ORG_KEY(id)) : null;
}

export async function createOrg({ ownerUsername, name = "" }) {
  const owner = normalise(ownerUsername);
  const id = crypto.randomUUID();
  const org = {
    id,
    name: String(name || "").trim().slice(0, 80),
    ownerUsername: owner,
    members: { [owner]: { role: "owner", branches: [], since: Date.now() } },
    createdAt: Date.now(),
  };
  await setJSON(ORG_KEY(id), org);
  return org;
}

/* The organization for an account, creating one if the account predates this
   module.

   Accounts registered before organizations existed are their own owner, which
   is the only interpretation that can't take access away from someone who
   already had it. The backfill is written once, on first read. */
export async function orgFor(account) {
  if (!account) return null;

  if (account.orgId) {
    const existing = await getOrg(account.orgId);
    if (existing) return existing;
    /* Dangling reference — the org record is gone. Rebuilding it as a
       single-owner org keeps the account usable instead of locking its owner
       out of their own data. */
  }

  /* Invited before they registered: join that organization with the role the
     owner assigned, rather than starting one of their own. */
  const invitedTo = await getJSON(INVITE_KEY(account.username));
  if (invitedTo) {
    const org = await getOrg(invitedTo);
    if (org && membership(org, account.username)) {
      account.orgId = org.id;
      await setJSON(`acct:${normalise(account.username)}`, account);
      await del(INVITE_KEY(account.username));
      return org;
    }
    // Stale invite (organization or seat gone) — don't let it block signing up.
    await del(INVITE_KEY(account.username));
  }

  const org = await createOrg({
    ownerUsername: account.username,
    name: account.business || "",
  });
  account.orgId = org.id;
  await setJSON(`acct:${normalise(account.username)}`, account);
  return org;
}

export function membership(org, username) {
  return org?.members?.[normalise(username)] || null;
}

/* The plan that actually applies to an account.

   A package belongs to the organization's owner, and it covers everyone in
   the organization: a cashier or chef added to the team gets whatever the
   owner has, without buying anything themselves. A member's own plan (if an
   admin granted one directly) still counts — the union of both applies. */
export async function effectivePlanFor(account) {
  const own = account?.plan || { items: [], since: null, until: null };
  try {
    const org = await orgFor(account);
    if (!org || org.ownerUsername === account.username) return { ...own, inherited: false };
    const owner = await getAccount(org.ownerUsername);
    const ownerPlan = owner?.plan;
    const ownerActive =
      ownerPlan?.items?.length && !(ownerPlan.until && ownerPlan.until < Date.now());
    if (!ownerActive) return { ...own, inherited: false };
    const ownActive = own.items?.length && !(own.until && own.until < Date.now());
    return {
      items: [...new Set([...(ownActive ? own.items : []), ...ownerPlan.items])],
      since: own.since || ownerPlan.since,
      until: Math.max(own.until || 0, ownerPlan.until || 0) || null,
      inherited: true,
    };
  } catch {
    return { ...own, inherited: false };
  }
}

/* ── Membership administration ────────────────────────────────
   Only ever called behind a "manage:users" check. */

export async function setMember(orgId, username, { role, branches = [] }) {
  const org = await getOrg(orgId);
  if (!org) return { error: "noorg" };
  if (!isRole(role)) return { error: "role" };

  const id = normalise(username);

  /* The owner's own row is not editable through this path. Demoting the last
     owner would leave an organization nobody can administer, and the branch
     scope of an owner is "all" by definition. */
  if (id === org.ownerUsername) return { error: "owner" };

  org.members[id] = {
    role,
    branches: [...new Set((branches || []).map(String))],
    since: org.members[id]?.since || Date.now(),
  };
  await setJSON(ORG_KEY(orgId), org);

  /* No account under that name yet — leave a pointer so registering picks the
     seat up instead of creating a separate organization. */
  if (!(await getAccount(id))) await setJSON(INVITE_KEY(id), orgId);

  return { org };
}

export async function removeMember(orgId, username) {
  const org = await getOrg(orgId);
  if (!org) return { error: "noorg" };
  const id = normalise(username);
  if (id === org.ownerUsername) return { error: "owner" };
  if (!org.members[id]) return { error: "nomember" };
  delete org.members[id];
  await setJSON(ORG_KEY(orgId), org);
  // Withdraw an unaccepted invitation along with the seat.
  await del(INVITE_KEY(id));
  return { org };
}

/* ── Scope resolution ─────────────────────────────────────────

   `allBranchIds` is what the POS reports for this organization. A member's
   authorized set is either all of them, or the assigned subset — intersected
   with what actually exists, so a branch that has been removed from the POS
   can't linger in someone's permissions. */
export function authorizedBranches(org, username, allBranchIds = []) {
  const member = membership(org, username);
  if (!member) return [];

  const all = allBranchIds.map(String);
  if (ROLES[member.role]?.scope === "all") return all;

  const assigned = new Set((member.branches || []).map(String));
  return all.filter((id) => assigned.has(id));
}

/* The rule the direction document states outright:
     effective_branches = requested_branches ∩ user_authorized_branches

   An empty request means "everything I'm allowed to see" — that's what keeps
   an owner's dashboard a single consolidated view instead of forcing a branch
   choice before anything renders. */
export function effectiveBranches(requested, authorized) {
  const allowed = new Set((authorized || []).map(String));
  if (!requested || !requested.length) return [...allowed];
  return [...new Set(requested.map(String))].filter((id) => allowed.has(id));
}

/* Query strings arrive as "a,b,c" or repeated params, and as anything else a
   caller feels like sending. */
export function parseBranchParam(value) {
  if (value === undefined || value === null || value === "") return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list.map((v) => String(v).trim()).filter(Boolean);
}

export function can(role, capability) {
  return Boolean(ROLES[role]?.can.includes(capability));
}

/* Everything a request needs to make an authorization decision, derived from
   the session — never from the request body. */
export async function scopeFor(account, allBranchIds = []) {
  const org = await orgFor(account);
  const member = membership(org, account.username);

  /* In an organization but with no membership row: no scope at all. Better a
     visibly empty dashboard than a quiet fallback that grants something. */
  const role = member?.role && isRole(member.role) ? member.role : null;

  return {
    org,
    role,
    isOwner: org?.ownerUsername === normalise(account.username),
    /* Base capabilities plus whatever the owner has opened up for this role
       or this person. Assembled here so every caller — the scope endpoint,
       the nav, and each data route — reads the same list. */
    capabilities: role ? capabilitiesFor(org, account.username, role) : [],
    authorized: role ? authorizedBranches(org, account.username, allBranchIds) : [],
  };
}
