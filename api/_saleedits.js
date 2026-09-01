import { getJSON, setJSON } from "./_store.js";

/* Corrections to what the till reported.

   ── Why this exists ──────────────────────────────────────────────────────

   The POS is the system of record for what was sold, and this app has always
   read it and never written back. That is the right default — but it left no
   answer at all for the ordinary case where the till is simply wrong. A
   cashier rings a 250 dish as 2,500. A table is put through twice. An order is
   rung up on the wrong item and voided on paper but not in the system. Until
   now the only options were to accept a figure everyone in the restaurant
   knows is false, or to fix it in the POS and wait for a refetch that may not
   carry historical corrections at all.

   ── An overlay, never a rewrite ──────────────────────────────────────────

   Nothing here mutates a receipt. Corrections are stored separately, keyed by
   the receipt's own id, and applied on read. Three things follow from that,
   and all three are the reason for the design:

   The original survives. Every correction keeps `original`, so the screen can
   always show what the till said next to what it was changed to, and an
   accountant can see the size of the correction rather than only its result.

   It is reversible. Deleting a correction restores the POS figure exactly,
   because the POS figure was never touched.

   It cannot drift. If the till is later fixed upstream and refetched, the
   correction is still keyed to the same receipt id and still applies — which
   is a hazard, not a feature, so `original` is compared on read and a
   correction whose basis no longer matches is flagged `stale` rather than
   silently applied on top of a number that already moved.

   ── Voiding is not deleting ──────────────────────────────────────────────

   "Remove this sale" marks it void. It stays in the store, keeps its original
   total, and stops counting. A sale that vanishes from both the POS reading
   and the correction log is a sale nobody can account for, and the first
   question anybody asks about a corrected figure is what was taken out of it.

   ── What a correction may change ─────────────────────────────────────────

   The whole receipt (void), a line (void, quantity, amount), or the receipt
   total outright. The total override exists because a receipt carries tax,
   service and discounts this module does not model; when somebody knows the
   right total, forcing them to make the lines add up to it would be asking
   them to fabricate detail. When lines are edited and no total is given, the
   total is recomputed from the lines and the non-line remainder (tax, service)
   is carried across proportionally rather than dropped. */

const KEY = (orgId) => `sales:${orgId}:edits`;

/* How a receipt is identified, in one place.

   `_data.js` already derives this the same way for its own listing, and the
   two must not drift: an overlay keyed one way and looked up another applies
   to nothing, silently, and the screen shows a correction that never reaches a
   total. Exported from here rather than from `_data.js` so the store module
   stays free of a POS import. */
export function receiptIdOf(r) {
  if (!r) return "";
  return String(r.receipt_number || r.id || r.receipt_id || "");
}

export const EDIT_REASONS = [
  "wrongamount",   // rung up at the wrong price
  "wrongitem",     // the wrong item was rung up
  "duplicate",     // the same sale entered twice
  "notcompleted",  // rung up but never served or paid
  "training",      // a test transaction on a live till
  "other",
];

export function validateEdit({ receiptId, reason, voided, lines, total }) {
  if (!String(receiptId || "").trim()) return "receiptId";
  if (!EDIT_REASONS.includes(reason)) return "reason";

  /* A correction that changes nothing is refused rather than stored. An empty
     record would show as "corrected" on the screen with no difference to
     show, which reads as a bug in the app rather than as an empty edit. */
  const touchesLines = lines && Object.keys(lines).length > 0;
  if (!voided && !touchesLines && (total === null || total === undefined)) return "empty";

  if (total !== null && total !== undefined && !(Number(total) >= 0)) return "total";

  for (const line of Object.values(lines || {})) {
    if (line.qty !== null && line.qty !== undefined && !(Number(line.qty) >= 0)) return "qty";
    if (line.amount !== null && line.amount !== undefined && !(Number(line.amount) >= 0)) return "amount";
  }
  return null;
}

const money = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* What the till said, captured at the moment of correcting so the two can be
   shown side by side later. */
export function snapshotOf(receipt) {
  return {
    total: money(receipt?.total_money),
    at: receipt?.receipt_date || null,
    lines: (receipt?.line_items || []).map((li) => ({
      name: li.item_name || "",
      qty: Number(li.quantity) || 0,
      amount: money(li.total_money),
    })),
  };
}

export async function listEdits(orgId) {
  if (!orgId) return {};
  return (await getJSON(KEY(orgId))) || {};
}

