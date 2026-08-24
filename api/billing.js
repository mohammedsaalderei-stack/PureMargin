import { requireAuth } from "./_auth.js";
import { cancelPlan, publicAccount, FEATURES, FREE_FEATURES } from "./_accounts.js";

/* Mock checkout.
   There is no payment processor behind this — it takes a list of packages
   and grants them. It exists so the rest of the app can be built and tested
   against real entitlement rules.

   To make it real, verify a completed payment with your processor at the
   marked point and keep everything else. Entitlements are granted in exactly
   one place, so there is exactly one thing to secure. */

const PRICES = { assistant: 200, menu: 150, forecast: 100, operations: 300, billscan: 150 };

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === "GET") {
      return res.status(200).json({ prices: PRICES, features: FEATURES, free: FREE_FEATURES, mock: true });
    }

    if (req.method === "POST") {
      const { cancel } = req.body || {};

      if (cancel) {
        const account = await cancelPlan(session.username);
        return res.status(200).json({ account: publicAccount(account) });
      }

      /* Self-serve purchase is closed: packages are activated by an admin
         through the admin panel, after payment is arranged directly. */
      return res.status(403).json({ error: "adminonly" });
    }

    return res.status(405).json({ error: "Use GET or POST." });
  } catch (err) {
    console.error("billing failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
