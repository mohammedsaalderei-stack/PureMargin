/* Stock counts over HTTP — stage 4, phase 3.

   The authorization split is the point of this route, not a detail of it:
   `manage:inventory` opens, fills and submits a count, while `approve:counts`
   is what turns it into stock adjustments. The chef role has the first and not
   the second, so the person who counted cannot be the person who signed it off
   without somebody deciding they should be.

   Branch scope is the same intersection rule as everywhere else, applied to the
   branch the count belongs to — never to a branch named in the body.

   GET     ?what=list[&status=]           — counts across authorized branches
           ?what=count&id=                — one count with variance and totals
   POST    ?what=open      { branchId, category|location|ingredientIds, spot, name }
           ?what=lines     { id, lines: [{ ingredientId, countedQty, unit, reason, note }] }
           ?what=submit    { id }         — draft → review
           ?what=reopen    { id }         — review → draft (approver only)
           ?what=approve   { id }         — writes the adjustments (approver only)
           ?what=cancel    { id, reason }
*/

import { requireAuth } from "./_auth.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { posTokenFor } from "./_accounts.js";
import { branchList } from "./_data.js";
import { recordAudit } from "./_audit.js";
import { getMeta } from "./_inventory.js";
import {
  openCount, saveLines, submitCount, reopenCount, cancelCount, approveCount,
  getCount, listCounts, VARIANCE_REASONS,
} from "./_counts.js";

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

    /* Every path that names an existing count resolves it the same way: load it,
       then check its branch against this user's scope. Doing it here means no
       branch check can be forgotten on one action. */
    async function mine(id, { priced = false } = {}) {
      const count = await getCount(orgId, String(id || ""), { priced });
      if (!count) return { error: "notfound" };
      if (!effectiveBranches([String(count.branchId)], allowed).length) return { error: "branch" };
      return { count };
    }

    if (req.method === "GET") {
      if (what === "count") {
        const found = await mine(req.query?.id, { priced: true });
        if (found.error === "notfound") return res.status(404).json({ error: found.error });
        if (found.error) return res.status(403).json({ error: found.error });
        return res.status(200).json({
          count: found.count,
          canManage: may("manage:inventory"),
          canApprove: may("approve:counts"),
          reasons: VARIANCE_REASONS,
        });
      }

      const branches = effectiveBranches(parseBranchParam(req.query?.branches), allowed);
      return res.status(200).json({
        counts: await listCounts(orgId, branches, { status: String(req.query?.status || "") || undefined }),
        branches,
        branchNames: Object.fromEntries(
          roster.filter((b) => branches.includes(String(b.id))).map((b) => [String(b.id), b.name])
        ),
        meta: await getMeta(orgId),
        reasons: VARIANCE_REASONS,
        canManage: may("manage:inventory"),
        canApprove: may("approve:counts"),
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};

      if (what === "open") {
        if (!may("manage:inventory")) return res.status(403).json({ error: "forbidden" });
        const branch = effectiveBranches([String(body.branchId || "")], allowed);
        if (!branch.length) return res.status(403).json({ error: "branch" });

        const out = await openCount(orgId, branch[0], { ...body, actor: session.username });
        if (out.error) return res.status(400).json({ error: out.error });
        await recordAudit(orgId, {
          actor: session.username, action: "count.open", target: out.count.id,
          detail: { branchId: branch[0], lines: out.count.lines.length, spot: out.count.spot },
        });
        return res.status(200).json({ count: out.count });
      }

      /* Filling in and submitting belong to whoever manages inventory. */
      if (what === "lines" || what === "submit" || what === "cancel") {
        if (!may("manage:inventory")) return res.status(403).json({ error: "forbidden" });
        const found = await mine(body.id);
        if (found.error === "notfound") return res.status(404).json({ error: found.error });
        if (found.error) return res.status(403).json({ error: found.error });

        if (what === "lines") {
          const out = await saveLines(orgId, found.count.id, body.lines, { actor: session.username });
          if (out.error) return res.status(400).json({ error: out.error });
          return res.status(200).json({ count: out.count });
        }

        if (what === "submit") {
          const out = await submitCount(orgId, found.count.id, { actor: session.username });
          if (out.error) return res.status(409).json({ error: out.error });
          await recordAudit(orgId, {
            actor: session.username, action: "count.submit", target: out.count.id,
            detail: { branchId: out.count.branchId },
          });
          return res.status(200).json({ count: out.count });
        }

        const out = await cancelCount(orgId, found.count.id, { actor: session.username, reason: body.reason });
        if (out.error) return res.status(409).json({ error: out.error });
        await recordAudit(orgId, {
          actor: session.username, action: "count.cancel", target: out.count.id,
          detail: { branchId: out.count.branchId, reason: out.count.cancelReason },
        });
        return res.status(200).json({ count: out.count });
      }

      /* Approval and sending one back are the reviewer's, and only theirs. */
      if (what === "approve" || what === "reopen") {
        if (!may("approve:counts")) return res.status(403).json({ error: "approval" });
        const found = await mine(body.id);
        if (found.error === "notfound") return res.status(404).json({ error: found.error });
        if (found.error) return res.status(403).json({ error: found.error });

        if (what === "reopen") {
          const out = await reopenCount(orgId, found.count.id, { actor: session.username });
          if (out.error) return res.status(409).json({ error: out.error });
          await recordAudit(orgId, {
            actor: session.username, action: "count.reopen", target: out.count.id,
            detail: { branchId: out.count.branchId },
          });
          return res.status(200).json({ count: out.count });
        }

        const out = await approveCount(orgId, found.count.id, { actor: session.username });
        if (out.error) return res.status(409).json({ error: out.error });
        await recordAudit(orgId, {
          actor: session.username, action: "count.approve", target: out.count.id,
          detail: {
            branchId: out.count.branchId,
            adjustments: out.movementIds.length,
            netValue: out.count.totals?.netValue ?? null,
          },
        });
        return res.status(200).json({ count: out.count, movementIds: out.movementIds });
      }

      return res.status(400).json({ error: "what" });
    }

    /* No DELETE: a cancelled count is kept, and an approved one is history. */
    return res.status(405).json({ error: "Use GET or POST." });
  } catch (err) {
    console.error("counts endpoint failed:", err);
    return res.status(500).json({ error: "server" });
  }
}
