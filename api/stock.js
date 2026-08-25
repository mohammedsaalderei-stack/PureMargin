/* The stock ledger over HTTP — stage 4, phase 2.

   Kept apart from `api/inventory.js` because the two answer different questions
   and are gated differently in practice: that route is master data (what an
   ingredient IS), this one is history (what happened to it, and where). Merging
   them would also merge their branch handling, and this is the route where
   branch scope matters most — every entry belongs to exactly one branch.

   Authorization, per the direction document, is the intersection and nothing
   else: `effective_branches = requested_branches ∩ user_authorized_branches`.
   A branch id in a request body is a *request*, never a grant. A branch manager
   who edits the id posts into their own scope or gets a 403; there is no shape
   of this request that writes into a branch they can't already see.

   GET     ?what=balances[&branches=a,b]  — derived on-hand, per ingredient
           ?what=ledger&branch=<id>[&ingredientId=&type=&from=&to=]
   POST    ?what=movement   — one entry, body { branchId, ingredientId, type, qty, unit, ... }
           ?what=transfer   — two linked entries between branches
           ?what=reverse    — the only correction: body { branchId, id, reason }
           ?what=policy     — negative-stock policy, owner-level (manage:inventory)
*/

import { requireAuth } from "./_auth.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { posTokenFor } from "./_accounts.js";
import { branchList } from "./_data.js";
import { recordAudit } from "./_audit.js";
import { listIngredients } from "./_inventory.js";
import { unitsByDimension } from "./_units.js";
import {
  MOVEMENT_KEYS, recordMovement, recordTransfer, reverseMovement,
  listMovements, balances, getPolicy, savePolicy,
} from "./_movements.js";

