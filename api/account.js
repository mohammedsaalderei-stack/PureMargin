import { requireAuth } from "./_auth.js";
import {
  getAccount, setPosToken, setBusiness, publicAccount,
  requestDeletion, cancelDeletion, purgeIfDue, deleteNow,
} from "./_accounts.js";
import { persistent } from "./_store.js";
import { clearCache, fetchMerchant } from "./_data.js";
import { orgFor } from "./_org.js";
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
      return res.status(200).json({
        account: publicAccount(account),
        persistent,
        serverToken: Boolean(process.env.LOYVERSE_ACCESS_TOKEN),
      });
    }

    if (req.method === "PUT") {
      const { posToken } = req.body || {};
      const account = await getAccount(session.username);
      if (!account) return res.status(404).json({ error: "noaccount" });

      const trimmed = String(posToken || "").trim();
      await setPosToken(session.username, trimmed);
      // The next read must not serve figures from the previous connection.
      clearCache();

      /* Name the business from the POS rather than asking for it. */
      if (trimmed) {
        const merchant = await fetchMerchant(trimmed);
        if (merchant?.business) await setBusiness(session.username, merchant.business);
      }

      /* The POS connection decides where every figure in the app comes from, so
         connecting or clearing it is logged. The token itself never is. */
      await recordAudit(await orgIdFor(account), {
        actor: session.username,
        action: trimmed ? "pos.connect" : "pos.disconnect",
        detail: {},
      });

      const updated = await getAccount(session.username);
      return res.status(200).json({ account: publicAccount(updated) });
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

    return res.status(405).json({ error: "Use GET, PUT, POST or DELETE." });
  } catch (err) {
    console.error("account failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
