import crypto from "crypto";
import { getJSON, setJSON } from "./_store.js";
import { normalise } from "./_accounts.js";
import { ROLE_KEYS, membership } from "./_org.js";

/* The team's own conversation.

   Everything else in this product is the software talking to one person. This
   is the people talking to each other, in the same place they read the
   numbers, so that "waste is up in Al Ain" and the conversation about it don't
   live in two different apps.

   One board per organization, not per branch. A branch manager who only ever
   sees their own figures still needs to hear an announcement meant for
   everyone, and splitting the board by branch would have made the common case
   — the owner saying something to all of them — the awkward one. Targeting is
   a property of the message instead.

   Messages are immutable once posted. There is no edit, because a board people
   are asked to act on is worthless if what it said yesterday can change. */

const KEY = (orgId) => `messages:${orgId}`;
const READ_KEY = (orgId, username) => `messages-read:${orgId}:${normalise(username)}`;

/* Enough for a board that is read, not an archive that is searched. Older
   messages fall off the end rather than growing the record without limit. */
export const MAX_MESSAGES = 500;
export const MAX_BODY = 4000;

export function bodyProblem(body) {
  const text = String(body || "").trim();
  if (!text) return "empty";
  if (text.length > MAX_BODY) return "long";
  return null;
}

/* Who a message is for.

   `branches` empty means every branch; `roles` empty means every role. The
   two narrow together, so a message with one branch and one role reaches the
   people who match both. Everyone can read everything on the board regardless
   — targeting decides who is notified and who sees it marked for them, not
   who is allowed to look. Hiding messages would turn a misaddressed one into
   a message nobody can find. */
export function normaliseAudience(audience = {}) {
  const branches = [...new Set((audience.branches || []).map(String).filter(Boolean))];
  const roles = [...new Set((audience.roles || []).map(String).filter((r) => ROLE_KEYS.includes(r)))];
  const users = [...new Set((audience.users || []).map((u) => normalise(String(u))).filter(Boolean))];
  return { branches, roles, users };
}

/* Who this member is allowed to write to directly.

   A cashier's world is their branch. Letting them open a private thread with
   an accountant three branches away is not collaboration, it is a way to
   route around a manager, and the org chart already says as much — so the
   list is drawn from the same branch assignments that decide what they can
   see. Anyone whose scope is the whole organization can reach everyone,
   because their scope already is everyone.

   The list is computed here rather than filtered in the browser. A recipient
   picker that merely hides names is a suggestion; this is the rule, and the
   endpoint checks against it before writing anything. */
export function addressable(org, username) {
  const me = membership(org, username);
  if (!me || !org?.members) return [];
  const wide = me.role === "owner" || !(me.branches || []).length;

  return Object.entries(org.members)
    .filter(([name]) => name !== normalise(username))
    .filter(([, them]) => {
      if (wide) return true;
      /* Somebody with no branches of their own — an owner, an accountant —
         is reachable by anyone, since there is no branch to be outside of. */
      if (them.role === "owner" || !(them.branches || []).length) return true;
      return (them.branches || []).some((b) => (me.branches || []).includes(b));
    })
    .map(([name, them]) => ({ username: name, role: them.role }));
}

export function isDirect(message) {
  return Boolean(message?.audience?.users?.length);
}

/* Whether this member may see a message at all.

   Broadcasts are open to the whole organization: targeting decides who is
   notified, not who may look. A message named to specific people is the one
   exception — that is a conversation, and a board that shows everyone else's
   private threads is not a feature anybody asked for. */
export function visibleTo(message, username) {
  if (!isDirect(message)) return true;
  const me = normalise(username);
  return message.author === me || message.audience.users.includes(me);
}

export function audienceIsEveryone(audience) {
  return !audience.branches.length && !audience.roles.length && !(audience.users || []).length;
}

/* Whether a given member falls inside a message's audience.

   An owner matches every branch filter. Their scope is the whole
   organization, so a message aimed at one branch is still aimed at them —
   excluding the owner from a branch announcement would be a strange reading
   of "everyone at Al Ain". */
export function matchesAudience(audience, member, username) {
  if (!member) return false;
  /* A named recipient list overrides the broader filters: the message is for
     those people, whatever branch or role they happen to hold. */
  if (audience.users?.length) return audience.users.includes(normalise(username || ""));
  if (audience.roles.length && !audience.roles.includes(member.role)) return false;
  if (audience.branches.length) {
    if (member.role === "owner") return true;
    const mine = (member.branches || []).map(String);
    if (!mine.length) return false;
    if (!audience.branches.some((b) => mine.includes(String(b)))) return false;
  }
  return true;
}

export async function listMessages(orgId) {
  if (!orgId) return [];
  return (await getJSON(KEY(orgId))) || [];
}

export async function postMessage(orgId, { author, body, important = false, audience = {} }) {
  const problem = bodyProblem(body);
  if (problem) return { error: problem };

  const message = {
    id: crypto.randomUUID(),
    author: normalise(author),
    body: String(body).trim().slice(0, MAX_BODY),
    important: Boolean(important),
    audience: normaliseAudience(audience),
    at: Date.now(),
  };

  const list = await listMessages(orgId);
  list.push(message);
  /* Trim from the front: the oldest go first. */
  const trimmed = list.length > MAX_MESSAGES ? list.slice(list.length - MAX_MESSAGES) : list;
  await setJSON(KEY(orgId), trimmed);
  return { message };
}

/* The members a message should be mailed to.

   Only important messages notify, and never the author — nobody needs an
   email telling them what they just wrote. */
export function recipientsFor(org, message) {
  /* Two things earn an email: the important flag, and being named personally.
     A message addressed to you by name is the one case where not telling you
     until you next open the app defeats the point of sending it. */
  if (!org?.members || !(message.important || isDirect(message))) return [];
  return Object.entries(org.members)
    .filter(([username, member]) =>
      username !== message.author && matchesAudience(message.audience, member, username))
    .map(([username, member]) => ({ username, role: member.role }));
}

/* Read state is per member, stored as the timestamp of the newest message
   they have seen. A single number rather than a set of ids: the board is
   chronological, marking it read means "up to here", and a set would grow
   forever while answering the same question. */
export async function markRead(orgId, username, at = Date.now()) {
  if (!orgId || !username) return;
  await setJSON(READ_KEY(orgId, username), { at });
}

export async function lastReadAt(orgId, username) {
  if (!orgId || !username) return 0;
  const record = await getJSON(READ_KEY(orgId, username));
  return record?.at || 0;
}

/* How many messages this member hasn't seen, for the dot on the nav. Counts
   only what is addressed to them, so a cashier isn't nagged by a badge for an
   announcement aimed at accountants. Their own messages never count. */
export async function unreadCount(org, username) {
  if (!org) return 0;
  const member = membership(org, username);
  if (!member) return 0;
  const since = await lastReadAt(org.id, username);
  const list = await listMessages(org.id);
  return list.filter(
    (m) => m.at > since
      && m.author !== normalise(username)
      && visibleTo(m, username)
      && matchesAudience(m.audience, member, username),
  ).length;
}
