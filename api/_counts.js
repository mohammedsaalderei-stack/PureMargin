/* Stock counts — stage 4, phase 3.

   A count is the moment the ledger meets reality. Everything before this phase
   describes what *should* be on the shelf; a count says what is, and the
   difference between the two is the variance the whole product exists to find.

   The document asks for a workflow rather than a form: draft, review, approval,
   with quantity and financial variance reasons. That shape is here for a reason
   that isn't bureaucratic — approving a count writes adjustments into the
   movement ledger, which changes every balance and every valuation downstream.
   The person holding the clipboard should not be the only person who ever sees
   the number. A chef has `manage:inventory` and can record a count; approval
   needs `approve:counts`, which the chef role deliberately lacks.

   Three decisions worth keeping:

   1. **Expected quantities are snapshotted when the count opens**, not read at
      approval time. A count sheet printed at 9pm and approved at 11pm must be
      judged against what the ledger said at 9pm, or the evening's sales become
      variance that nobody caused.
   2. **Approval writes `adjust` movements, one per line with a real variance.**
      The count never edits a balance directly — it can't, because balances are
      derived. So the count's effect on stock is itself auditable history, and the
      movements it created are recorded on the count.
   3. **An approved count is never re-approved and never edited.** It is a
      historical statement. Correcting one means reversing its movements (the
      ledger's own mechanism) and counting again.

   Isolation follows the rest of stage 4: the org id is in the key and the branch
   id is on the record, and the route resolves both from the session. */

import { getJSON, setJSON } from "./_store.js";
import { listIngredients, getIngredient } from "./_inventory.js";
import { balances, recordMovement, baseUnitOf, lastCostPerBase } from "./_movements.js";
import { convert, isUnit, sameDimension } from "./_units.js";

const COUNTS = (orgId) => `inv:${orgId}:counts`;

/* Draft → review → approved, plus the two ends a count can stop at. Cancelled
   counts are kept rather than deleted: "we counted and abandoned it" is itself
   information when a variance is being argued about. */
export const COUNT_STATUSES = ["draft", "review", "approved", "cancelled"];

/* Why a line differs from the ledger. A closed list, because "reason: other"
   typed forty different ways is the same as no reason at all — and these are
   what a variance report groups by. */
export const VARIANCE_REASONS = [
  "spoilage", "breakage", "theft", "unrecorded_waste", "unrecorded_transfer",
  "receiving_error", "recipe_error", "unit_error", "miscount", "other",
];

let counter = 0;
const newId = () =>
  `c${Date.now().toString(36)}${(counter = (counter + 1) % 1e4).toString(36).padStart(3, "0")}`;

async function readAll(orgId) {
  return (await getJSON(COUNTS(orgId))) || {};
}

async function write(orgId, count) {
  const map = await readAll(orgId);
  map[count.id] = count;
  await setJSON(COUNTS(orgId), map);
  return count;
}

/* ── Opening a count ──────────────────────────────────────── */

/* A count sheet: every ingredient in scope, each with the quantity the ledger
   expects right now. `scope` narrows it the way a real count is organised — one
   storage location or one category at a time, because counting a whole kitchen
   in one sitting is how counts stop happening.

   `spot` marks a count of a handful of items rather than everything in scope;
   the difference matters when reading variance later, since a spot count says
   nothing about the items it didn't look at. */
export async function openCount(orgId, branchId, {
  actor, name = "", category = "", location = "", ingredientIds = null, spot = false, scheduledFor = null,
} = {}) {
  if (!branchId) return { error: "branchId" };

  const ingredients = (await listIngredients(orgId)).filter((i) => {
    if (ingredientIds) return ingredientIds.includes(i.id);
    if (category && i.category !== category) return false;
    if (location && i.location !== location) return false;
    return true;
  });
  if (!ingredients.length) return { error: "empty" };

  /* One balance computation for the whole sheet, scoped to this branch alone —
     a count is a physical act in one room. */
  const rows = await balances(orgId, [branchId], { ingredients });
  const expected = new Map(rows.map((r) => [r.ingredientId, r]));

  const count = {
    id: newId(),
    branchId,
    status: "draft",
    name: String(name || "").trim(),
    category: String(category || "").trim(),
    location: String(location || "").trim(),
    spot: Boolean(spot),
    scheduledFor: Number(scheduledFor) > 0 ? Number(scheduledFor) : null,
    /* The instant the expectations below were true. Every variance on this count
       is relative to this moment, not to when somebody pressed approve. */
    openedAt: Date.now(),
    openedBy: String(actor || ""),
    submittedAt: null, submittedBy: null,
    approvedAt: null, approvedBy: null,
    cancelledAt: null, cancelledBy: null,
    movementIds: [],
    lines: ingredients.map((i) => ({
      ingredientId: i.id,
      name: i.name,
      category: i.category,
      stockUnit: i.stockUnit,
      baseUnit: baseUnitOf(i),
      /* What the ledger said when the sheet was opened. */
      expectedBase: expected.get(i.id)?.qtyBase ?? 0,
      /* Filled in by whoever is counting. `null`, not zero — "not counted yet"
         and "counted, none there" are completely different statements, and
         treating the first as the second writes off the entire shelf. */
      countedQty: null,
      unit: i.stockUnit,
      reason: "",
      note: "",
    })),
  };

  return { count: await write(orgId, count) };
}

