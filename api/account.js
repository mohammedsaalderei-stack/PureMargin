import { requireAuth } from "./_auth.js";
import {
  getAccount, setPosToken, setBusiness, publicAccount,
  requestDeletion, cancelDeletion, purgeIfDue, deleteNow,
} from "./_accounts.js";
import { persistent } from "./_store.js";
import { clearCache, fetchMerchant } from "./_data.js";

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

      const updated = await getAccount(session.username);
      return res.status(200).json({ account: publicAccount(updated) });
    }

    if (req.method === "DELETE") {
      /* ?now=1 skips the grace period and wipes the record immediately. The
         window protects a misclick, but someone who means it shouldn't have to
         wait a week for their data to go — so both paths exist and the caller
         says which it wants. There is no undo for this one. */
      if (String(req.query?.now || "") === "1") {
        const gone = await deleteNow(session.username);
        if (!gone) return res.status(404).json({ error: "noaccount" });
        // 410: the account this token belongs to no longer exists.
        return res.status(410).json({ deleted: true });
      }

      const account = await requestDeletion(session.username);
      if (!account) return res.status(404).json({ error: "noaccount" });
      return res.status(200).json({ account: publicAccount(account) });
    }

    if (req.method === "POST") {
      // Undo, while the window is still open.
      const account = await cancelDeletion(session.username);
      if (!account) return res.status(404).json({ error: "noaccount" });
      return res.status(200).json({ account: publicAccount(account) });
    }

    return res.status(405).json({ error: "Use GET, PUT, POST or DELETE." });
  } catch (err) {
    console.error("account failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
