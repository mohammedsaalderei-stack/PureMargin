/* The admin panel's API.

   Access is deliberately narrow and separate from normal sessions:

   1. Only admin accounts get in. The bootstrap admin is whoever registered
      with the ADMIN_EMAIL address (set in the server environment); further
      admins are granted by an existing admin and stored in the admin list.
   2. Signing in to the panel requires the account's password again, even
      with a valid app session — and it issues its own short-lived token
      (30 minutes), signed for the admin purpose only. An app session token
      is never accepted here, and an admin token is useless on the app.

   Actions (all POST, JSON body { action, ... }):
     login        { identifier, password }         → { adminToken }
     accounts     {}                               → every account, with plan and expiry
     grant        { username, items, months }      → activate packages (1/3/6/12 months)
     cancel       { username }                     → end a subscription
     remove       { username }                     → delete the account outright
     admins       {}                               → who can access this panel
     addAdmin     { email }                        → allow another person in
     removeAdmin  { email }                        → revoke (the bootstrap admin can't be removed)
*/

import crypto from "crypto";
import {
  findAccount, verifyPassword, getAccount, grantPlan, cancelPlan, deleteNow,
  FEATURES, PLAN_MONTHS, normalise,
} from "./_accounts.js";
import { getJSON, setJSON, listKeys } from "./_store.js";

const ADMINS_KEY = "admins:extra";
const TOKEN_MINUTES = 30;

function secret() {
  return `admin.${process.env.SESSION_SECRET || "sufra-dev-secret-change-me"}`;
}
function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function issueAdminToken(username) {
  const expires = Date.now() + TOKEN_MINUTES * 60e3;
  const payload = `${Buffer.from(String(username)).toString("base64url")}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const a = Buffer.from(parts[2]);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(parts[1]) < Date.now()) return null;
  return { username: Buffer.from(parts[0], "base64url").toString() };
}

function bootstrapEmail() {
  return String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
}

export async function adminEmails() {
  const extra = (await getJSON(ADMINS_KEY)) || [];
  const boot = bootstrapEmail();
  return [...new Set([...(boot ? [boot] : []), ...extra])];
}

export async function isAdminAccount(account) {
  if (!account?.email) return false;
  return (await adminEmails()).includes(String(account.email).toLowerCase());
}

async function requireAdmin(req, res) {
  const header = req.headers.authorization || "";
  const session = verifyAdminToken(header.replace(/^Bearer\s+/i, ""));
  if (!session) {
    res.status(401).json({ error: "expired" });
    return null;
  }
  const account = await getAccount(session.username);
  if (!account || !(await isAdminAccount(account))) {
    res.status(403).json({ error: "forbidden" });
    return null;
  }
  return { ...session, account };
}

async function listAccounts() {
  const keys = await listKeys("acct:");
  const admins = await adminEmails();
  const accounts = [];
  for (const key of keys) {
    const a = await getJSON(key);
    if (!a?.username) continue;
    const until = a.plan?.until || null;
    accounts.push({
      username: a.username,
      email: a.email || "",
      business: a.business || "",
      createdAt: a.createdAt || null,
      lastLoginAt: a.lastLoginAt || null,
      posConnected: Boolean(a.posToken),
      questionCount: a.questionCount || 0,
      deleteAfter: a.deleteAfter || null,
      orgId: a.orgId || null,
      isAdmin: admins.includes(String(a.email || "").toLowerCase()),
      plan: {
        items: a.plan?.items || [],
        since: a.plan?.since || null,
        until,
        expired: Boolean(a.plan?.items?.length && until && until < Date.now()),
        daysLeft: until ? Math.max(0, Math.ceil((until - Date.now()) / 864e5)) : null,
      },
    });
  }
  return accounts.sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  const { action } = req.body || {};

  try {
    if (action === "login") {
      const { identifier, password } = req.body || {};
      const account = await verifyPassword(identifier, password);
      /* A wrong password and a non-admin account answer identically, and
         slowly — the panel's existence should reveal nothing. */
      if (!account || !(await isAdminAccount(account))) {
        await new Promise((r) => setTimeout(r, 600));
        return res.status(401).json({ error: "credentials" });
      }
      return res.status(200).json({
        adminToken: issueAdminToken(account.username),
        username: account.username,
        minutes: TOKEN_MINUTES,
      });
    }

    const session = await requireAdmin(req, res);
    if (!session) return;

    if (action === "accounts") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        accounts: await listAccounts(),
        features: FEATURES,
        months: PLAN_MONTHS,
      });
    }

    if (action === "grant") {
      const { username, items, months } = req.body || {};
      if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "items" });
      const account = await grantPlan(normalise(username), items, Number(months) || 1);
      if (!account) return res.status(404).json({ error: "noaccount" });
      return res.status(200).json({ ok: true, plan: account.plan });
    }

    if (action === "cancel") {
      const account = await cancelPlan(normalise(req.body?.username));
      if (!account) return res.status(404).json({ error: "noaccount" });
      return res.status(200).json({ ok: true });
    }

    if (action === "remove") {
      const target = normalise(req.body?.username);
      if (target === session.username) return res.status(400).json({ error: "self" });
      const gone = await deleteNow(target);
      if (!gone) return res.status(404).json({ error: "noaccount" });
      return res.status(200).json({ ok: true });
    }

    if (action === "admins") {
      return res.status(200).json({ admins: await adminEmails(), bootstrap: bootstrapEmail() });
    }

    if (action === "addAdmin") {
      const email = String(req.body?.email || "").trim().toLowerCase();
      if (!email.includes("@")) return res.status(400).json({ error: "email" });
      const extra = (await getJSON(ADMINS_KEY)) || [];
      if (!extra.includes(email) && email !== bootstrapEmail()) {
        extra.push(email);
        await setJSON(ADMINS_KEY, extra);
      }
      return res.status(200).json({ admins: await adminEmails() });
    }

    if (action === "removeAdmin") {
      const email = String(req.body?.email || "").trim().toLowerCase();
      /* The bootstrap admin comes from the environment, not the list —
         it can't be locked out through this endpoint. */
      if (email === bootstrapEmail()) return res.status(400).json({ error: "bootstrap" });
      const extra = ((await getJSON(ADMINS_KEY)) || []).filter((e) => e !== email);
      await setJSON(ADMINS_KEY, extra);
      return res.status(200).json({ admins: await adminEmails() });
    }

    return res.status(400).json({ error: "action" });
  } catch (err) {
    console.error("admin failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
