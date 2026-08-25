import crypto from "crypto";
import { getJSON, setJSON, del } from "./_store.js";

/* Accounts.
   Passwords are never stored — only a scrypt hash and the salt it used.
   The POS token is stored encrypted, because it grants read access to a
   business's entire sales history and a stolen database dump shouldn't
   hand that over in plain text. */

const KEY = (username) => `acct:${String(username).toLowerCase()}`;

export function normalise(username) {
  return String(username || "").trim().toLowerCase();
}

/* Usernames end up in storage keys, so keep them to a predictable shape. */
export function validUsername(username) {
  return /^[a-z0-9._-]{3,32}$/.test(normalise(username));
}

/* Deliberately permissive. Address validation that tries to be clever
   rejects real addresses; the only test that matters is whether mail
   arrives, which we can't do here. */
export function validEmail(email) {
  const e = String(email || "").trim();
  return e.length <= 254 && /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(e);
}

const EMAIL_KEY = (email) => `email:${String(email).trim().toLowerCase()}`;

export async function getAccountByEmail(email) {
  const username = await getJSON(EMAIL_KEY(email));
  return username ? getAccount(username) : null;
}

/* Sign-in accepts either. People remember one or the other, rarely both. */
export async function findAccount(identifier) {
  const id = String(identifier || "").trim();
  if (!id) return null;
  if (id.includes("@")) return getAccountByEmail(id);
  return getAccount(id);
}

export function passwordProblem(password) {
  const p = String(password || "");
  if (p.length < 8) return "short";
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) return "weak";
  return null;
}

function hash(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString("hex");
}

function secret() {
  return crypto
    .createHash("sha256")
    .update(process.env.SESSION_SECRET || "sufra-dev-secret-change-me")
    .digest();
}

