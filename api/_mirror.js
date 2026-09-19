import { db, configured, ensureBusiness } from "./_db.js";

/* Copying a stock movement into Postgres while Redis is still the truth.

   ── Why both, for a while ────────────────────────────────────────────────

   The ledger is moving to Postgres so that completing an order can deduct
   stock in the same transaction that records the sale. It cannot move in one
   step: there are many live businesses, every balance on every screen is
   summed from the Redis ledger, and stock is money. A switch that is wrong is
   wrong silently — a balance does not look broken, it just says a number.

   So there are three phases, and this file is the middle one.

     1. back-fill what exists
     2. write both, read Redis, and compare the two until they never differ
     3. read Postgres, and stop writing Redis

   Redis stays authoritative throughout phase two. That is the point: if this
   file is broken, or the database is down, or the shape is subtly wrong, the
   business keeps working on the ledger it has always used and the damage is a
   report that disagrees rather than stock that is gone.

   ── Which is why nothing here throws ─────────────────────────────────────

   A mirror that can fail a stock movement is worse than no mirror. Somebody
   receiving a delivery at seven in the morning must not be told "could not
   save" because a database in another region is having a minute.

   The honest cost of swallowing errors is that drift becomes invisible, so it
   is not left invisible: every failure is logged with the movement's id, and
   `scripts/verify-movements.mjs` compares the two ledgers balance by balance.
   Silence is not taken as agreement — agreement is checked.

   ── Idempotent on the ledger's own id ────────────────────────────────────

   Redis mints the id. `legacy_id` carries it, unique per business, so a
   back-fill can be re-run after a partial failure and a mirror that fires
   twice writes once. Without that the safe response to a half-finished
   backfill would be to delete everything and start again, which is not a safe
   response at all. */

const KNOWN_TYPES = new Set([
  "opening", "receive", "transfer_in", "production_in",
  "issue", "consume", "waste", "return_out", "transfer_out", "adjust",
]);

/* Null for anything that is not a real number. A historical record may hold
   Infinity — `_movements.js` produced it for any upper-case unit until that was
   fixed — and handing one to a numeric column fails the whole insert with
   "numeric field overflow", which would stop a back-fill dead on a row from
   three years ago. Null is what the ledger meant anyway: no cost basis. */
const asNumber = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const asText = (v) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/* A Redis movement as its Postgres row.

   Exported so the back-fill and the tests read the same translation the live
   mirror does. Two versions of this would be two things to keep in step, and
   the whole exercise is about two stores agreeing. */
export function rowFor(orgId, branchId, m) {
  const type = KNOWN_TYPES.has(m.type) ? m.type : null;
  if (!type) return { error: "type", detail: String(m.type) };
  if (!m.id) return { error: "id" };
  if (!Number.isFinite(Number(m.qtyBase))) return { error: "qtyBase" };

  /* An `adjust` can legitimately be zero in the Redis ledger — it is the type
     whose sign is neither in nor out. The Postgres table refuses zero, because
     a movement of nothing is not a movement, so those are skipped rather than
     forced through. The verifier accounts for it: adding zero changes no
     balance, so the two still agree. */
  if (Number(m.qtyBase) === 0) return { skip: "zero" };

  return {
    values: [
      orgId,
      asText(branchId),
      String(m.ingredientId),
      String(m.qtyBase),
      asNumber(m.costPerBase),
      asNumber(m.costPerBase),
      type,
      Boolean(m.auto),
      asText(m.reason),
      asText(m.note),
      asText(m.ref),
      asText(m.actor),
      asNumber(m.qty),
      asText(m.unit),
      asText(m.transferId),
      /* A reversal points at the movement it undoes, by the ledger's id. The
         Postgres row's own key is a uuid this file does not know, so the link
         is resolved from `legacy_id` in the statement below — which also means
         a reversal mirrored before its original simply records no link rather
         than failing. The verifier does not depend on the link; balances are
         the sum either way. */
      asText(m.reverses),
      new Date(Number(m.at) || Date.now()).toISOString(),
      new Date(Number(m.recordedAt) || Number(m.at) || Date.now()).toISOString(),
      String(m.id),
    ],
  };
}

