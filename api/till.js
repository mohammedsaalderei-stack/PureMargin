/* The register over HTTP (the till).

   Named `till`, not `register`: `/api/register` is account sign-up.

   `use:till` sells and reads the day's sales; `manage:recipes` sets the
   add-ons a dish offers (prices live with the recipes); `manage:costs` sets
   the VAT rate. The organization and the branch always come from the session:
   a branch in a request is intersected with what the caller may use, and a
   price in a request is never read at all (see `_till.js`).

   GET  /api/till?what=catalogue                 — dishes, add-ons, VAT, the caller's branches
        ?what=day&from=&to=[&branches=] — receipts in a window of at most two days
   POST ?what=sale     { branchId, orderType, table, lines, payment }
   PUT  ?what=addons   { itemId, addons: [{ name, price, cost }] }
        ?what=vat      { vatPct }
*/
import { requireAuth } from "./_auth.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { getMeta } from "./_inventory.js";
import { depleteFromSales } from "./_salesdepletion.js";
import { recordAudit } from "./_audit.js";
import { listRecipes } from "./_recipes.js";
import { getSettings, catalogueOf, buildSale, recordSale, registerReceipts, saveAddons, saveVat, forDepletion, rosterFor } from "./_till.js";

const DAY = 24 * 60 * 60 * 1000;

/* The branches a sale may be rung up in: the till's, or the register's own
   when there is no till. An unreachable till leaves none, rather than letting
   a sale be filed under a branch the till does not have. */
async function salesBranches(account) {
  try {
    return await rosterFor(account);
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const roster = await salesBranches(session.account);
    const scope = await scopeFor(session.account, roster.map((b) => b.id));
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });
    if (!scope.capabilities.includes("use:till")) return res.status(403).json({ error: "forbidden" });

    const what = String(req.query?.what || (req.method === "GET" ? "catalogue" : ""));
    const names = Object.fromEntries(roster.map((b) => [String(b.id), b.name]));
    const authorized = scope.authorized.map(String);

    if (req.method === "GET" && what === "catalogue") {
      const [recipes, settings] = await Promise.all([listRecipes(orgId), getSettings(orgId)]);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        items: catalogueOf(recipes, settings),
        vatPct: settings.vatPct,
        branches: authorized.map((id) => ({ id, name: names[id] || id })),
        canManageAddons: scope.capabilities.includes("manage:recipes"),
        canManageVat: scope.capabilities.includes("manage:costs"),
      });
    }

    /* A day's sales, for the register's own list. The window comes from the
       device, so "today" is the cashier's today rather than the server's; it
       is capped so this cannot become an export of everything. */
    if (req.method === "GET" && what === "day") {
      const to = Number(req.query?.to) || Date.now();
      const from = Number(req.query?.from) || to - DAY;
      if (!(to > from) || to - from > 2 * DAY) return res.status(400).json({ error: "window" });
      const allowed = new Set(effectiveBranches(parseBranchParam(req.query?.branches), authorized).map(String));
      const receipts = (await registerReceipts(orgId, { since: from, now: to }))
        .filter((r) => allowed.has(String(r.store_id)));
      const sum = (pick) => Math.round(receipts.reduce((s, r) => s + pick(r), 0) * 100) / 100;
      const paid = (type) => sum((r) => (r.payments || []).filter((p) => p.type === type)
        .reduce((s, p) => s + (Number(p.money_amount) || 0), 0));
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        receipts: receipts.slice().reverse(),
        totals: {
          count: receipts.length,
          total: sum((r) => Number(r.total_money) || 0),
          tax: sum((r) => Number(r.total_tax) || 0),
          cash: paid("CASH"),
          card: paid("CARD"),
        },
      });
    }

    if (req.method === "POST" && what === "sale") {
      const body = req.body || {};
      /* One branch, and one the caller may sell in. */
      const branch = effectiveBranches([String(body.branchId || "")], authorized);
      if (branch.length !== 1) return res.status(403).json({ error: "branch" });

      const [recipes, settings] = await Promise.all([listRecipes(orgId), getSettings(orgId)]);
      const built = buildSale(body, {
        catalogue: catalogueOf(recipes, settings),
        vatPct: settings.vatPct,
        branchId: branch[0],
        at: Date.now(),
        cashier: session.username,
      });
      if (built.error) return res.status(422).json(built);

      await recordSale(orgId, built.receipt);

      /* Stock leaves the shelf when the sale is made, through the same code the
         till's receipts go through. Best-effort and idempotent by receipt
         number: a failure here must never lose the sale, which is already
         saved, and anything not depleted now is depleted on a later pass. */
      let depletion = null;
      try {
        const meta = await getMeta(orgId);
        if (meta.autoDepleteFromSales) {
          depletion = await depleteFromSales(orgId, branch[0], [forDepletion(built.receipt)], { actor: session.username });
        }
      } catch (err) {
        console.error("register depletion failed:", err?.message || err);
      }

      return res.status(201).json({
        receipt: built.receipt,
        depletion: depletion ? { movements: depletion.movements, unmatched: depletion.unmatched } : null,
      });
    }

    if (req.method === "PUT" && what === "addons") {
      if (!scope.capabilities.includes("manage:recipes")) return res.status(403).json({ error: "forbidden" });
      const body = req.body || {};
      const recipes = await listRecipes(orgId);
      const itemId = String(body.itemId || "");
      if (!recipes.some((r) => String(r.id) === itemId)) return res.status(404).json({ error: "item" });
      const out = await saveAddons(orgId, itemId, body.addons);
      if (out.error) return res.status(422).json(out);
      await recordAudit(orgId, {
        actor: session.username,
        action: "register.addons",
        detail: { itemId, count: out.addons.length },
      });
      return res.status(200).json(out);
    }

    if (req.method === "PUT" && what === "vat") {
      if (!scope.capabilities.includes("manage:costs")) return res.status(403).json({ error: "forbidden" });
      const before = (await getSettings(orgId)).vatPct;
      const out = await saveVat(orgId, req.body?.vatPct);
      if (out.error) return res.status(422).json(out);
      await recordAudit(orgId, {
        actor: session.username,
        action: "register.vat",
        detail: { from: before, to: out.vatPct },
      });
      return res.status(200).json(out);
    }

    return res.status(405).json({ error: "Use GET ?what=catalogue|day, POST ?what=sale, or PUT ?what=addons|vat." });
  } catch (err) {
    console.error("register failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
