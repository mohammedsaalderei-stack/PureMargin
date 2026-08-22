import { requireAuth } from "./_auth.js";
import { grantPlan, cancelPlan, getAccount, publicAccount, FEATURES, FREE_FEATURES } from "./_accounts.js";

/* Mock checkout.
   There is no payment processor behind this — it takes a list of packages
   and grants them. It exists so the rest of the app can be built and tested
   against real entitlement rules.

   To make it real, verify a completed payment with your processor at the
   marked point and keep everything else. Entitlements are granted in exactly
   one place, so there is exactly one thing to secure. */

const PRICES = { assistant: 200, menu: 150, forecast: 100 };

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === "GET") {
      return res.status(200).json({ prices: PRICES, features: FEATURES, free: FREE_FEATURES, mock: true });
    }

    if (req.method === "POST") {
      const { items, months = 1, cancel } = req.body || {};

      if (cancel) {
        const account = await cancelPlan(session.username);
        return res.status(200).json({ account: publicAccount(account) });
      }

      if (!Array.isArray(items) || !items.length) {
        return res.status(400).json({ error: "items" });
      }

      const known = items.filter((i) => FEATURES.includes(i));
      if (!known.length) return res.status(400).json({ error: "items" });

      const existing = await getAccount(session.username);
      if (!existing) return res.status(404).json({ error: "noaccount" });

      // ---- A real payment check belongs here. ----
      // const paid = await processor.verify(req.body.paymentIntentId);
      // if (!paid) return res.status(402).json({ error: "payment" });

      const amount = known.reduce((sum, i) => sum + (PRICES[i] || 0), 0) * months;
      const account = await grantPlan(session.username, known, months);

      return res.status(200).json({
        account: publicAccount(account),
        charged: amount,
        currency: "AED",
        mock: true,
      });
    }

    return res.status(405).json({ error: "Use GET or POST." });
  } catch (err) {
    console.error("billing failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
