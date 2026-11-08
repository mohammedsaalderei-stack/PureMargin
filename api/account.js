import { requireAuth } from "./_auth.js";
import {
  getAccount, publicAccount, setEmail, renameAccount,
  requestDeletion, cancelDeletion, purgeIfDue, deleteNow, FREE_FEATURES } from "./_accounts.js";
import { issueToken } from "./_auth.js";
import { persistent } from "./_store.js";
import { orgFor, effectivePlanFor } from "./_org.js";
import { recordAudit } from "./_audit.js";

/* Accounts predating organizations have no orgId on the record; orgFor
   backfills one. Without this an older account's changes would go unlogged. */
const orgIdFor = async (account) => account?.orgId || (account ? (await orgFor(account))?.id : null);


export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    /* If a deletion window has closed, the record goes now — on the first
       request after it expires, rather than waiting for a cron job. */
    if (await purgeIfDue(session.username)) {
      return res.status(410).json({ error: "deleted" });
    }

    if (req.method === "GET") {
      const account = await getAccount(session.username);
      const pub = publicAccount(account);
      /* The plan the interface acts on is the effective one: a team member
         inherits whatever the organization's owner has. */
      if (pub) {
        const plan = await effectivePlanFor(account);
        const active = plan.items?.length && !(plan.until && plan.until < Date.now());
        pub.plan = {
          items: [...new Set([...FREE_FEATURES, ...(active ? plan.items : [])])],
          since: plan.since || null,
          until: plan.until || null,
          expired: Boolean(plan.items?.length && plan.until && plan.until < Date.now()),
          inherited: Boolean(plan.inherited),
        };
      }
      return res.status(200).json({
        account: pub,
        persistent,
      });
    }

    /* The sign-in address. */
    if (req.method === "PATCH") {
      const { email, current } = req.body || {};
      if (!current) return res.status(400).json({ error: "missing" });

      const out = await setEmail(session.username, current, email);
      if (out.error) {
        /* 401 for a wrong password, 409 for an address somebody else holds,
           400 for one that isn't an address at all. */
        const code = out.error === "wrongcurrent" ? 401 : out.error === "emailtaken" ? 409 : 400;
        return res.status(code).json({ error: out.error });
      }

      /* Only a real change is logged, and the addresses themselves are recorded:
         unlike a password, this is exactly what an owner needs to see to
         reconcile "who can now reset this account" later. */
      if (!out.unchanged) {
        await recordAudit(await orgIdFor(out.account), {
          actor: session.username,
          action: "email.change",
          target: session.username,
          detail: { from: out.previous || null, to: out.account.email || null },
        });
      }

      return res.status(200).json({ account: publicAccount(out.account) });
    }

    /* The username. Its own method again, for the same reason PATCH is separate
       from PUT: this one moves storage records around and reissues the caller's
       token, and it must not be possible to trigger it by accident while
       meaning to change something else. */
    if (req.method === "POST") {
      const { username, current } = req.body || {};
      if (!current) return res.status(400).json({ error: "missing" });

      const out = await renameAccount(session.username, current, username);
      if (out.error) {
        /* 401 for a wrong password, 409 for a name somebody already holds,
           400 for one that isn't a usable name at all. */
        const code = out.error === "wrongcurrent" ? 401 : out.error === "taken" ? 409 : 400;
        return res.status(code).json({ error: out.error });
      }

      if (out.unchanged) return res.status(200).json({ account: publicAccount(out.account) });

      await recordAudit(await orgIdFor(out.account), {
        actor: out.account.username,
        action: "username.change",
        target: out.account.username,
        detail: { from: out.previous, to: out.account.username },
      });

      /* The rename invalidated every token carrying the old name, this one
         included. Hand back a fresh one rather than signing the caller out of
         a change they just made deliberately. */
      return res.status(200).json({
        account: publicAccount(out.account),
        token: issueToken(out.account.username, out.account.tokenVersion || 0),
      });
    }

    if (req.method === "DELETE") {
      /* ?now=1 skips the grace period and wipes the record immediately. The
         window protects a misclick, but someone who means it shouldn't have to
         wait a week for their data to go — so both paths exist and the caller
         says which it wants. There is no undo for this one. */
      if (String(req.query?.now || "") === "1") {
        /* Logged before the wipe, and against the organization — if this account
           owns it, both records go and there is deliberately nothing left. Where
           the account was only a member, the owner keeps the trace that a seat
           disappeared and why. */
        const doomed = await getAccount(session.username);
        await recordAudit(await orgIdFor(doomed), {
          actor: session.username,
          action: "account.delete.now",
          target: session.username,
        });

        const gone = await deleteNow(session.username);
        if (!gone) return res.status(404).json({ error: "noaccount" });
        // 410: the account this token belongs to no longer exists.
        return res.status(410).json({ deleted: true });
      }

      const account = await requestDeletion(session.username);
      if (!account) return res.status(404).json({ error: "noaccount" });
      await recordAudit(await orgIdFor(account), {
        actor: session.username,
        action: "account.delete.request",
        target: session.username,
        detail: { deleteAfter: account.deleteAfter },
      });
      return res.status(200).json({ account: publicAccount(account) });
    }

    if (req.method === "POST") {
      // Undo, while the window is still open.
      const account = await cancelDeletion(session.username);
      if (!account) return res.status(404).json({ error: "noaccount" });
      await recordAudit(await orgIdFor(account), {
        actor: session.username,
        action: "account.delete.cancel",
        target: session.username,
      });
      return res.status(200).json({ account: publicAccount(account) });
    }

    return res.status(405).json({ error: "Use GET, PUT, PATCH, POST or DELETE." });
  } catch (err) {
    console.error("account failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
