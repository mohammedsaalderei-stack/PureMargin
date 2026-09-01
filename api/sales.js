import { requireAuth } from "./_auth.js";
import { posTokenFor } from "./_accounts.js";
import { scopeFor, effectiveBranches, parseBranchParam } from "./_org.js";
import { recordAudit } from "./_audit.js";
import { branchList, rawReceipts, NotConnected, PosUnreachable } from "./_data.js";
import {
  listEdits, saveEdit, removeEdit, applyEdit, snapshotOf, isStale,
  differenceOf, receiptIdOf, EDIT_REASONS,
} from "./_saleedits.js";

/* Sales as the till reported them, and the corrections made to them.

   GET     ?days=7&branches=  — receipts, each with its correction if it has one
   POST                       — correct or void one
   DELETE  ?receiptId         — undo a correction, restoring the till's figure

   Reading needs `view:dashboard`, because the sale list is the day's trading
   and everybody who sees the dashboard sees that. Changing one needs
   `adjust:sales`, which the cashier deliberately does not have.

   Branch scope is resolved the same way as everywhere else: the POS says which
   branches exist, the session says which of those this person may read, and
   `?branches=` may only narrow that further. A receipt outside the resulting
   scope is not listed and cannot be corrected — the check is repeated on write
   rather than trusted from the read, since the two are separate requests. */

const MAX_DAYS = 60;

export default async function handler(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return;

  try {
    const posToken = await posTokenFor(session.username);
    const allBranches = (await branchList(posToken)).map((b) => b.id);
    const scope = await scopeFor(session.account, allBranches);
    const orgId = scope.org?.id;
    if (!orgId) return res.status(403).json({ error: "noorg" });

    if (!scope.capabilities.includes("view:dashboard")) {
      return res.status(403).json({ error: "forbidden" });
    }
    const mayAdjust = scope.capabilities.includes("adjust:sales");

    const requested = effectiveBranches(parseBranchParam(req.query?.branches), scope.authorized);

    if (req.method === "GET") {
      const days = Math.min(Math.max(Number(req.query?.days) || 7, 1), MAX_DAYS);
      const edits = await listEdits(orgId);
      const receipts = await rawReceipts(posToken, { days });

      const allowed = new Set(requested.map(String));
      const rows = [];
      for (const r of receipts) {
        const branchId = String(r.store_id || "unknown");
        if (allowed.size && !allowed.has(branchId)) continue;

        const id = receiptIdOf(r);
        if (!id) continue;
        const edit = edits[id] || null;
        const corrected = applyEdit(r, edit);

        rows.push({
          id,
          branchId,
          at: r.receipt_date || null,
          /* Both figures always travel together. A screen that shows only the
             corrected number gives nobody a way to see the size of what was
             changed, which is the first thing anyone asks. */
          till: snapshotOf(r),
          current: corrected ? snapshotOf(corrected) : null,
          refunded: r.receipt_type === "REFUND" || Boolean(r.cancelled_at),
          edit: edit && {
            ...edit,
            difference: differenceOf(edit),
            /* The till moved under this correction — somebody fixed it
               upstream as well. Reported, never resolved here. */
            stale: isStale(r, edit),
          },
        });
      }

      rows.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
      return res.status(200).json({
        sales: rows, days, mayAdjust, reasons: EDIT_REASONS,
      });
    }

    if (!mayAdjust) return res.status(403).json({ error: "notallowed" });

    if (req.method === "POST") {
      const body = req.body || {};
      const receiptId = String(body.receiptId || "");

      /* The receipt is fetched rather than taken from the request. The client
         sends an id; the original total, the branch and the line shape all
         come from the till, so a body claiming a receipt was 9,000 cannot
         make the recorded correction look small. */
      const receipts = await rawReceipts(posToken, { days: MAX_DAYS });
      const receipt = receipts.find((r) => receiptIdOf(r) === receiptId);
      if (!receipt) return res.status(404).json({ error: "notfound" });

      const branchId = String(receipt.store_id || "unknown");
      if (!effectiveBranches([branchId], scope.authorized).length) {
        return res.status(403).json({ error: "outofscope" });
      }

      const { edit, created, error } = await saveEdit(
        orgId,
        { ...body, receiptId, branchId },
        { actor: session.username, receipt },
      );
      if (error) return res.status(400).json({ error });

      await recordAudit(orgId, {
        actor: session.username,
        action: edit.voided ? "sale.void" : (created ? "sale.correct" : "sale.recorrect"),
        target: receiptId,
        detail: {
          branchId,
          reason: edit.reason,
          was: edit.original?.total ?? null,
          now: edit.voided ? 0 : (edit.total ?? null),
        },
      });

      return res.status(200).json({ edit });
    }

    if (req.method === "DELETE") {
      const receiptId = String(req.query?.receiptId || "");
      if (!receiptId) return res.status(400).json({ error: "receiptId" });

      const before = (await listEdits(orgId))[receiptId] || null;
      if (before?.branchId && !effectiveBranches([before.branchId], scope.authorized).length) {
        return res.status(403).json({ error: "outofscope" });
      }

      const out = await removeEdit(orgId, receiptId);
      if (out.error) return res.status(404).json({ error: out.error });

      await recordAudit(orgId, {
        actor: session.username,
        action: "sale.restore",
        target: receiptId,
        detail: { reason: before?.reason || null },
      });
      return res.status(200).json(out);
    }

    return res.status(405).json({ error: "Use GET, POST or DELETE." });
  } catch (err) {
    if (err instanceof NotConnected) return res.status(409).json({ error: "notconnected" });
    if (err instanceof PosUnreachable) return res.status(502).json({ error: "pos", detail: err.detail });
    console.error("sales failed:", err?.message || err);
    return res.status(500).json({ error: "server" });
  }
}