/* ── Filling it in ────────────────────────────────────────── */

/* Counted quantities, one line at a time or in bulk. Only a draft accepts them:
   a count under review is being read by somebody else, and an approved one is
   history. */
export async function saveLines(orgId, id, lines, { actor } = {}) {
  const map = await readAll(orgId);
  const count = map[id];
  if (!count) return { error: "notfound" };
  if (count.status !== "draft") return { error: "notdraft" };

  const byId = new Map(count.lines.map((l) => [l.ingredientId, l]));

  for (const input of lines || []) {
    const line = byId.get(String(input.ingredientId || ""));
    if (!line) return { error: "ingredientId" };

    /* Clearing a line is legitimate — it puts it back to "not counted". */
    if (input.countedQty === null || input.countedQty === "") {
      line.countedQty = null;
      line.unit = line.stockUnit;
    } else {
      const qty = Number(input.countedQty);
      if (!Number.isFinite(qty) || qty < 0) return { error: "countedQty" };

      const unit = input.unit || line.stockUnit;
      if (!isUnit(unit) || !sameDimension(unit, line.stockUnit)) return { error: "unit" };

      line.countedQty = qty;
      line.unit = unit;
    }
    if (input.reason !== undefined) {
      const reason = String(input.reason || "");
      if (reason && !VARIANCE_REASONS.includes(reason)) return { error: "reason" };
      line.reason = reason;
    }
    if (input.note !== undefined) line.note = String(input.note || "").trim();
  }

  count.lines = [...byId.values()];
  count.updatedAt = Date.now();
  count.updatedBy = String(actor || "");
  return { count: await write(orgId, count) };
}

/* ── The workflow ─────────────────────────────────────────── */

export async function submitCount(orgId, id, { actor } = {}) {
  const map = await readAll(orgId);
  const count = map[id];
  if (!count) return { error: "notfound" };
  if (count.status !== "draft") return { error: "notdraft" };
  /* Nothing counted at all is a mistake, not a review. */
  if (!count.lines.some((l) => l.countedQty !== null)) return { error: "nocounts" };

  count.status = "review";
  count.submittedAt = Date.now();
  count.submittedBy = String(actor || "");
  return { count: await write(orgId, count) };
}

/* Back to draft — the reviewer found something wrong and the counter has to look
   again. Kept distinct from cancelling: this count is still going to happen. */
export async function reopenCount(orgId, id, { actor } = {}) {
  const map = await readAll(orgId);
  const count = map[id];
  if (!count) return { error: "notfound" };
  if (count.status !== "review") return { error: "notreview" };

  count.status = "draft";
  count.submittedAt = null;
  count.submittedBy = null;
  count.reopenedBy = String(actor || "");
  count.reopenedAt = Date.now();
  return { count: await write(orgId, count) };
}

export async function cancelCount(orgId, id, { actor, reason } = {}) {
  const map = await readAll(orgId);
  const count = map[id];
  if (!count) return { error: "notfound" };
  if (count.status === "approved") return { error: "approved" };

  count.status = "cancelled";
  count.cancelledAt = Date.now();
  count.cancelledBy = String(actor || "");
  count.cancelReason = String(reason || "").trim();
  return { count: await write(orgId, count) };
}

/* Approval — the only step that touches stock.

   One `adjust` movement per line whose counted quantity differs from what was
   expected, carrying the line's reason so the ledger explains itself. Lines that
   match write nothing: an entry of zero is noise in a history somebody has to
   read.

   The negative-stock policy is deliberately bypassed here. A physical count is
   the most authoritative statement in the system; refusing it because it makes a
   balance negative would leave the ledger knowingly contradicting the shelf. If
   a count says there are none, there are none. */
