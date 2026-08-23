/* The stock-movement ledger — stage 4, phase 2.

   This is the file that makes inventory real. Phase 1 defined what an
   ingredient is; nothing in it knows how much of anything there is, on purpose.
   A balance is not a field somebody edits, it is the sum of every movement ever
   recorded for that ingredient in that branch. Keeping it derived is the whole
   design: there is exactly one truth, and it can always be explained by pointing
   at the entries that produced it.

   Two rules from the direction document are structural here rather than
   conventions somebody has to remember:

   1. The ledger is never deleted. A mistake is corrected by a reversing entry
      that points at the original, so the history of the correction survives
      alongside it. `remove` does not exist in this file, and must not be added.
   2. Every quantity is stored twice — as it was entered (`qty` + `unit`, which is
      what a human recognises) and in the ingredient's base unit (`qtyBase`,
      which is what arithmetic uses). Summing entries recorded in kilograms and
      grams is only safe on the second, and only the first can be shown back to
      the person who typed it.

   Isolation follows phase 1: the org id is part of the key, and the branch id is
   part of the key too, so a query for one branch's ledger cannot return
   another's. Authorization — who may read or write which branch — belongs to the
   route, which resolves it from the session.

   Storage is a read-modify-write of one array per branch, like `_journal.js`,
   which can lose an entry under truly concurrent writes. Unlike the logs, this
   IS load-bearing, so entries carry a client-independent id and reversals are
   idempotent: re-reversing an already-reversed entry is refused rather than
   doubled. A queue or a real append primitive is the fix if write volume ever
   justifies it; the shape here does not have to change for that. */

import { getJSON, setJSON } from "./_store.js";
import { getIngredient } from "./_inventory.js";
import { convert, sameDimension, isUnit } from "./_units.js";

const MOVES = (orgId, branchId) => `inv:${orgId}:moves:${branchId}`;
const POLICY = (orgId) => `inv:${orgId}:policy`;

/* Every kind of movement the ledger accepts, with the direction it moves stock.

   The list is closed for the same reason the audit actions are: an unrecognised
   type would become an entry nobody can total or explain. `adjust` is the only
   signed type — a stock correction goes both ways and forcing it into two names
   ("adjust up", "adjust down") only invites picking the wrong one. */
export const MOVEMENT_TYPES = {
  opening: { sign: +1, label: "opening balance" },
  receive: { sign: +1, label: "received" },
  transfer_in: { sign: +1, label: "transferred in" },
  production_in: { sign: +1, label: "produced" },

  issue: { sign: -1, label: "issued" },
  consume: { sign: -1, label: "consumed" },
  waste: { sign: -1, label: "waste" },
  return_out: { sign: -1, label: "returned to supplier" },
  transfer_out: { sign: -1, label: "transferred out" },

  adjust: { sign: 0, label: "adjustment" },
};

export const MOVEMENT_KEYS = Object.keys(MOVEMENT_TYPES);

/* Reasons a movement can be refused, as field names. The interface owns the
   wording in four languages, exactly like `validateIngredient`. */
export function isMovementType(type) {
  return Object.prototype.hasOwnProperty.call(MOVEMENT_TYPES, type);
}

const signOf = (type, qty) =>
  MOVEMENT_TYPES[type].sign || (Number(qty) < 0 ? -1 : +1);

/* Ids are generated here, never accepted from a caller: an id from the client
   is how the same entry gets posted twice on a flaky connection and counted
   twice in a balance. */
let counter = 0;
const newId = () =>
  `m${Date.now().toString(36)}${(counter = (counter + 1) % 1e4).toString(36).padStart(3, "0")}`;

/* ── Negative-stock policy ────────────────────────────────── */

/* The document asks for a negative-stock policy, not a hard rule, because both
   answers are legitimate: a tight kitchen wants the entry refused, and a
   business still entering last month's invoices needs to be able to record a
   sale of something the ledger hasn't received yet. Default is to refuse, since
   silently negative stock is how a valuation quietly stops meaning anything. */
export async function getPolicy(orgId) {
  const saved = (await getJSON(POLICY(orgId))) || {};
  return { allowNegative: Boolean(saved.allowNegative) };
}

export async function savePolicy(orgId, { allowNegative }) {
  const policy = { allowNegative: Boolean(allowNegative) };
  await setJSON(POLICY(orgId), policy);
  return policy;
}

/* ── Recording ────────────────────────────────────────────── */

/* Validation that doesn't need the store, so it can be unit-tested and reused
   by the transfer path without a second round of reads. */
export function validateMovement({ type, qty, unit, ingredient }) {
  if (!isMovementType(type)) return "type";
  if (!ingredient) return "ingredientId";
  if (ingredient.archived) return "archived";
  if (!isUnit(unit)) return "unit";

  /* The entered unit has to measure the same kind of thing as the ingredient's
     stock unit. Anything else would need a density, which belongs to the
     ingredient and doesn't exist yet — so this is refused rather than guessed. */
  if (!sameDimension(unit, ingredient.stockUnit)) return "unit";

  const n = Number(qty);
  if (!Number.isFinite(n)) return "qty";
  if (type === "adjust" ? n === 0 : !(n > 0)) return "qty";
  return null;
}

