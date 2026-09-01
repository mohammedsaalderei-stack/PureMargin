import { requireAuth } from "./_auth.js";
import { cancelPlan, publicAccount, FEATURES, FREE_FEATURES } from "./_accounts.js";

/* Mock checkout.
   There is no payment processor behind this — it takes a list of packages
   and grants them. It exists so the rest of the app can be built and tested
   against real entitlement rules.

   To make it real, verify a completed payment with your processor at the
   marked point and keep everything else. Entitlements are granted in exactly
   one place, so there is exactly one thing to secure. */

/* Monthly, in dirhams, per business rather than per branch.

   One entry per grantable package and nothing else. The old table carried
   `menu` and `forecast`, which were never in `FEATURES` and so could not be
   sold, and `pos_hardware`, which is a physical till quoted per order. A price
   list containing things that cannot be bought is a price list somebody
   eventually quotes from. */
const PRICES = {
  assistant: 250,
  operations: 150,
  costs: 200,
};

/* Each branch beyond the first costs half again of the monthly total, because
   a second kitchen is more reading, more reconciling and more support — but
   not twice the product. Expressed as a percentage rather than a second price
   list so it cannot drift out of step when a package price changes. */
const BRANCH_SURCHARGE_PCT = 50;

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    if (req.method === "GET") {
      return res.status(200).json({
        prices: PRICES,
        features: FEATURES,
        free: FREE_FEATURES,
        branchSurchargePct: BRANCH_SURCHARGE_PCT,
        /* Quoted per order, never granted. Sent so the pricing page can state
           it without keeping its own copy of a commercial fact. */
        hardware: { pricedPerOrder: true },
        mock: true,
      });
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