export async function approveCount(orgId, id, { actor } = {}) {
  const map = await readAll(orgId);
  const count = map[id];
  if (!count) return { error: "notfound" };
  if (count.status === "approved") return { error: "approved" };
  if (count.status !== "review") return { error: "notreview" };

  const priced = await priceCount(orgId, count);
  const movementIds = [];

  for (const line of priced.lines) {
    if (line.countedQty === null) continue;
    if (Math.abs(line.varianceBase) < 1e-9) continue;

    const ingredient = await getIngredient(orgId, line.ingredientId);
    if (!ingredient) continue;

    /* The adjustment is expressed in the ingredient's own stock unit, which is
       what a person reading the ledger later expects to see. */
    const out = await recordMovement(orgId, count.branchId, {
      ingredientId: line.ingredientId,
      type: "adjust",
      qty: convert(line.varianceBase, line.baseUnit, ingredient.stockUnit),
      unit: ingredient.stockUnit,
      unitCost: line.costPerBase === null
        ? null
        : line.costPerBase * convert(1, ingredient.stockUnit, line.baseUnit),
      reason: line.reason || "miscount",
      note: line.note,
      ref: `count:${count.id}`,
      actor,
    }, { policy: { allowNegative: true } });

    if (out.movement) movementIds.push(out.movement.id);
  }

  count.status = "approved";
  count.approvedAt = Date.now();
  count.approvedBy = String(actor || "");
  count.movementIds = movementIds;
  /* The valuation as approved is frozen onto the record. Last cost moves; what
     this count was worth when it was signed off does not. */
  count.totals = priced.totals;
  return { count: await write(orgId, count), movementIds };
}

/* ── Variance ─────────────────────────────────────────────── */

/* Quantity and financial variance for every line, plus the totals a reviewer
   actually decides on. Pure apart from the cost lookup, so the review screen and
   the approval step read exactly the same numbers. */
export async function priceCount(orgId, count) {
  const lines = [];
  let shrinkValue = 0;
  let gainValue = 0;
  let counted = 0;

  for (const line of count.lines) {
    const costPerBase = await lastCostPerBase(orgId, [count.branchId], line.ingredientId);

    if (line.countedQty === null) {
      lines.push({ ...line, countedBase: null, varianceBase: 0, varianceQty: 0, costPerBase, varianceValue: null });
      continue;
    }

    counted += 1;
    const countedBase = convert(line.countedQty, line.unit, line.baseUnit);
    /* Positive means more on the shelf than the ledger thought. */
    const varianceBase = countedBase - line.expectedBase;
    const varianceValue = costPerBase === null ? null : varianceBase * costPerBase;

    if (varianceValue !== null) {
      if (varianceValue < 0) shrinkValue += varianceValue;
      else gainValue += varianceValue;
    }

    lines.push({
      ...line,
      countedBase,
      varianceBase,
      /* In the ingredient's stock unit, for a human. */
      varianceQty: convert(varianceBase, line.baseUnit, line.stockUnit),
      expectedQty: convert(line.expectedBase, line.baseUnit, line.stockUnit),
      costPerBase,
      varianceValue,
    });
  }

  return {
    lines,
    totals: {
      lines: count.lines.length,
      counted,
      /* Kept apart rather than netted: a shelf that is short on meat and long on
         flour is not "fine", and one net figure would say it was. */
      shrinkValue,
      gainValue,
      netValue: shrinkValue + gainValue,
      /* How much of the sheet was actually counted — the data-quality status the
         document asks every important number to carry. */
      coverage: count.lines.length ? counted / count.lines.length : 0,
      /* Lines valued at nothing because that ingredient has never been received
         with a cost. Named so a reviewer knows the money figure is partial
         rather than complete. */
      unpriced: count.lines.filter((l) => l.countedQty !== null).length - lines.filter((l) => l.varianceValue !== null).length,
    },
  };
}

/* ── Reading ──────────────────────────────────────────────── */

export async function getCount(orgId, id, { priced = false } = {}) {
  const count = (await readAll(orgId))[id] || null;
  if (!count) return null;
  if (!priced) return count;
  const { lines, totals } = await priceCount(orgId, count);
  return { ...count, lines, totals };
}

/* Counts across the branches the caller may see, newest first. The list stays
   deliberately thin — a reviewer picks from it, and the lines are only worth
   loading for the one count they open. */
export async function listCounts(orgId, branchIds, { status } = {}) {
  const all = Object.values(await readAll(orgId));
  const allowed = new Set(branchIds.map(String));
  return all
    .filter((c) => allowed.has(String(c.branchId)))
    .filter((c) => !status || c.status === status)
    /* Ids carry a counter after the timestamp, so they break the tie when two
       counts are opened inside the same millisecond and `openedAt` can't. */
    .sort((a, b) => (b.openedAt - a.openedAt) || b.id.localeCompare(a.id))
    .map(({ lines, ...rest }) => ({
      ...rest,
      lineCount: lines.length,
      countedCount: lines.filter((l) => l.countedQty !== null).length,
    }));
}