/* Branches come from the POS (phase 1's decision: a branch is a store, not a
   local table), so a missing connection means no branches rather than an error. */
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

    const what = String(req.query?.what || "balances");
    const allowed = scope.authorized;
    /* One helper for every branch id that arrives from a client, so no route
       below can forget the intersection. */
    const permitted = (id) => effectiveBranches([String(id || "")], allowed);

    res.setHeader("Cache-Control", "no-store");

    if (req.method === "GET") {
      if (what === "ledger") {
        const branch = permitted(req.query?.branch);
        if (!branch.length) return res.status(403).json({ error: "branch" });
        return res.status(200).json({
          branchId: branch[0],
          movements: await listMovements(orgId, branch[0], {
            ingredientId: String(req.query?.ingredientId || "") || undefined,
            type: String(req.query?.type || "") || undefined,
            from: Number(req.query?.from) || undefined,
            to: Number(req.query?.to) || undefined,
          }),
        });
      }

      /* Balances default to everything the user may see, which is what keeps an
         owner's view one consolidated total rather than a branch at a time. */
      const branches = effectiveBranches(parseBranchParam(req.query?.branches), allowed);
      const ingredients = await listIngredients(orgId, { includeArchived: true });
      return res.status(200).json({
        branches,
        branchNames: Object.fromEntries(
          roster.filter((b) => branches.includes(String(b.id))).map((b) => [String(b.id), b.name])
        ),
        rows: await balances(orgId, branches, { ingredients }),
        policy: await getPolicy(orgId),
        types: MOVEMENT_KEYS,
        units: unitsByDimension(),
        canManage: may("manage:inventory"),
        /* Provenance, stage 3's rule applied here too: a total is meaningless
           without the scope it was computed over. */
        scope: { branchCount: branches.length, totalBranches: roster.length },
      });
    }

    if (req.method === "POST") {
      if (!may("manage:inventory")) return res.status(403).json({ error: "forbidden" });
      const body = req.body || {};

      if (what === "policy") {
        const policy = await savePolicy(orgId, body);
        await recordAudit(orgId, {
          actor: session.username, action: "stock.policy",
          detail: { allowNegative: policy.allowNegative },
        });
        return res.status(200).json({ policy });
      }

      if (what === "movement") {
        const branch = permitted(body.branchId);
        if (!branch.length) return res.status(403).json({ error: "branch" });

        const out = await recordMovement(orgId, branch[0], { ...body, actor: session.username });
        if (out.error === "negative") {
          return res.status(409).json({ error: out.error, onHand: out.onHand, short: out.short });
        }
        if (out.error) return res.status(400).json({ error: out.error });

        await recordAudit(orgId, {
          actor: session.username, action: "stock.movement", target: out.movement.ingredientId,
          detail: {
            type: out.movement.type, qty: out.movement.qty,
            unit: out.movement.unit, branchId: branch[0],
          },
        });
        return res.status(200).json({ movement: out.movement });
      }

      /* A whole bill's consumption, committed together.

         The single-movement route would work in a loop from the browser, but a
         dropped connection halfway through a twelve-ingredient bill leaves the
         ledger holding part of a meal — and nothing on the screen or in the log
         would say which part. So the set is validated first and written only
         if every line passes.

         This is not a transaction; the store has no such thing. What it buys is
         that the common failure — one ingredient short, one unit mismatched — is
         caught before anything moves, rather than after five entries already
         have. */
      if (what === "consume") {
        const branch = permitted(body.branchId);
        if (!branch.length) return res.status(403).json({ error: "branch" });

        const rows = Array.isArray(body.movements) ? body.movements : [];
        if (!rows.length) return res.status(400).json({ error: "empty" });

        const prepared = rows.map((row) => ({
          ingredientId: String(row.ingredientId || ""),
          qty: Number(row.qty),
          unit: String(row.unit || ""),
          type: "consume",
          note: String(body.note || "").slice(0, 200),
        }));

        if (prepared.some((r) => !r.ingredientId || !(r.qty > 0) || !r.unit)) {
          return res.status(400).json({ error: "line" });
        }

        const dry = await Promise.all(
          prepared.map((r) => recordMovement(orgId, branch[0], { ...r, actor: session.username, dryRun: true })),
        );
        const refused = dry.find((d) => d.error);
        if (refused) {
          return res.status(refused.error === "negative" ? 409 : 400).json({
            error: refused.error,
            ingredientId: refused.ingredientId || null,
            onHand: refused.onHand,
            short: refused.short,
          });
        }

        const written = [];
        for (const r of prepared) {
          const out = await recordMovement(orgId, branch[0], { ...r, actor: session.username });
          if (out.error) break;
          written.push(out.movement);
        }

        await recordAudit(orgId, {
          actor: session.username,
          action: "stock.consume",
          detail: { branchId: branch[0], lines: written.length, source: "billscan" },
        });

        return res.status(200).json({ movements: written });
      }

      if (what === "transfer") {
        /* Both ends are checked. A user authorized for one branch cannot push
           stock into — or pull it out of — a branch they can't see. */
        const from = permitted(body.fromBranchId);
        const to = permitted(body.toBranchId);
        if (!from.length || !to.length) return res.status(403).json({ error: "branch" });

        const out = await recordTransfer(orgId, {
          ...body, fromBranchId: from[0], toBranchId: to[0], actor: session.username,
        });
        if (out.error === "negative") {
          return res.status(409).json({ error: out.error, onHand: out.onHand, short: out.short });
        }
        if (out.error) return res.status(400).json({ error: out.error });

        await recordAudit(orgId, {
          actor: session.username, action: "stock.transfer", target: out.out.ingredientId,
          detail: { qty: Math.abs(out.out.qty), unit: out.out.unit, from: from[0], to: to[0] },
        });
        return res.status(200).json(out);
      }

      if (what === "reverse") {
        const branch = permitted(body.branchId);
        if (!branch.length) return res.status(403).json({ error: "branch" });

        const out = await reverseMovement(orgId, branch[0], String(body.id || ""), {
          actor: session.username, reason: body.reason,
        });
        if (out.error === "notfound") return res.status(404).json({ error: out.error });
        if (out.error) return res.status(409).json({ error: out.error });

        await recordAudit(orgId, {
          actor: session.username, action: "stock.reverse", target: out.movement.ingredientId,
          detail: { of: out.movement.reverses, type: out.movement.type, branchId: branch[0] },
        });
        return res.status(200).json(out);
      }

      return res.status(400).json({ error: "what" });
    }

    /* No DELETE. The ledger is corrected by reversal, never removed — see
       `api/_movements.js`. */
    return res.status(405).json({ error: "Use GET or POST." });
  } catch (err) {
    console.error("stock endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
