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
import { ROLES, ROLE_KEYS, isRole, can } from "./_roles.js";
import { getAccount, normalise, normaliseFeatures } from "./_accounts.js";

/* Re-exported: the role table moved to its own module to break an import
   cycle, and every caller that already asks _org.js for it should keep
   working without a sweep through the codebase. */
export { ROLES, ROLE_KEYS, isRole, can };

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



/* ── Organization records ─────────────────────────────────────

   members is keyed by username so a lookup during a request is one read and
   no scanning:
     { role, branches: [] }   branches only meaningful when scope is "assigned"
*/

export async function getOrg(id) {
  return id ? getJSON(ORG_KEY(id)) : null;
}

/* What a business starts with. One store, until somebody grants more. */
export const DEFAULT_BRANCH_ALLOWANCE = 1;

/* When the allowance started existing.

   `orgFor` creates an organization on two quite different occasions: a
   business registering today, and an account older than this module being
   backfilled one. Both arrive at `createOrg`, and they must not be treated
   the same — a legacy account may have several stores in daily use, and
   locking them because a deploy happened is not a decision this code gets to
   make. The account's own `createdAt` is what tells them apart. */
const ALLOWANCE_FROM = Date.parse("2026-09-12T00:00:00.000Z");

export async function createOrg({ ownerUsername, name = "", branchAllowance }) {
  const owner = normalise(ownerUsername);
  const id = crypto.randomUUID();
  const org = {
    id,
    name: String(name || "").trim().slice(0, 80),
    ownerUsername: owner,
    members: { [owner]: { role: "owner", branches: [], since: Date.now() } },
    /* Null is meaningful and is not the same as unset: it says an admin has
       decided this organization has no limit, and it reads the same as an
       organization that predates the limit. Both are unlimited. */
    branchAllowance: branchAllowance === undefined ? DEFAULT_BRANCH_ALLOWANCE : branchAllowance,
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
    /* A business registering now starts with one branch. An account older than
       the allowance is backfilled without one, because it may already be
       receiving stock at several stores and this is not the moment to find
       out. */
    branchAllowance: Number(account.createdAt) >= ALLOWANCE_FROM
      ? DEFAULT_BRANCH_ALLOWANCE
      : null,
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
  const stored = account?.plan || { items: [], since: null, until: null };
  /* Retired package ids translated forward on read. An account that bought
     `billscan` still holds it in storage, and must still get the costs
     package it paid for. */
  const own = { ...stored, items: normaliseFeatures(stored.items || []) };
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
      items: [...new Set([...(ownActive ? own.items : []), ...normaliseFeatures(ownerPlan.items)])],
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
/* How many of the till's stores this organization may actually use.

   ── Why there is a limit at all ──────────────────────────────────────────

   A branch is not something the app creates: it is a store the POS reports,
   so connecting a till to a nine-site chain used to hand over nine branches
   the moment the token was pasted. That is the whole product arriving without
   anybody agreeing to it, and there was no way to sell the second site or to
   stage a rollout.

   The allowance is granted per organization from the admin page, beside the
   packages, and it applies to everybody — the owner included. A limit the
   owner can lift is not a limit.

   ── Absent means unlimited, deliberately ─────────────────────────────────

   Organizations that already exist have branches in daily use, and shipping a
   default of one would lock live stores on deploy: stock would stop being
   receivable at sites where it had been receivable an hour earlier, with
   nothing on screen explaining why. So an allowance nobody has set yet means
   no limit, and only a number written by an admin starts enforcing one.

   New organizations start at one, in `createOrg`, which is where the default
   belongs — a business signing up today has agreed to nothing else. */
export function unlockedBranches(org, allBranchIds = []) {
  const all = allBranchIds.map(String);
  const allowance = org?.branchAllowance;
  if (allowance === null || allowance === undefined) return all;

  const n = Math.max(0, Math.floor(Number(allowance) || 0));
  /* In the order the till reports them, which for every POS this has been
     pointed at is the order the stores were created — so the site somebody
     opened first is the one that stays unlocked. Not sorted by id: an id is
     an opaque string and sorting it would pick a site at random. */
  return all.slice(0, n);
}

export function lockedBranches(org, allBranchIds = []) {
  const unlocked = new Set(unlockedBranches(org, allBranchIds));
  return allBranchIds.map(String).filter((id) => !unlocked.has(id));
}

/* The locked branches this person may be told about.

   Not the same list. There are two quite different reasons somebody cannot see
   a store, and only one of them should be visible:

     the allowance   the business has not been granted this site. It is their
                     own store, they know it exists, and showing it locked is
                     how they ask for it.
     their scope     a cashier is assigned one branch of nine. The other eight
                     are none of their business, and a greyed row still
                     discloses that a store exists and what it is called —
                     which is the rule `api/scope.js` has always followed.

   So this returns locked stores the member would already hold if the allowance
   were lifted, and nothing else. An owner sees every locked one; a branch
   manager sees only the locked ones assigned to them. */
export function lockedForMember(org, username, allBranchIds = []) {
  const member = membership(org, username);
  if (!member) return [];

  const locked = lockedBranches(org, allBranchIds);
  if (ROLES[member.role]?.scope === "all") return locked;

  const assigned = new Set((member.branches || []).map(String));
  return locked.filter((id) => assigned.has(id));
}

export function authorizedBranches(org, username, allBranchIds = []) {
  const member = membership(org, username);
  if (!member) return [];

  /* The allowance first, then the member's own scope. Doing it the other way
     round would let an owner — whose scope is "all" — see a branch the
     organization has not been granted. */
  const all = unlockedBranches(org, allBranchIds);
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
    /* Stores the till reports that this organization has not been granted.
       Returned rather than hidden so the branch picker can show them locked:
       a business that cannot see its second site has no way to ask for it,
       and "where did my other branch go" is a support ticket either way. */
    locked: role ? lockedForMember(org, account.username, allBranchIds) : [],
    branchAllowance: org?.branchAllowance ?? null,
  };
}

/* Set how many of the till's stores an organization may use.

   Null lifts the limit. A number below what is already in use does not take a
   branch away retroactively — the ledger keeps every entry ever written — but
   it does stop new ones being recorded there, which is the honest meaning of
   a reduced allowance and is why it is an admin action rather than a silent
   consequence of anything else. */
export async function setBranchAllowance(orgId, allowance) {
  const org = await getOrg(orgId);
  if (!org) return { error: "notfound" };

  const next = allowance === null || allowance === undefined || allowance === ""
    ? null
    : Math.max(0, Math.floor(Number(allowance)));
  if (next !== null && !Number.isFinite(next)) return { error: "allowance" };

  const saved = { ...org, branchAllowance: next, updatedAt: Date.now() };
  await saveOrg(saved);
  return { org: saved };
}
