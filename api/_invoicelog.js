import { createHash } from "node:crypto";
import { getJSON, setJSON } from "./_store.js";

/* Deliveries that have been committed, so the same one is not received twice.

   ── The gap ──────────────────────────────────────────────────────────────

   `_salesdepletion.js` is careful about this: it remembers every till receipt
   it has posted, so a webhook retry or a poller finding the same sale a minute
   later deducts nothing the second time. The invoice path had no equivalent.
   Scanning the same delivery note twice received it twice, in full, silently —
   and the only sign was a balance that had quietly doubled, which looks
   exactly like a balance that is correct.

   It showed up as somebody re-scanning one stock sheet while testing: brioche
   buns went 77, then 137, then 272. Nothing was broken. Each scan really was
   a delivery as far as the ledger could tell, because nothing had told it
   otherwise.

   ── Why a fingerprint and not the invoice number ─────────────────────────

   The invoice number is the obvious key and it is usually absent. Plenty of
   documents do not carry one — a stock sheet, a hand-written note, a supplier
   who leaves the field blank — and the movements already store what number
   there was. Keying on it would protect the deliveries that need it least.

   So the key is what was actually received: the ingredients and the quantities,
   in base units, sorted. A repeat scan of one document produces exactly that
   set again. Two genuinely separate deliveries of the same things in the same
   amounts on the same day are possible, which is why this asks rather than
   refuses — a question somebody answers in one tap, against a doubling nobody
   would otherwise notice.

   ── What it also makes possible ──────────────────────────────────────────

   The movement ids are kept with it, so a delivery can be undone as a
   delivery. Reversal already existed per entry, which for a forty-eight line
   invoice is forty-eight confirmations — an undo nobody would ever use. */

const KEY = (orgId, branchId) => `inv:${orgId}:invoices:${branchId}`;

/* Enough to cover a busy month of deliveries. Trimmed oldest-first: an old
   delivery is not the one somebody is about to scan again by accident. */
const MAX_REMEMBERED = 400;

/* How long a repeat still counts as a repeat.

   A second delivery of the same things a week later is ordinary trade. The
   same one twice in an afternoon is a double scan, which is the mistake this
   exists for. */
export const REPEAT_WINDOW_MS = 36 * 60 * 60 * 1000;

/* What was received, independent of how it was described.

   Base units, so the same delivery read once as "5 kg" and once as "5000 g"
   is one fingerprint. Sorted, so line order cannot change it. Rounded, because
   a conversion through litres and back can leave a millionth behind and two
   readings of one document must not differ by it. */
export function fingerprint(movements) {
  const parts = (movements || [])
    .map((m) => `${m.ingredientId}:${Math.round(Number(m.qtyBase) * 1000) / 1000}`)
    .sort();
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

export async function listInvoices(orgId, branchId) {
  return (await getJSON(KEY(orgId, branchId))) || [];
}

/* The most recent commit of this exact set, inside the window. */
export async function findRepeat(orgId, branchId, print, { now = Date.now() } = {}) {
  const seen = await listInvoices(orgId, branchId);
  return seen.find((d) =>
    d.fingerprint === print
    && !d.undone
    && now - d.at <= REPEAT_WINDOW_MS) || null;
}

let counter = 0;
const newId = () =>
  `d${Date.now().toString(36)}${(counter = (counter + 1) % 1e4).toString(36).padStart(3, "0")}`;

export async function rememberInvoice(orgId, branchId, entry) {
  const seen = await listInvoices(orgId, branchId);
  const record = {
    id: newId(),
    at: Date.now(),
    fingerprint: entry.fingerprint,
    supplier: String(entry.supplier || "").slice(0, 120),
    invoiceNo: String(entry.invoiceNo || "").slice(0, 60),
    actor: String(entry.actor || "").slice(0, 80),
    /* The entries this delivery wrote, so it can be taken back as one thing. */
    movementIds: (entry.movementIds || []).map(String),
    lines: Number(entry.lines) || 0,
    undone: false,
  };
  const next = [record, ...seen].slice(0, MAX_REMEMBERED);
  await setJSON(KEY(orgId, branchId), next);
  return record;
}

export async function getInvoice(orgId, branchId, id) {
  return (await listInvoices(orgId, branchId)).find((d) => d.id === String(id)) || null;
}

/* Marked rather than removed, like everything else in this ledger: a delivery
   that was received and then taken back is part of what happened. */
export async function markUndone(orgId, branchId, id, { reversed }) {
  const seen = await listInvoices(orgId, branchId);
  const next = seen.map((d) =>
    d.id === String(id)
      ? { ...d, undone: true, undoneAt: Date.now(), reversed: Number(reversed) || 0 }
      : d);
  await setJSON(KEY(orgId, branchId), next);
  return next.find((d) => d.id === String(id)) || null;
}