async function readLedger(orgId, branchId) {
  return (await getJSON(MOVES(orgId, branchId))) || [];
}

/* One movement. Returns `{ error }` with a field name, or `{ movement }`.

   `at` is accepted from the caller because backdating a delivery is ordinary
   bookkeeping, but `recordedAt` is always now — the difference between when
   something happened and when somebody typed it is exactly what a variance
   investigation needs. */
export async function recordMovement(orgId, branchId, input, { policy } = {}) {
  if (!branchId) return { error: "branchId" };

  const ingredient = await getIngredient(orgId, String(input.ingredientId || ""));
  const error = validateMovement({ ...input, ingredient });
  if (error) return { error };

  const { allowNegative } = policy || (await getPolicy(orgId));
  const qty = Math.abs(Number(input.qty));
  const sign = signOf(input.type, input.qty);
  const qtyBase = sign * convert(qty, input.unit, baseUnitOf(ingredient));

  /* Would this drive the balance below zero? Checked against the ledger as it
     stands, which is the same number the screen was showing. */
  if (!allowNegative && qtyBase < 0) {
    const ledger = await readLedger(orgId, branchId);
    const onHand = sumBase(ledger, ingredient.id);
    if (onHand + qtyBase < -1e-9) {
      return { error: "negative", onHand: fromBaseQty(onHand, ingredient), short: fromBaseQty(-(onHand + qtyBase), ingredient) };
    }
  }

  const movement = {
    id: newId(),
    branchId,
    ingredientId: ingredient.id,
    ingredientName: ingredient.name,
    type: input.type,
    /* As entered, for a human. */
    qty: sign < 0 ? -qty : qty,
    unit: input.unit,
    /* For arithmetic. Every total in the app reads this one. */
    qtyBase,
    baseUnit: baseUnitOf(ingredient),
    stockUnit: ingredient.stockUnit,
    /* Cost is recorded on the entry rather than looked up later: what a delivery
       cost is a fact about that delivery, and re-deriving it from today's price
       is how a valuation drifts. Costing (phase 3) reads these. */
    unitCost: Number(input.unitCost) >= 0 ? Number(input.unitCost) : null,
    /* The same cost expressed per base unit, computed once here rather than
       re-derived by every reader. "12 per kg" and "0.012 per g" are the same
       fact, and a consumer that divides by the wrong one is out by a thousand. */
    costPerBase: Number(input.unitCost) >= 0
      ? Number(input.unitCost) / convert(1, input.unit, baseUnitOf(ingredient))
      : null,
    reason: String(input.reason || "").trim(),
    note: String(input.note || "").trim(),
    ref: String(input.ref || "").trim(),
    actor: String(input.actor || "").trim(),
    at: Number(input.at) > 0 ? Number(input.at) : Date.now(),
    recordedAt: Date.now(),
    transferId: input.transferId || null,
    reverses: null,
    reversedBy: null,
  };

  const ledger = await readLedger(orgId, branchId);
  await setJSON(MOVES(orgId, branchId), [movement, ...ledger]);
  return { movement };
}

/* An inter-branch transfer is two entries, not one row with two branch columns:
   each branch's ledger has to total correctly on its own, and a transfer that
   only exists in one of them is a leak. They share a `transferId` so the pair
   can be shown as one event and reversed together.

   The out-leg is written first and deliberately: if the in-leg then fails, stock
   is missing rather than duplicated, which is the safer of the two wrong
   answers and is visible in the source branch's balance. */
export async function recordTransfer(orgId, { fromBranchId, toBranchId, ...input }) {
  if (!fromBranchId || !toBranchId) return { error: "branchId" };
  if (fromBranchId === toBranchId) return { error: "sameBranch" };

  const transferId = newId();
  const out = await recordMovement(orgId, fromBranchId, {
    ...input, type: "transfer_out", transferId,
  });
  if (out.error) return out;

  const into = await recordMovement(orgId, toBranchId, {
    ...input, type: "transfer_in", transferId,
    /* The receiving branch inherits the sending branch's cost, so moving stock
       between branches doesn't revalue it. */
    unitCost: out.movement.unitCost,
  });
  if (into.error) {
    await reverseMovement(orgId, fromBranchId, out.movement.id, {
      actor: input.actor, reason: "transfer failed",
    });
    return into;
  }

  return { transferId, out: out.movement, in: into.movement };
}

/* The only correction there is. The original stays exactly as recorded and gains
   a `reversedBy` pointer; the new entry carries the opposite quantity and points
   back with `reverses`. Both remain in the ledger forever, which is what the
   document means by a ledger that is corrected rather than deleted.

   Reversing is refused a second time — otherwise a double-click cancels the
   correction it just made and the balance is wrong in a way nobody can see. */
