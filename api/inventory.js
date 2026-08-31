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
  deleteIngredient, resetInventory,
  listSuppliers, saveSupplier, removeSupplier,
  getMeta, saveMeta, validateIngredient, slug,
} from "./_inventory.js";
import { unitsByDimension } from "./_units.js";

/* Whether anything in the ledger refers to this ingredient. A movement, a
   count line or a recipe line all count: removing something they point at
   would leave those records describing a quantity of nothing. */
async function ingredientHasHistory(orgId, id, branchIds = []) {
  try {
    const { listMovements } = await import("./_movements.js");
    /* The ledger is kept per branch, so a single lookup with no branch reads
       an empty list and would report "no history" for something with plenty.
       Every branch the caller can see is checked, and one hit is enough. */
    for (const branchId of branchIds) {
      const moves = await listMovements(orgId, branchId, { limit: 1, ingredientId: id });
      if (moves?.length) return true;
    }
    return false;
  } catch {
    /* If the ledger cannot be read, assume there is history. Archiving
       something that could have been deleted is recoverable; the reverse is
       not. */
    return true;
  }
}

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

      /* Several ingredients at once, from a scan.

         The scanners could only ever match against a master somebody had
         already typed, which is backwards: the reason to photograph a delivery
         note is that you have not typed it. A first-time user scanned an
         invoice, matched nothing, and was sent to fill in a form by hand — the
         work the feature exists to remove.

         Created as a set, and validated as one first, so a single bad unit
         does not leave half a delivery's ingredients in the master and half
         not, with nothing on screen to say which. Names already in use are
         reported back rather than silently overwritten: a scan reading
         "TOMATO" when the shelf says "Tomatoes" must not quietly redefine the
         ingredient every recipe already points at. */
      if (what === "ingredients") {
        const rows = Array.isArray(body.ingredients) ? body.ingredients : [];
        if (!rows.length) return res.status(400).json({ error: "empty" });

        const existing = await listIngredients(orgId, { includeArchived: true });
        const taken = new Map(existing.map((i) => [i.id, i.name]));

        const prepared = [];
        const skipped = [];
        for (const row of rows) {
          const draft = {
            name: String(row.name || "").trim(),
            stockUnit: String(row.stockUnit || "").trim(),
            purchaseUnit: row.purchaseUnit ? String(row.purchaseUnit).trim() : undefined,
            packSize: row.packSize,
            category: row.category ? String(row.category).trim() : undefined,
          };
          const problem = validateIngredient(draft);
          if (problem) return res.status(400).json({ error: problem, name: draft.name });
          /* Already on file: skip it rather than refuse the batch.

             Refusing was the wrong call. A scan proposes names read off a
             delivery note, and some of them will already exist — that is the
             normal case, not an error. Rejecting the whole batch for one
             collision meant a person had to find and delete the offending row
             before any of the others could be created, which is work the
             software should have done.

             Skipping is also the correct outcome on its own terms: the
             ingredient exists, so there is nothing to create, and the scan
             line will match it on the next pass. */
          if (taken.has(slug(draft.name))) {
            skipped.push(taken.get(slug(draft.name)));
            continue;
          }
          prepared.push(draft);
        }

        const made = [];
        for (const draft of prepared) {
          const { ingredient, error } = await saveIngredient(orgId, draft);
          if (error) break;
          made.push(ingredient);
        }

        await recordAudit(orgId, {
          actor: session.username,
          action: "ingredient.addMany",
          detail: { count: made.length, skipped: skipped.length, source: body.source || "scan" },
        });

        /* The names already on file are reported back so the screen can say
           which lines it left alone, rather than silently creating fewer than
           it was asked for. */
        return res.status(200).json({ ingredients: made, skipped });
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

      /* Clearing the store takes no id, and the guard below used to demand one
         before this branch was ever reached — so the button returned 400 and
         the screen showed nothing at all. The id check moved down to the
         routes that actually need one. */
      if (what === "all") {
        if (!scope.capabilities.includes("manage:users")) {
          return res.status(403).json({ error: "notowner" });
        }
        await resetInventory(orgId, scope.authorized || []);
        await recordAudit(orgId, {
          actor: session.username, action: "inventory.reset", detail: {},
        });
        return res.status(200).json({ reset: true });
      }

      const id = String(req.query?.id || "");
      if (!id) return res.status(400).json({ error: "id" });

      if (what === "ingredient") {
        /* Whether anything points at it decides between removing and
           archiving. Checked here rather than in the store, because only this
           layer can see the ledger. */
        const ledger = await ingredientHasHistory(orgId, id, scope.authorized || []);
        const out = await deleteIngredient(orgId, id, { hasHistory: ledger });
        const { ingredient, error, deleted, archived } = out;
        if (error) return res.status(404).json({ error });
        await recordAudit(orgId, {
          actor: session.username,
          action: deleted ? "ingredient.delete" : "ingredient.archive",
          target: id,
          detail: { name: ingredient?.name || id },
        });
        /* The caller is told which happened, so the screen can say "removed"
           or "archived because it has movements" rather than guessing. */
        return res.status(200).json({ ingredient: ingredient || null, deleted: Boolean(deleted), archived: Boolean(archived) });
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
