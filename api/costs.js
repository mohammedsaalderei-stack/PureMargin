import { requireAuth } from "./_auth.js";
import { getJSON, setJSON } from "./_store.js";
import { clearCache } from "./_data.js";

/* Owner-entered item costs.

   Many POS systems leave `cost` at zero on items, and without it net
   profit is guesswork. These are the numbers the owner supplies, stored
   against the account and applied on top of whatever the POS reports. */

const KEY = (username) => `costs:${username}`;

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const key = KEY(session.username);

  try {
    if (req.method === "GET") {
      return res.status(200).json({ costs: (await getJSON(key)) || {} });
    }

    if (req.method === "PUT") {
      const { costs } = req.body || {};
      if (!costs || typeof costs !== "object") {
        return res.status(400).json({ error: "payload" });
      }

      const existing = (await getJSON(key)) || {};
      for (const [name, raw] of Object.entries(costs)) {
        const value = Number(raw);
        // A blank or zero clears the override rather than storing a nonsense cost.
        if (!Number.isFinite(value) || value <= 0) delete existing[String(name).slice(0, 200)];
        else existing[String(name).slice(0, 200)] = Math.round(value * 100) / 100;
      }

      await setJSON(key, existing);
      // The next read has to reflect the new costs immediately.
      clearCache();
      return res.status(200).json({ costs: existing });
    }

    return res.status(405).json({ error: "Use GET or PUT." });
  } catch (err) {
    console.error("costs failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
