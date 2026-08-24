/* Purchase orders, receiving and returns over HTTP — stage 4, phase 4.

   `view:inventory` reads, `manage:purchasing` writes. The two are separate
   because the roles are: an accountant buys and receives without touching
   recipes, and a chef manages stock without committing the business to spend.

   Branch scope is the usual intersection, applied to the branch on the order —
   never to a branch named in the body.

   GET    ?what=list[&status=]     — orders across authorized branches
          ?what=order&id=          — one order with lines, receipts and summary
          ?what=new                — what the create form needs (suppliers, items)
   POST   ?what=save    { branchId, id?, supplierId, lines: [...], reference, ... }
          ?what=submit  { id }     — draft → open, sent to the supplier
          ?what=receive { id, lines: [{ ingredientId, qty, unit, unitPrice }],
                          invoiceNo, invoiceDate, discount, charges }
          ?what=return  { id, ingredientId, qty, unit, reason }
          ?what=cancel  { id, reason }
*/

import { requireAuth } from "./_auth.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { posTokenFor } from "./_accounts.js";
import { branchList } from "./_data.js";
import { recordAudit } from "./_audit.js";
import { listIngredients, listSuppliers } from "./_inventory.js";
import {
  saveOrder, submitOrder, cancelOrder, receiveOrder, returnToSupplier,
  getOrder, listOrders,
} from "./_purchasing.js";

