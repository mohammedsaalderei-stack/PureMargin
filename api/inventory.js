/* Inventory master data over HTTP.

   Authorization follows the roles established in stage 1 rather than inventing
   its own: reading needs `view:inventory`, writing needs `manage:inventory`.
   That puts the chef and the branch manager in the item master (which is their
   job) and keeps the accountant out of it while leaving them costs and reports.

   The organization always comes from the session. There is no request shape that
   can name a different one, which is what makes the isolation structural instead
   of a check that could be forgotten on one route.

   GET     ?what=all|ingredients|suppliers|meta
   POST    ?what=ingredient|supplier|meta   — create or update, body is the record
   DELETE  ?what=ingredient&id=  — archives (never deletes)
           ?what=supplier&id=    — removes, refused while in use
*/

import { requireAuth } from "./_auth.js";
import { scopeFor } from "./_org.js";
import { recordAudit } from "./_audit.js";
import {
  listIngredients, saveIngredient, archiveIngredient, restoreIngredient,
  listSuppliers, saveSupplier, removeSupplier,
  getMeta, saveMeta,
} from "./_inventory.js";
import { unitsByDimension } from "./_units.js";

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  const scope = await scopeFor(session.account);
  const orgId = scope.org?.id;
  if (!orgId) return res.status(403).json({ error: "noorg" });

  const may = (capability) => scope.capabilities.includes(capability);
  const what = String(req.query?.what || "all");

  try {
    if (req.method === "GET") {
      if (!may("view:inventory")) return res.status(403).json({ error: "forbidden" });

      res.setHeader("Cache-Control", "no-store");
      if (what === "ingredients") {
        return res.status(200).json({ ingredients: await listIngredients(orgId) });
      }
      if (what === "suppliers") return res.status(200).json({ suppliers: await listSuppliers(orgId) });
      if (what === "meta") return res.status(200).json({ meta: await getMeta(orgId) });

      /* The default answer is everything the item-master screen needs in one
         request: the alternative is four round trips before the page can render
         a single picker. */
      const [ingredients, suppliers, meta] = await Promise.all([
        listIngredients(orgId, { includeArchived: String(req.query?.archived || "") === "1" }),
        listSuppliers(orgId),
        getMeta(orgId),
      ]);
      return res.status(200).json({
        ingredients,
        suppliers,
        meta,
        units: unitsByDimension(),
        canManage: may("manage:inventory"),
      });
    }

    if (req.method === "POST") {
      if (!may("manage:inventory")) return res.status(403).json({ error: "forbidden" });
      const body = req.body || {};

      if (what === "ingredient") {
        const { ingredient, created, error } = await saveIngredient(orgId, body);
        if (error) return res.status(400).json({ error });
        await recordAudit(orgId, {
          actor: session.username,
          action: created ? "ingredient.add" : "ingredient.update",
          target: ingredient.id,
          detail: { name: ingredient.name, stockUnit: ingredient.stockUnit },
        });
        return res.status(200).json({ ingredient });
      }

      if (what === "supplier") {
        const { supplier, created, error } = await saveSupplier(orgId, body);
        if (error) return res.status(400).json({ error });
        await recordAudit(orgId, {
          actor: session.username,
          action: created ? "supplier.add" : "supplier.update",
          target: supplier.id,
          detail: { name: supplier.name },
        });
        return res.status(200).json({ supplier });
      }

      if (what === "meta") {
        return res.status(200).json({ meta: await saveMeta(orgId, body) });
      }

      if (what === "restore") {
        const { ingredient, error } = await restoreIngredient(orgId, String(body.id || ""));
        if (error) return res.status(404).json({ error });
        await recordAudit(orgId, {
          actor: session.username, action: "ingredient.restore", target: ingredient.id,
          detail: { name: ingredient.name },
        });
        return res.status(200).json({ ingredient });
      }

      return res.status(400).json({ error: "what" });
    }

    if (req.method === "DELETE") {
      if (!may("manage:inventory")) return res.status(403).json({ error: "forbidden" });
      const id = String(req.query?.id || "");
      if (!id) return res.status(400).json({ error: "id" });

      if (what === "ingredient") {
        const { ingredient, error } = await archiveIngredient(orgId, id);
        if (error) return res.status(404).json({ error });
        await recordAudit(orgId, {
          actor: session.username, action: "ingredient.archive", target: id,
          detail: { name: ingredient.name },
        });
        return res.status(200).json({ ingredient });
      }

      if (what === "supplier") {
        const { error, count } = await removeSupplier(orgId, id);
        if (error === "inuse") return res.status(409).json({ error, count });
        if (error) return res.status(404).json({ error });
        await recordAudit(orgId, { actor: session.username, action: "supplier.remove", target: id });
        return res.status(200).json({ ok: true });
      }

      return res.status(400).json({ error: "what" });
    }

    return res.status(405).json({ error: "Use GET, POST or DELETE." });
  } catch (err) {
    console.error("inventory endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