export async function reverseMovement(orgId, branchId, id, { actor, reason } = {}) {
  const ledger = await readLedger(orgId, branchId);
  const index = ledger.findIndex((m) => m.id === id);
  if (index < 0) return { error: "notfound" };

  const original = ledger[index];
  if (original.reversedBy) return { error: "reversed" };
  if (original.reverses) return { error: "isreversal" };

  const reversal = {
    ...original,
    id: newId(),
    qty: -original.qty,
    qtyBase: -original.qtyBase,
    reason: String(reason || "").trim(),
    note: "",
    actor: String(actor || "").trim(),
    at: Date.now(),
    recordedAt: Date.now(),
    reverses: original.id,
    reversedBy: null,
  };

  const next = [...ledger];
  next[index] = { ...original, reversedBy: reversal.id };
  await setJSON(MOVES(orgId, branchId), [reversal, ...next]);
  return { movement: reversal, original: next[index] };
}

/* ── Reading ──────────────────────────────────────────────── */

/* The base unit an ingredient's quantities are held in. Derived from its stock
   unit rather than stored, so the two can never disagree. */
function baseUnitOf(ingredient) {
  return { mass: "g", volume: "ml", count: "ea" }[ingredient.dimension] || ingredient.stockUnit;
}

function fromBaseQty(qtyBase, ingredient) {
  return convert(qtyBase, baseUnitOf(ingredient), ingredient.stockUnit);
}

function sumBase(ledger, ingredientId) {
  return ledger.reduce((total, m) => (m.ingredientId === ingredientId ? total + m.qtyBase : total), 0);
}

/* The most recent cost per base unit actually paid for an ingredient, across the
   branches given. Used to put a money value on a quantity variance before the
   costing engine exists — the document's "last cost".

   Only incoming entries count: what a plate of waste "cost" is the price it was
   bought at, not a price attached to throwing it away. Reversed entries are
   skipped, because a delivery that was reversed never happened. */
export async function lastCostPerBase(orgId, branchIds, ingredientId) {
  let best = null;
  for (const branchId of branchIds) {
    for (const m of await readLedger(orgId, branchId)) {
      if (m.ingredientId !== ingredientId) continue;
      if (m.costPerBase === null || m.costPerBase === undefined) continue;
      if (m.qtyBase <= 0 || m.reversedBy || m.reverses) continue;
      if (!best || m.at > best.at) best = m;
    }
  }
  return best ? best.costPerBase : null;
}

const inWindow = (m, { from, to }) =>
  (!from || m.at >= from) && (!to || m.at <= to);

/* The ledger for one branch, newest first. `ingredientId`, `type` and a date
   window narrow it; nothing here widens beyond the branch that was asked for. */
export async function listMovements(orgId, branchId, { ingredientId, type, from, to, limit = 200 } = {}) {
  const ledger = await readLedger(orgId, branchId);
  return ledger
    .filter((m) => (!ingredientId || m.ingredientId === ingredientId))
    .filter((m) => (!type || m.type === type))
    .filter((m) => inWindow(m, { from, to }))
    .slice(0, limit);
}

/* Balances across a list of branches — the list the route has already reduced to
   what the caller may see, so this function never has to decide authorization.

   Returns one row per ingredient that has any history, in the ingredient's own
   stock unit, with the per-branch split kept alongside the total. An owner
   looking at the group and a branch manager looking at one branch are reading
   the same computation, which is what makes their numbers add up. */
export async function balances(orgId, branchIds, { ingredients, to } = {}) {
  const byId = new Map((ingredients || []).map((i) => [i.id, i]));
  const rows = new Map();

  for (const branchId of branchIds) {
    const ledger = await readLedger(orgId, branchId);
    for (const m of ledger) {
      if (to && m.at > to) continue;
      const ingredient = byId.get(m.ingredientId);
      if (!ingredient) continue;

      const row = rows.get(m.ingredientId) || {
        ingredientId: m.ingredientId,
        name: ingredient.name,
        category: ingredient.category,
        stockUnit: ingredient.stockUnit,
        reorderPoint: ingredient.reorderPoint,
        parLevel: ingredient.parLevel,
        qtyBase: 0,
        byBranch: {},
        lastMovedAt: 0,
        movements: 0,
      };

      row.qtyBase += m.qtyBase;
      row.byBranch[branchId] = (row.byBranch[branchId] || 0) + m.qtyBase;
      row.lastMovedAt = Math.max(row.lastMovedAt, m.at);
      row.movements += 1;
      rows.set(m.ingredientId, row);
    }
  }

  return [...rows.values()]
    .map((row) => {
      const ingredient = byId.get(row.ingredientId);
      const qty = fromBaseQty(row.qtyBase, ingredient);
      return {
        ...row,
        qty,
        byBranch: Object.fromEntries(
          Object.entries(row.byBranch).map(([b, base]) => [b, fromBaseQty(base, ingredient)])
        ),
        /* Flagged here rather than in the interface so the same threshold
           applies to an alert, an export and a screen. */
        belowReorder: row.reorderPoint !== null && row.reorderPoint !== undefined && qty <= row.reorderPoint,
        negative: qty < -1e-9,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export { baseUnitOf };