const INSERT = `
  INSERT INTO inventory_movements
    (business_id, branch_id, ingredient_id, quantity_signed,
     unit_cost_snapshot, cost_per_base, type, auto,
     reason, note, ref, actor, qty_entered, unit_entered, transfer_id,
     reverses_id, occurred_at, recorded_at, legacy_id)
  SELECT $1::uuid, $2, $3, $4::numeric,
         $5::numeric, $6::numeric, $7, $8,
         $9, $10, $11, $12, $13::numeric, $14, $15,
         (SELECT id FROM inventory_movements
           WHERE business_id = $1::uuid AND legacy_id = $16 LIMIT 1),
         $17::timestamptz, $18::timestamptz, $19
  ON CONFLICT (business_id, legacy_id) WHERE legacy_id IS NOT NULL DO NOTHING`;

/* Mirror one movement. Never throws, never returns a reason to stop. */
export async function mirrorMovement(orgId, branchId, movement, { client } = {}) {
  if (!configured || !orgId || !movement) return { mirrored: false, reason: "off" };

  const row = rowFor(orgId, branchId, movement);
  if (row.skip) return { mirrored: false, reason: row.skip };
  if (row.error) {
    console.error(`[mirror] ${movement?.id}: unusable ${row.error} (${row.detail ?? ""})`);
    return { mirrored: false, reason: row.error };
  }

  try {
    const c = client || db();
    if (!client) await ensureBusiness(c, orgId);
    const out = await c.query(INSERT, row.values);
    return { mirrored: out.rowCount > 0, reason: out.rowCount > 0 ? "written" : "already" };
  } catch (err) {
    /* Loudly, with the id, so a drift found later can be traced to the minute
       it started rather than guessed at. */
    console.error(`[mirror] ${movement.id} failed: ${err.message}`);
    return { mirrored: false, reason: "error", error: err.message };
  }
}

/* ── Deciding whether the two agree ──────────────────────────────────────

   The claim the whole migration rests on. A back-fill reporting "9,412
   written" has proved nothing — it says rows were inserted, not that the
   balances match, and a stock balance that is wrong does not look wrong. It
   just says a number.

   Kept here rather than in the script that calls it so it can be tested. The
   comparison is what decides whether it is safe to stop reading Redis, and a
   decision that size should not rest on arithmetic nobody has exercised. */

/* Quantities are held to six decimal places on both sides, so a difference
   smaller than that is the same number written twice. */
export const SAME_WITHIN = 1e-6;

export function totalsFrom(movements = []) {
  const totals = new Map();
  for (const m of movements) {
    const q = Number(m?.qtyBase);
    if (!Number.isFinite(q)) continue;
    totals.set(m.ingredientId, (totals.get(m.ingredientId) || 0) + q);
  }
  return totals;
}

/* Every ingredient either side knows about, and what each makes of it.

   The union, not the intersection. An ingredient present in one ledger and
   absent from the other is the most serious kind of drift there is, and an
   intersection would be the one shape of comparison that could not see it. */
export function driftBetween(redis, postgres, { within = SAME_WITHIN } = {}) {
  const out = [];
  for (const id of new Set([...redis.keys(), ...postgres.keys()])) {
    const a = redis.get(id) || 0;
    const b = postgres.get(id) || 0;
    if (Math.abs(a - b) > within) out.push({ ingredientId: id, redis: a, postgres: b });
  }
  return out.sort((x, y) => String(x.ingredientId).localeCompare(String(y.ingredientId)));
}

/* Many, for the back-fill. Reports counts rather than stopping on the first
   bad row: a ledger with one unusable entry from three years ago should still
   migrate the other nine thousand, and the one is named. */
export async function mirrorMany(orgId, branchId, movements, { client } = {}) {
  const out = { written: 0, already: 0, skipped: 0, failed: 0, problems: [] };

  for (const m of movements) {
    const res = await mirrorMovement(orgId, branchId, m, { client });
    if (res.mirrored) out.written += 1;
    else if (res.reason === "already") out.already += 1;
    else if (res.reason === "zero") out.skipped += 1;
    else {
      out.failed += 1;
      if (out.problems.length < 20) out.problems.push({ id: m?.id, reason: res.reason });
    }
  }
  return out;
}