async function branchesFor(session) {
  try {
    return await branchList(await posTokenFor(session.username));
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const roster = await branchesFor(session);
    const scope = await scopeFor(session.account, roster.map((b) => b.id));
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });

    const may = (capability) => scope.capabilities.includes(capability);
    if (!may("view:inventory")) return res.status(403).json({ error: "forbidden" });

    const allowed = scope.authorized;
    const what = String(req.query?.what || "list");
    res.setHeader("Cache-Control", "no-store");

    /* Load an order and check its branch in one place, so no action can forget. */
    async function mine(id) {
      const order = await getOrder(orgId, id);
      if (!order) return { error: "notfound" };
      if (!effectiveBranches([String(order.branchId)], allowed).length) return { error: "branch" };
      return { order };
    }

    if (req.method === "GET") {
      if (what === "order") {
        const found = await mine(req.query?.id);
        if (found.error === "notfound") return res.status(404).json({ error: found.error });
        if (found.error) return res.status(403).json({ error: found.error });
        return res.status(200).json({ order: found.order, canManage: may("manage:purchasing") });
      }

      if (what === "new") {
        const branches = effectiveBranches([], allowed);
        return res.status(200).json({
          branches,
          branchNames: Object.fromEntries(
            roster.filter((b) => branches.includes(String(b.id))).map((b) => [String(b.id), b.name])
          ),
          suppliers: await listSuppliers(orgId),
          /* Only live ingredients can be ordered — an archived item is one the
             business decided to stop buying. */
          ingredients: (await listIngredients(orgId)).map((i) => ({
            id: i.id, name: i.name, stockUnit: i.stockUnit,
            purchaseUnit: i.purchaseUnit || i.stockUnit, supplierId: i.supplierId || "",
          })),
          canManage: may("manage:purchasing"),
        });
      }

      const branches = effectiveBranches(parseBranchParam(req.query?.branches), allowed);
      return res.status(200).json({
        orders: await listOrders(orgId, branches, {
          status: String(req.query?.status || "") || undefined,
        }),
        branches,
        branchNames: Object.fromEntries(
          roster.filter((b) => branches.includes(String(b.id))).map((b) => [String(b.id), b.name])
        ),
        canManage: may("manage:purchasing"),
      });
    }

    if (req.method === "POST") {
      if (!may("manage:purchasing")) return res.status(403).json({ error: "forbidden" });
      const body = req.body || {};

      if (what === "save") {
        /* An edit keeps the order's own branch; a new order takes the one asked
           for, after the intersection. */
        let branchId;
        if (body.id) {
          const found = await mine(body.id);
          if (found.error === "notfound") return res.status(404).json({ error: found.error });
          if (found.error) return res.status(403).json({ error: found.error });
          branchId = found.order.branchId;
        } else {
          const branch = effectiveBranches([String(body.branchId || "")], allowed);
          if (!branch.length) return res.status(403).json({ error: "branch" });
          branchId = branch[0];
        }

        const out = await saveOrder(orgId, branchId, { ...body, actor: session.username });
        if (out.error) return res.status(out.error === "notdraft" ? 409 : 400).json({ error: out.error });
        await recordAudit(orgId, {
          actor: session.username, action: "po.save", target: out.order.id,
          detail: {
            branchId, created: out.created,
            lines: out.order.lines.length,
            value: out.order.summary?.orderedValue ?? null,
          },
        });
        return res.status(200).json({ order: await getOrder(orgId, out.order.id) });
      }

      const found = await mine(body.id);
      if (found.error === "notfound") return res.status(404).json({ error: found.error });
      if (found.error) return res.status(403).json({ error: found.error });
      const id = found.order.id;

      if (what === "submit") {
        const out = await submitOrder(orgId, id, { actor: session.username });
        if (out.error) return res.status(409).json({ error: out.error });
        await recordAudit(orgId, {
          actor: session.username, action: "po.submit", target: id,
          detail: { branchId: out.order.branchId, supplier: out.order.supplierName },
        });
        return res.status(200).json({ order: await getOrder(orgId, id) });
      }

      if (what === "cancel") {
        const out = await cancelOrder(orgId, id, { actor: session.username, reason: body.reason });
        if (out.error) return res.status(409).json({ error: out.error });
        await recordAudit(orgId, {
          actor: session.username, action: "po.cancel", target: id,
          detail: { branchId: out.order.branchId, reason: out.order.cancelReason },
        });
        return res.status(200).json({ order: await getOrder(orgId, id) });
      }

      if (what === "receive") {
        const out = await receiveOrder(orgId, id, { ...body, actor: session.username });
        if (out.error) {
          /* 409 for "this order can't take a delivery", 422 for a quantity that
             exceeds what was ordered (the body is well formed, the world
             disagrees), 400 for the rest. The extra fields on `over` travel with
             it so the interface can name the remaining quantity. */
          const code = out.error === "notopen" ? 409 : out.error === "over" ? 422 : 400;
          return res.status(code).json(out);
        }
        /* The invoice is recorded on the audit line: this is the entry that
           connects stock on the shelf to money leaving the business. */
        await recordAudit(orgId, {
          actor: session.username, action: "po.receive", target: id,
          detail: {
            branchId: out.order.branchId,
            receiptId: out.receipt.id,
            invoiceNo: out.receipt.invoiceNo || null,
            lines: out.receipt.lines.length,
            invoiceTotal: out.receipt.invoiceTotal,
            priceVariance: out.order.summary?.priceVarianceValue ?? null,
          },
        });
        return res.status(200).json({ order: await getOrder(orgId, id), receipt: out.receipt });
      }

      if (what === "return") {
        const out = await returnToSupplier(orgId, id, { ...body, actor: session.username });
        if (out.error) {
          const code = out.error === "overreturn" ? 422 : out.error === "nothingreceived" ? 409 : 400;
          return res.status(code).json(out);
        }
        await recordAudit(orgId, {
          actor: session.username, action: "po.return", target: id,
          detail: {
            branchId: out.order.branchId,
            ingredientId: body.ingredientId,
            movementId: out.movementId,
            reason: String(body.reason || "").trim() || null,
          },
        });
        return res.status(200).json({ order: await getOrder(orgId, id) });
      }

      return res.status(400).json({ error: "what" });
    }

    /* No DELETE: a cancelled order is kept, and a received one is history. */
    return res.status(405).json({ error: "Use GET or POST." });
  } catch (err) {
    console.error("purchasing endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