export async function saveEdit(orgId, input, { actor = "", receipt = null } = {}) {
  const error = validateEdit(input);
  if (error) return { error };

  const map = await listEdits(orgId);
  const id = String(input.receiptId);
  const existing = map[id] || null;

  const lines = {};
  for (const [index, line] of Object.entries(input.lines || {})) {
    if (!/^\d+$/.test(String(index))) continue;
    lines[String(index)] = {
      voided: Boolean(line.voided),
      qty: line.qty === null || line.qty === undefined ? null : money(line.qty),
      amount: line.amount === null || line.amount === undefined ? null : money(line.amount),
    };
  }

  const edit = {
    receiptId: id,
    branchId: input.branchId ? String(input.branchId) : (existing?.branchId || null),
    voided: Boolean(input.voided),
    lines,
    total: input.total === null || input.total === undefined ? null : money(input.total),
    reason: input.reason,
    note: String(input.note || "").slice(0, 300),
    /* Captured on first correction only. A second edit of the same receipt is
       still a correction of what the till originally said, not of the first
       correction — overwriting this would make the recorded difference shrink
       every time somebody adjusted their own adjustment. */
    original: existing?.original || (receipt ? snapshotOf(receipt) : null),
    by: actor || existing?.by || "",
    at: existing?.at || Date.now(),
    updatedAt: Date.now(),
  };

  map[id] = edit;
  await setJSON(KEY(orgId), map);
  return { edit, created: !existing };
}

/* Restoring the till's own figure. The POS record was never altered, so this
   is a delete of the overlay and nothing more. */
export async function removeEdit(orgId, receiptId) {
  const map = await listEdits(orgId);
  const id = String(receiptId);
  if (!map[id]) return { error: "notfound" };
  delete map[id];
  await setJSON(KEY(orgId), map);
  return { restored: true, receiptId: id };
}

/* Apply one correction to one receipt, returning a receipt in the same shape
   the aggregator already expects.

   Returns `null` for a voided receipt, because every caller's next move is to
   skip it — the same treatment refunds and cancelled receipts already get. */
export function applyEdit(receipt, edit) {
  if (!edit) return receipt;
  if (edit.voided) return null;

  const originalTotal = money(receipt.total_money);
  const items = receipt.line_items || [];

  let touched = false;
  const lines = [];
  let lineSumBefore = 0;
  let lineSumAfter = 0;

  items.forEach((li, index) => {
    lineSumBefore += money(li.total_money);
    const patch = edit.lines?.[String(index)];
    if (!patch) { lines.push(li); lineSumAfter += money(li.total_money); return; }

    touched = true;
    if (patch.voided) return;

    const qty = patch.qty === null ? Number(li.quantity) || 0 : patch.qty;
    const amount = patch.amount === null ? money(li.total_money) : patch.amount;
    lines.push({ ...li, quantity: qty, total_money: amount });
    lineSumAfter += amount;
  });

  let total;
  if (edit.total !== null && edit.total !== undefined) {
    total = edit.total;
  } else if (touched) {
    /* Tax and service sit outside the line total. Dropping the remainder would
       make every corrected receipt quietly cheaper than it was by the tax on
       the lines nobody touched; scaling it keeps the same proportion the till
       charged. */
    const remainder = originalTotal - lineSumBefore;
    const ratio = lineSumBefore > 0 ? lineSumAfter / lineSumBefore : 0;
    total = money(lineSumAfter + remainder * ratio);
  } else {
    total = originalTotal;
  }

  return { ...receipt, total_money: total, line_items: lines };
}

/* The whole overlay, over a list of receipts. Voided receipts drop out. */
export function applyEdits(receipts = [], edits = {}) {
  if (!edits || Object.keys(edits).length === 0) return receipts;
  const out = [];
  for (const r of receipts) {
    const corrected = applyEdit(r, edits[receiptIdOf(r)]);
    if (corrected) out.push(corrected);
  }
  return out;
}

/* Whether the till has moved under a correction since it was made.

   If somebody also fixed the receipt in the POS, the original this correction
   was written against no longer matches what comes back, and applying it on
   top would correct an already-corrected figure. Reported, never resolved
   automatically: only a person knows which of the two is now right. */
export function isStale(receipt, edit) {
  if (!edit?.original || !receipt) return false;
  return money(receipt.total_money) !== money(edit.original.total);
}

export function differenceOf(edit) {
  if (!edit?.original) return null;
  if (edit.voided) return money(-edit.original.total);
  if (edit.total !== null && edit.total !== undefined) {
    return money(edit.total - edit.original.total);
  }
  return null;
}
