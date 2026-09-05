/* What the webhook actually delivered, and what each delivery did.

   ── Why this is not the sales list ───────────────────────────────────────

   The Sales screen reads the till: everything Loyverse holds, corrections and
   all. It answers a business question — what did we sell.

   This answers an operational one. Did the webhook fire? What arrived, when,
   and what happened to stock as a result? Those are not the same list and
   cannot be derived from each other: a receipt can exist in the till and never
   have been delivered here, and a delivery can arrive and deduct nothing at
   all because the dish has no recipe. Reading the till would show the first
   case as if it had worked and hide the second entirely.

   ── What is kept ─────────────────────────────────────────────────────────

   The receipt as it arrived, plus the outcome — which is the part that has no
   other home. "Deducted four lines", "skipped, it was a refund", "nothing to
   deduct, no recipe for Cheeseburger". That last one is the commonest reason
   stock stops moving and there has never been anywhere to see it.

   Capped, newest first, and deliberately not a second ledger: the movements
   themselves live in the stock ledger, which is append-only and is the record.
   This is a delivery receipt for the integration, and three hundred entries is
   a fortnight of a busy kitchen — enough to answer "did last night arrive?"
   and far short of a place anybody would try to do accounting from. */

import { getJSON, setJSON, del } from "./_store.js";

const KEY = (orgId) => `poshook:log:${orgId}`;

const MAX_ENTRIES = 300;

/* Why a delivery did or did not move stock. Closed, because an unrecognised
   outcome would render as a blank cell nobody could interpret. */
export const OUTCOMES = {
  deducted: "stock was deducted",
  norecipe: "no recipe for the items sold",
  refund: "a refund, which does not move stock",
  cancelled: "a cancelled sale",
  disabled: "automatic depletion is switched off",
  nostore: "the receipt named no store",
  duplicate: "already processed",
};

export async function listDeliveries(orgId, { limit = 100, branchId } = {}) {
  if (!orgId) return [];
  const rows = (await getJSON(KEY(orgId))) || [];
  return rows
    .filter((r) => !branchId || String(r.branchId) === String(branchId))
    .slice(0, Math.min(Math.max(Number(limit) || 100, 1), MAX_ENTRIES));
}

/* Record a batch, newest first.

   Idempotent on receipt number: Loyverse retries, and a retry that already
   deducted must not appear twice in a list somebody is using to check whether
   something was double-counted. An entry that arrives again *replaces* the
   earlier one rather than being dropped, because the second delivery may
   carry a different outcome — a receipt that found no recipe on Monday and
   deducted on Tuesday, once the recipe was written, should read as the
   latter. */
export async function recordDeliveries(orgId, entries) {
  if (!orgId || !entries?.length) return { recorded: 0 };

  const existing = (await getJSON(KEY(orgId))) || [];
  const incoming = entries.map((e) => ({
    receiptNumber: String(e.receiptNumber || ""),
    branchId: String(e.branchId || ""),
    /* When the sale happened, and when we heard about it. Both, because the
       gap between them is the only measure of whether delivery is prompt. */
    at: Number(e.at) || Date.now(),
    receivedAt: Number(e.receivedAt) || Date.now(),
    total: Number(e.total) || 0,
    lines: (e.lines || []).slice(0, 20).map((l) => ({
      name: String(l.name || ""),
      qty: Number(l.qty) || 0,
    })),
    lineCount: (e.lines || []).length,
    outcome: OUTCOMES[e.outcome] ? e.outcome : "deducted",
    movements: Number(e.movements) || 0,
    /* Named rather than counted: "no recipe" is only actionable if you know
       which dish. */
    unmatched: (e.unmatched || []).slice(0, 10),
  })).filter((e) => e.receiptNumber);

  if (!incoming.length) return { recorded: 0 };

  const seen = new Set(incoming.map((e) => e.receiptNumber));
  const next = [...incoming, ...existing.filter((e) => !seen.has(e.receiptNumber))]
    .slice(0, MAX_ENTRIES);

  await setJSON(KEY(orgId), next);
  return { recorded: incoming.length };
}

export async function clearDeliveries(orgId) {
  await del(KEY(orgId));
  return { cleared: true };
}
