import { requireAuth, issueToken } from "./_auth.js";
import { changePassword, bumpTokenVersion, getAccount, publicAccount } from "./_accounts.js";
import { orgFor } from "./_org.js";
import { recordAudit } from "./_audit.js";

/* Password and session safety.

   PUT   change the password — needs the current one
   POST  sign out everywhere — ends every other session

   Both invalidate tokens issued earlier, so the caller gets a fresh one
   back. Without that, changing your password would sign you out of the
   device you changed it on, which nobody expects. */

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === "PUT") {
      const { current, next } = req.body || {};
      if (!current || !next) return res.status(400).json({ error: "missing" });

      const { account, error } = await changePassword(session.username, current, next);
      if (error) {
        // 401 for a wrong current password, 400 for a next one that's too weak.
        return res.status(error === "wrongcurrent" ? 401 : 400).json({ error });
      }

      /* The password itself is never recorded, only that it changed — enough
         for an owner to reconcile a change with the person who made it. */
      await recordAudit(account.orgId || (await orgFor(account))?.id, {
        actor: session.username,
        action: "password.change",
        target: session.username,
      });

      return res.status(200).json({
        token: issueToken(account.username, account.tokenVersion),
        account: publicAccount(account),
      });
    }

    if (req.method === "POST") {
      const account = await bumpTokenVersion(session.username);
      if (!account) return res.status(404).json({ error: "noaccount" });

      await recordAudit(account.orgId || (await orgFor(account))?.id, {
        actor: session.username,
        action: "security.signout.all",
        target: session.username,
      });

      return res.status(200).json({
        token: issueToken(account.username, account.tokenVersion),
        account: publicAccount(account),
      });
    }

    if (req.method === "GET") {
      const account = await getAccount(session.username);
      return res.status(200).json({ account: publicAccount(account) });
    }

    return res.status(405).json({ error: "Use GET, PUT or POST." });
  } catch (err) {
    console.error("password endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