export function encrypt(text) {
  if (!text) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  const enc = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

export function decrypt(payload) {
  if (!payload) return "";
  try {
    const [iv, tag, data] = String(payload).split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", secret(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    /* Wrong secret, or tampered ciphertext. Treat it as not connected
       rather than crashing the request. */
    return "";
  }
}

export async function getAccount(username) {
  return getJSON(KEY(username));
}

export async function createAccount({ username, password, email, business = "" }) {
  const id = normalise(username);
  const address = String(email || "").trim().toLowerCase();
  if (await getAccount(id)) return { error: "taken" };
  /* An address is optional. Only look for a clash when one was actually
     given — getAccountByEmail("") would otherwise read the key `email:` and
     hand back whatever happens to live there. */
  if (address && (await getAccountByEmail(address))) return { error: "emailtaken" };

  const salt = crypto.randomBytes(16).toString("hex");
  const account = {
    username: id,
    email: address,
    business: String(business || "").trim().slice(0, 80),
    salt,
    hash: hash(password, salt),
    posToken: "",
    tokenVersion: 0,
    lastLoginAt: null,
    passwordChangedAt: null,
    /* A new account owns nothing until a package is bought. Registration
       creates an identity; it doesn't grant access. */
    plan: { items: [], since: null, until: null },
    createdAt: Date.now(),
    firstQuestionAt: null,
    lastQuestionAt: null,
    questionCount: 0,
  };
  await setJSON(KEY(id), account);
  // Index by address so sign-in can resolve either credential.
  if (account.email) await setJSON(EMAIL_KEY(account.email), id);
  return { account };
}

export async function verifyPassword(identifier, password) {
  const account = await findAccount(identifier);
  if (!account) return null;
  const attempt = hash(password, account.salt);
  const a = Buffer.from(attempt);
  const b = Buffer.from(account.hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return account;
}

/* Free for every account. Somebody who has connected their POS should be
   able to read their own week without paying — that's what makes the paid
   pieces worth buying, and an empty product nobody can use sells nothing. */
export const FREE_FEATURES = ["table"];

/* Sold separately. Every id here must exist in `SCREEN_FEATURE` on the client,
   or a package would be sellable with nothing behind it — and anything missing
   here can't be granted at all, which is how the operations suite and the bill
   scanner were unsellable. */
export const FEATURES = ["assistant", "menu", "forecast", "operations", "billscan"];

/* The terms a subscription can be activated for, in months. Anything else is
   treated as a single month rather than refused, so a stray value can never
   grant a longer period than an operator chose. */
export const PLAN_MONTHS = [1, 3, 6, 12];

/* Mock checkout. A real one would verify a payment intent from the
   processor before writing anything here — this is the seam where that
   verification goes, and the only place entitlements are granted. */
export async function grantPlan(username, items, months = 1) {
  const account = await getAccount(username);
  if (!account) return null;

  const clean = [...new Set(items)].filter((i) => FEATURES.includes(i));
  if (!clean.length) return null;

  if (!PLAN_MONTHS.includes(Number(months))) months = 1;
  const now = Date.now();
  const existing = account.plan?.items || [];
  const until = Math.max(account.plan?.until || 0, now) + months * 30 * 864e5;

  account.plan = {
    items: [...new Set([...existing, ...clean])],
    since: account.plan?.since || now,
    until,
  };
  await setJSON(KEY(username), account);
  return account;
}

export async function cancelPlan(username) {
  const account = await getAccount(username);
  if (!account) return null;
  account.plan = { items: [], since: null, until: null };
  await setJSON(KEY(username), account);
  return account;
}

/* Expiry is enforced on read, so a lapsed subscription closes on its own
   without a scheduled job. */
export function activeItems(account) {
  const plan = account?.plan;
  const paid =
    plan?.items?.length && !(plan.until && plan.until < Date.now()) ? plan.items : [];
  return [...FREE_FEATURES, ...paid];
}

const GRACE_DAYS = 7;

/* Deletion is a request with a grace period, not an instant wipe.
   The account is marked, sign-in still works during the window so it can be
   undone, and the record is actually removed on the first access after the
   window closes. No scheduled job needed. */
export async function requestDeletion(username) {
  const account = await getAccount(username);
  if (!account) return null;
  account.deleteAfter = Date.now() + GRACE_DAYS * 864e5;
  await setJSON(KEY(username), account);
  return account;
}

export async function cancelDeletion(username) {
  const account = await getAccount(username);
  if (!account) return null;
  delete account.deleteAfter;
  await setJSON(KEY(username), account);
  return account;
}

export async function purgeIfDue(username) {
  const account = await getAccount(username);
  if (!account?.deleteAfter) return false;
  if (account.deleteAfter > Date.now()) return false;
  await del(KEY(username));
  await del(`chats:${normalise(username)}`);
  if (account.email) await del(EMAIL_KEY(account.email));
  return true;
}

/* Deletion without the grace period, for someone who means it now.

   The grace window exists to protect people who click the wrong button; it
   shouldn't stand in the way of someone who genuinely wants their data gone,
   which is also what a deletion request under data-protection rules expects.
   So this is the same wipe `purgeIfDue` performs, run immediately.

   The organization goes too when this account owns it: the POS connection and
   every membership live on that record, so leaving it behind would keep a
   tenant alive with no one able to administer it. An organization this account
   was only a member of is left standing — it isn't theirs to delete — but their
   seat in it is removed, so no scope survives them. */
export async function deleteNow(username) {
  const account = await getAccount(username);
  if (!account) return false;
  const id = normalise(username);

  if (account.orgId) {
    const org = await getJSON(`org:${account.orgId}`);
    if (org?.ownerUsername === id) {
      await del(`org:${account.orgId}`);
      /* Members lose their seat with the organization. Their own accounts stay
         — they're separate people — but they no longer point at anything, and
         `orgFor` gives them a fresh organization of their own on next use. */
      for (const member of Object.keys(org.members || {})) {
        await del(`invite:${member}`);
      }
    } else if (org) {
      delete org.members[id];
      await setJSON(`org:${account.orgId}`, org);
    }
  }

  await del(KEY(id));
  await del(`chats:${id}`);
  await del(`costs:${id}`);
  await del(`invite:${id}`);
  if (account.email) await del(EMAIL_KEY(account.email));
  return true;
}

/* Invalidates every token issued so far. Used by a password change and by
   "sign out everywhere". */
export async function bumpTokenVersion(username) {
  const account = await getAccount(username);
  if (!account) return null;
  account.tokenVersion = (account.tokenVersion || 0) + 1;
  await setJSON(KEY(username), account);
  return account;
}

export async function changePassword(username, currentPassword, nextPassword) {
  const account = await verifyPassword(username, currentPassword);
  if (!account) return { error: "wrongcurrent" };

  const problem = passwordProblem(nextPassword);
  if (problem) return { error: problem };

  const salt = crypto.randomBytes(16).toString("hex");
  account.salt = salt;
  account.hash = hash(nextPassword, salt);
  account.passwordChangedAt = Date.now();
  // Everything signed in with the old password stops working.
  account.tokenVersion = (account.tokenVersion || 0) + 1;
  await setJSON(KEY(account.username), account);
  return { account };
}

/* Changes the address on the account, or sets one where there was none.

   The current password is required, and not as ceremony: the address is a
   sign-in credential and the destination for password resets, so whoever can
   change it unchallenged can take the account. A borrowed unlocked laptop is
   enough otherwise.

   The lookup index moves with it — the old key is removed, so the previous
   address stops signing in and becomes free for somebody else. Clearing the
   address is allowed (pass an empty string); the username still signs in, but
   password reset stops being possible, which the interface says out loud. */
export async function setEmail(username, currentPassword, nextEmail) {
  const account = await verifyPassword(username, currentPassword);
  if (!account) return { error: "wrongcurrent" };

  const next = String(nextEmail || "").trim().toLowerCase();
  if (next && !validEmail(next)) return { error: "bademail" };
  const previous = account.email || "";
  if (next === previous) return { account, unchanged: true };

  /* Taken by somebody else — but the same address on this same account is not a
     conflict, which the equality check above has already let through. */
  if (next) {
    const holder = await getAccountByEmail(next);
    if (holder && holder.username !== account.username) return { error: "emailtaken" };
  }

  account.email = next;
  account.emailChangedAt = Date.now();
  await setJSON(KEY(account.username), account);

  /* Index last, and the old key first: if this fails halfway, an address that
     resolves to nothing is recoverable, while two addresses resolving to one
     account is a sign-in ambiguity. */
  if (previous) await del(EMAIL_KEY(previous));
  if (next) await setJSON(EMAIL_KEY(next), account.username);

  return { account, previous };
}

/* Sets a new password without checking the old one.
   Only reachable behind a verified reset code — the caller is responsible for
   proving the request came from the address on the account. */
export async function resetPassword(username, nextPassword) {
  const account = await getAccount(username);
  if (!account) return { error: "noaccount" };

  const problem = passwordProblem(nextPassword);
  if (problem) return { error: problem };

  const salt = crypto.randomBytes(16).toString("hex");
  account.salt = salt;
  account.hash = hash(nextPassword, salt);
  account.passwordChangedAt = Date.now();
  // Whoever was signed in with the forgotten password is signed out.
  account.tokenVersion = (account.tokenVersion || 0) + 1;
  await setJSON(KEY(account.username), account);
  return { account };
}

export async function noteLogin(username) {
  const account = await getAccount(username);
  if (!account) return null;
  account.lastLoginAt = Date.now();
  await setJSON(KEY(username), account);
  return account;
}

export async function setBusiness(username, business) {
  const account = await getAccount(username);
  if (!account) return null;
  account.business = String(business || "").trim().slice(0, 120);
  await setJSON(KEY(username), account);
  return account;
}

export async function setPosToken(username, token) {
  const account = await getAccount(username);
  if (!account) return null;
  account.posToken = token ? encrypt(token) : "";
  await setJSON(KEY(username), account);
  return account;
}

/* The decrypted POS token for this account, or the server-wide one as a
   fallback so a single-tenant deployment keeps working unchanged. */
export async function posTokenFor(username) {
  const account = await getAccount(username);
  const own = account?.posToken ? decrypt(account.posToken) : "";
  return own || process.env.POS_ACCESS_TOKEN || process.env.LOYVERSE_ACCESS_TOKEN || "";
}

export async function noteQuestion(username) {
  const account = await getAccount(username);
  if (!account) return;
  const now = Date.now();
  account.questionCount = (account.questionCount || 0) + 1;
  account.firstQuestionAt = account.firstQuestionAt || now;
  account.lastQuestionAt = now;
  await setJSON(KEY(username), account);
}

/* Never send hashes or tokens to the browser. */
/* Change the username on an account.

   The username is not just a label: it is the tail of the account's own
   storage key and of several others, and it is the key under which the
   organization records membership. A rename therefore moves records rather
   than editing a field, and the order below is chosen so that an interruption
   leaves something recoverable rather than something ambiguous.

   Written last, deleted first. If this dies halfway, the worst case is a
   duplicate of a record under the old name, which a later rename overwrites.
   The alternative order can leave two names resolving to one account, which
   is a sign-in ambiguity nobody can see or fix from the outside.

   Audit history is deliberately not rewritten. What an old name did is a fact
   about the past, and quietly restating it under the new name would make the
   log a worse record than it was. The rename itself is written to the log by
   the caller. */
const RENAMED_KEYS = [
  (u) => `chats:${u}`,
  (u) => `costs:${u}`,
  (u) => `invite:${normalise(u)}`,
];

export async function renameAccount(username, currentPassword, nextUsername) {
  const account = await verifyPassword(username, currentPassword);
  if (!account) return { error: "wrongcurrent" };

  const next = normalise(nextUsername);
  const previous = account.username;
  if (next === previous) return { account, unchanged: true };
  if (!validUsername(next)) return { error: "username" };
  if (await getAccount(next)) return { error: "taken" };

  const moved = { ...account, username: next, usernameChangedAt: Date.now() };
  /* Every session token carries the old name, so they all have to stop
     working — including this caller's, which is reissued by the endpoint. */
  moved.tokenVersion = (account.tokenVersion || 0) + 1;
  await setJSON(KEY(next), moved);

  for (const keyOf of RENAMED_KEYS) {
    const carried = await getJSON(keyOf(previous));
    if (carried !== null && carried !== undefined) {
      await setJSON(keyOf(next), carried);
      await del(keyOf(previous));
    }
  }

  if (moved.email) await setJSON(EMAIL_KEY(moved.email), next);

  /* Membership is keyed by username, and the owner is named twice — once as
     the key and once on the organization itself. */
  if (moved.orgId) {
    const org = await getJSON(`org:${moved.orgId}`);
    if (org) {
      if (org.members && org.members[previous]) {
        org.members[next] = org.members[previous];
        delete org.members[previous];
      }
      if (org.ownerUsername === previous) org.ownerUsername = next;
      await setJSON(`org:${moved.orgId}`, org);
    }
  }

  await del(KEY(previous));
  return { account: moved, previous };
}

export function publicAccount(account) {
  if (!account) return null;
  return {
    username: account.username,
    email: account.email || "",
    business: account.business,
    createdAt: account.createdAt,
    firstQuestionAt: account.firstQuestionAt,
    lastQuestionAt: account.lastQuestionAt,
    questionCount: account.questionCount || 0,
    posConnected: Boolean(account.posToken),
    deleteAfter: account.deleteAfter || null,
    lastLoginAt: account.lastLoginAt || null,
    passwordChangedAt: account.passwordChangedAt || null,
    emailChangedAt: account.emailChangedAt || null,
    usernameChangedAt: account.usernameChangedAt || null,
    tokenVersion: account.tokenVersion || 0,
    plan: {
      items: activeItems(account),
      since: account.plan?.since || null,
      until: account.plan?.until || null,
      expired: Boolean(account.plan?.items?.length && account.plan?.until < Date.now()),
    },
  };
}
