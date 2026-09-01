/* Recipes and recipe cost over HTTP — stage 4, phase 5.

   `view:costs` reads, `manage:recipes` writes. That split is the document's: a
   chef writes recipes, an accountant reads what they cost and may not rewrite
   them.

   Cost comes from the ledgers of the branches the caller is authorized for, so
   the same shared recipe answers with each reader's own prices, and no branch list
   from a request is ever used before the intersection.

   GET  ?what=list[&method=&at=]        — every recipe, costed
        ?what=recipe&id=[&method=&at=]  — one recipe with its version and costing
        ?what=meta                      — ingredients for the editor
   POST ?what=save     { menuItem, portions, yieldPct, lines, packaging, ... }
        ?what=archive  { id, archived }
        ?what=simulate { id, costOverrides, qtyOverrides, portions, sellPrice }
*/

import { requireAuth } from "./_auth.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { posTokenFor } from "./_accounts.js";
import { branchList } from "./_data.js";
import { recordAudit } from "./_audit.js";
import { COST_METHODS, DEFAULT_COST_METHOD } from "./_costing.js";
import {
  saveVersion, archiveRecipe, costedRecipe, costedList, simulate, recipeMeta, getRecipe, deleteRecipe } from "./_recipes.js";

async function branchesFor(session) {
  try {
    return await branchList(await posTokenFor(session.username));
  } catch {
    return [];
  }
}

/* Both are client-supplied numbers that only narrow a computation, so they are
   sanitised rather than authorized: a method that isn't one of ours falls back,
   and a nonsense date means "now". */
const methodFrom = (query) =>
  COST_METHODS.includes(String(query?.method || "")) ? String(query.method) : DEFAULT_COST_METHOD;
const atFrom = (query) =>
  Number(query?.at) > 0 ? Number(query.at) : Date.now();

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const roster = await branchesFor(session);
    const scope = await scopeFor(session.account, roster.map((b) => b.id));
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });

    const may = (capability) => scope.capabilities.includes(capability);
    if (!may("view:costs")) return res.status(403).json({ error: "forbidden" });

    const what = String(req.query?.what || "list");
    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      const branches = effectiveBranches(parseBranchParam(req.query?.branches), scope.authorized);
      const options = { method: methodFrom(req.query), at: atFrom(req.query) };

      if (what === "meta") {
        return res.status(200).json({
          ...(await recipeMeta(orgId)),
          canManage: may("manage:recipes"),
        });
      }

      if (what === "recipe") {
        const recipe = await costedRecipe(orgId, req.query?.id, branches, options);
        if (!recipe) return res.status(404).json({ error: "notfound" });
        return res.status(200).json({ recipe, branches, canManage: may("manage:recipes") });
      }

      return res.status(200).json({
        recipes: await costedList(orgId, branches, options),
        branches,
        /* The basis every figure on the screen was produced with, so the screen
           can say so instead of implying a single true cost. */
        method: options.method,
        at: options.at,
        canManage: may("manage:recipes"),
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};

      /* Simulation reads; it writes nothing, so costs permission is enough. A
         reader modelling a price change is exactly who this is for. */
      if (what === "simulate") {
        const branches = effectiveBranches(parseBranchParam(body.branches), scope.authorized);
        const out = await simulate(orgId, body.id, branches, {
          method: methodFrom(body), at: atFrom(body),
          costOverrides: body.costOverrides || {},
          qtyOverrides: body.qtyOverrides || {},
          portions: body.portions,
          sellPrice: body.sellPrice,
        });
        if (!out) return res.status(404).json({ error: "notfound" });
        return res.status(200).json({ simulation: out });
      }

      if (!may("manage:recipes")) return res.status(403).json({ error: "forbidden" });

      if (what === "save") {
        const out = await saveVersion(orgId, { ...body, actor: session.username });
        if (out.error) return res.status(400).json({ error: out.error });
        /* A recipe change moves every future cost of sales, which is why the
           document names it among the sensitive actions. The version number goes
           on the record so an owner can see which figures changed with it. */
        await recordAudit(orgId, {
          actor: session.username,
          action: out.created ? "recipe.create" : "recipe.version",
          target: out.recipe.id,
          detail: {
            menuItem: out.recipe.menuItem,
            version: out.version.version,
            effectiveFrom: out.version.effectiveFrom,
            portions: out.version.portions,
            yieldPct: out.version.yieldPct,
            lines: out.version.lines.length,
            /* Ingredients this save brought into the item master. Logged
               because a recipe adding rows to the master is a real change to
               shared data, even though it is the feature working. */
            newIngredients: out.newIngredients.length,
          },
        });
        return res.status(200).json({
          recipe: await costedRecipe(orgId, out.recipe.id, effectiveBranches([], scope.authorized)),
          /* Named back so the screen can say what it created rather than
             leaving somebody to notice six new rows on another screen. */
          newIngredients: out.newIngredients,
        });
      }

      if (what === "archive") {
        const existing = await getRecipe(orgId, body.id);
        if (!existing) return res.status(404).json({ error: "notfound" });
        const out = await archiveRecipe(orgId, body.id, { archived: body.archived !== false });
        await recordAudit(orgId, {
          actor: session.username,
          action: out.recipe.archived ? "recipe.archive" : "recipe.restore",
          target: out.recipe.id,
          detail: { menuItem: out.recipe.menuItem },
        });
        return res.status(200).json({ recipe: out.recipe });
      }

      return res.status(400).json({ error: "what" });
    }

    /* DELETE removes it. Consumption is written into the ledger as sales
       happen, so the history no longer depends on the recipe still existing —
       deleting changes what future sales consume, not what past ones did.
       Archiving remains for a dish that may come back. */
    if (req.method === "DELETE") {
      if (!may("manage:recipes")) return res.status(403).json({ error: "forbidden" });
      const id = String(req.query?.id || "");
      if (!id) return res.status(400).json({ error: "id" });

      const out = await deleteRecipe(orgId, id);
      if (out.error) return res.status(404).json({ error: out.error });

      await recordAudit(orgId, {
        actor: session.username, action: "recipe.delete", target: id,
        detail: { menuItem: out.menuItem },
      });
      return res.status(200).json(out);
    }

    return res.status(405).json({ error: "Use GET, POST or DELETE." });
  } catch (err) {
    console.error("recipes endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
