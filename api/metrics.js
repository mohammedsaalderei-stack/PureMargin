import { requireAuth } from "./_auth.js";
import { getMetrics, cacheAge, NotConnected, PosUnreachable } from "./_data.js";
import { posTokenFor } from "./_accounts.js";
import { getJSON } from "./_store.js";

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const posToken = await posTokenFor(session.username);
    // ?fresh=1 skips the cache — used by the manual refresh button.
    const fresh = String(req.query?.fresh || "") === "1";
    const overrides = (await getJSON(`costs:${session.username}`)) || {};
    const metrics = await getMetrics(posToken, { overrides, ...(fresh ? { maxAge: 0 } : {}) });

    // Never cached at the edge: the whole point is that it changes.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ...metrics, ageSeconds: cacheAge(posToken) ?? 0 });
  } catch (err) {
    if (err instanceof NotConnected) {
      return res.status(409).json({ error: "notconnected" });
    }
    if (err instanceof PosUnreachable) {
      return res.status(502).json({ error: "pos", detail: err.detail });
    }
    console.error("metrics failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
