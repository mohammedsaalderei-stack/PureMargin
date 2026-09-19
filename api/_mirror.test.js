/* Copying the stock ledger into Postgres without changing what it says.

   ── What this has to prove ───────────────────────────────────────────────

   The whole migration rests on one claim: the two ledgers agree. Everything
   else — dual writing, the verifier, eventually reading from Postgres — is
   worthless if the translation from a Redis movement to a Postgres row loses
   or alters anything.

   So the assertions are about fidelity rather than mechanics. A movement
   arrives with every field it had. Mirroring twice writes once. The sum of
   the copies equals the sum of the originals, which is the only statement a
   stock balance actually makes.

   Needs a database; skips with a word when there is none. */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadLocalEnv } from "./_env.js";

loadLocalEnv();

const { configured, db, close, ensureBusiness } = await import("./_db.js");

if (!configured) {
  console.log("  skip  ledger mirror — no DATABASE_URL set");
  console.log("\nall passed");
  process.exit(0);
}

const { mirrorMovement, mirrorMany, rowFor } = await import("./_mirror.js");

const BIZ = crypto.randomUUID();
const BRANCH = "b1";

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

let seq = 0;
/* A movement shaped exactly as `_movements.js` writes one. */
const move = (over = {}) => ({
  id: `m${Date.now().toString(36)}${(seq += 1).toString(36)}`,
  branchId: BRANCH,
  ingredientId: "beef-mince",
  ingredientName: "Beef mince",
  type: "receive",
  qty: 20,
  unit: "kg",
  qtyBase: 20000,
  baseUnit: "g",
  stockUnit: "kg",
  unitCost: 30,
  costPerBase: 0.03,
  reason: "",
  note: "",
  ref: "",
  actor: "sam",
  at: Date.UTC(2026, 5, 1, 9, 0, 0),
  recordedAt: Date.UTC(2026, 5, 3, 11, 0, 0),
  auto: false,
  transferId: null,
  reverses: null,
  reversedBy: null,
  ...over,
});

const rowsFor = async (legacyId) => {
  const r = await db().query(
    "SELECT * FROM inventory_movements WHERE business_id = $1 AND legacy_id = $2",
    [BIZ, legacyId],
  );
  return r.rows;
};

const pgBalance = async (ingredientId) => {
  const r = await db().query(
    `SELECT COALESCE(sum(quantity_signed), 0)::text AS total
       FROM inventory_movements WHERE business_id = $1 AND ingredient_id = $2`,
    [BIZ, ingredientId],
  );
  return Number(r.rows[0].total);
};

await test("a movement arrives with everything it had", async () => {
  const m = move({ reason: "weekly order", note: "left at the back door", ref: "INV-88" });
  const out = await mirrorMovement(BIZ, BRANCH, m);
  assert.equal(out.mirrored, true);

  const [row] = await rowsFor(m.id);
  assert.equal(Number(row.quantity_signed), 20000);
  assert.equal(row.type, "receive");
  assert.equal(row.branch_id, BRANCH);
  assert.equal(row.ingredient_id, "beef-mince");
  assert.equal(Number(row.cost_per_base), 0.03);
  assert.equal(Number(row.unit_cost_snapshot), 0.03);
  assert.equal(row.actor, "sam");
  assert.equal(row.auto, false);

  /* The three that 001 would have thrown away. */
  assert.equal(row.reason, "weekly order", "free text, not the enum");
  assert.equal(row.note, "left at the back door");
  assert.equal(row.ref, "INV-88");

  /* Entered as 20 kg, stored as 20000 g, and both survive — a screen showing
     "20000 g" back to somebody who typed "20 kg" is a screen they distrust. */
  assert.equal(Number(row.qty_entered), 20);
  assert.equal(row.unit_entered, "kg");

  /* Happened on the 1st, written on the 3rd. A variance investigation turns on
     being able to tell those apart. */
  assert.equal(row.occurred_at.toISOString(), new Date(m.at).toISOString());
  assert.equal(row.recorded_at.toISOString(), new Date(m.recordedAt).toISOString());
});

await test("the auto flag survives, because variance depends on it", async () => {
  /* Consumption written from sales. `_variance.js` excludes it: measuring
     leakage against figures derived from the same sales is circular, and
     losing the flag makes leakage read zero however much is being wasted. */
  const m = move({ type: "consume", auto: true, qtyBase: -150, qty: -150, unit: "g", ref: "2-1043" });
  await mirrorMovement(BIZ, BRANCH, m);

  const [row] = await rowsFor(m.id);
  assert.equal(row.auto, true);
  assert.equal(row.type, "consume");
  assert.equal(row.ref, "2-1043");
});

await test("mirroring twice writes once", async () => {
  /* A back-fill that half-finished must be safe to re-run. Without this the
     only safe recovery would be to delete everything and start again, which
     is not a recovery. */
  const m = move();
  const first = await mirrorMovement(BIZ, BRANCH, m);
  const second = await mirrorMovement(BIZ, BRANCH, m);

  assert.equal(first.mirrored, true);
  assert.equal(second.mirrored, false);
  assert.equal(second.reason, "already");
  assert.equal((await rowsFor(m.id)).length, 1);
});

await test("a reversal points at what it reversed", async () => {
  const original = move({ qtyBase: 5000 });
  await mirrorMovement(BIZ, BRANCH, original);

  const undo = move({ qtyBase: -5000, qty: -5, reverses: original.id, reason: "keyed twice" });
  await mirrorMovement(BIZ, BRANCH, undo);

  const [row] = await rowsFor(undo.id);
  const [was] = await rowsFor(original.id);
  assert.equal(row.reverses_id, was.id, "linked by the ledger's own id");
});

await test("a reversal mirrored before its original still records", async () => {
  /* The back-fill walks a ledger newest-first, so a reversal is reached before
     the thing it undoes. Losing the link is acceptable — balances are the sum
     either way — but losing the row is not. */
  const orphan = move({ qtyBase: -100, reverses: "m-not-here-yet" });
  const out = await mirrorMovement(BIZ, BRANCH, orphan);

  assert.equal(out.mirrored, true);
  const [row] = await rowsFor(orphan.id);
  assert.equal(row.reverses_id, null);
  assert.equal(Number(row.quantity_signed), -100, "and it still counts");
});

await test("a type nobody recognises is refused and named", async () => {
  /* Silently dropping it would make the two ledgers disagree by exactly that
     movement, and nothing would say which. */
  const m = move({ type: "teleport" });
  const out = await mirrorMovement(BIZ, BRANCH, m);
  assert.equal(out.mirrored, false);
  assert.equal(out.reason, "type");
  assert.equal((await rowsFor(m.id)).length, 0);
});

await test("a zero adjustment is skipped without changing the total", async () => {
  const before = await pgBalance("zero-test");
  const m = move({ ingredientId: "zero-test", type: "adjust", qtyBase: 0, qty: 0 });
  const out = await mirrorMovement(BIZ, BRANCH, m);

  assert.equal(out.reason, "zero");
  /* The Postgres table refuses a movement of nothing; adding nothing changes
     no balance, so the two ledgers still agree. */
  assert.equal(await pgBalance("zero-test"), before);
});

await test("nothing here can fail a stock movement", async () => {
  /* Somebody receiving a delivery at seven in the morning must not be told
     "could not save" because a database in another region is having a minute. */
  for (const bad of [null, undefined, {}, { id: "x" }, { id: "y", type: "receive" }]) {
    const out = await mirrorMovement(BIZ, BRANCH, bad);
    assert.equal(out.mirrored, false, "refused");
  }
  assert.equal(await mirrorMovement(null, BRANCH, move()).then((r) => r.mirrored), false);
});

await test("the copies sum to what the originals summed to", async () => {
  /* The only claim a stock balance makes. Everything above is detail; this is
     the statement the migration is actually asserting. */
  const ledger = [
    move({ ingredientId: "flour", type: "receive", qtyBase: 25000 }),
    move({ ingredientId: "flour", type: "consume", qtyBase: -1500, auto: true }),
    move({ ingredientId: "flour", type: "waste", qtyBase: -400 }),
    move({ ingredientId: "flour", type: "adjust", qtyBase: 0 }),
    move({ ingredientId: "flour", type: "transfer_out", qtyBase: -5000 }),
  ];
  const out = await mirrorMany(BIZ, BRANCH, ledger);

  assert.equal(out.failed, 0, JSON.stringify(out.problems));
  assert.equal(out.written, 4);
  assert.equal(out.skipped, 1, "the zero adjustment");

  const redisTotal = ledger.reduce((n, m) => n + m.qtyBase, 0);
  assert.equal(await pgBalance("flour"), redisTotal, "the ledgers agree");
});

await test("re-running a back-fill changes nothing", async () => {
  const ledger = [
    move({ ingredientId: "rerun", qtyBase: 1000 }),
    move({ ingredientId: "rerun", qtyBase: -250, type: "issue" }),
  ];
  await mirrorMany(BIZ, BRANCH, ledger);
  const after = await pgBalance("rerun");

  const second = await mirrorMany(BIZ, BRANCH, ledger);
  assert.equal(second.written, 0);
  assert.equal(second.already, 2);
  assert.equal(await pgBalance("rerun"), after, "the balance did not double");
});

await test("the translation is one function, shared with the back-fill", () => {
  /* Two versions of this would be two things to keep in step, in an exercise
     entirely about two stores agreeing. */
  const built = rowFor(BIZ, BRANCH, move({ qtyBase: 123 }));
  assert.equal(built.error, undefined);
  assert.equal(built.values[0], BIZ);
  assert.equal(built.values[3], "123");
});

/* ── The comparison that decides whether to cut over ───────────────────── */

await test("drift is reported with both figures, not just a flag", async () => {
  const { totalsFrom, driftBetween } = await import("./_mirror.js");
  const redis = totalsFrom([
    { ingredientId: "flour", qtyBase: 1000 },
    { ingredientId: "flour", qtyBase: -250 },
    { ingredientId: "salt", qtyBase: 500 },
  ]);
  const pg = new Map([["flour", 750], ["salt", 400]]);

  const drift = driftBetween(redis, pg);
  assert.equal(drift.length, 1, "flour agrees, salt does not");
  assert.deepEqual(drift[0], { ingredientId: "salt", redis: 500, postgres: 400 });
});

await test("an ingredient missing from one side is the worst drift, and is seen", async () => {
  const { totalsFrom, driftBetween } = await import("./_mirror.js");
  /* Comparing only the ingredients both sides know about is the one shape of
     check that cannot notice a whole ingredient failing to migrate. */
  const redis = totalsFrom([{ ingredientId: "beef", qtyBase: 9000 }]);
  const drift = driftBetween(redis, new Map());
  assert.equal(drift.length, 1);
  assert.equal(drift[0].postgres, 0);

  const other = driftBetween(new Map(), new Map([["ghost", 5]]));
  assert.equal(other.length, 1, "and in the other direction too");
});

await test("floating point noise is not treated as disagreement", async () => {
  const { totalsFrom, driftBetween } = await import("./_mirror.js");
  /* 0.1 + 0.2 summed as doubles on one side and stored as NUMERIC on the
     other differ in the fifteenth decimal place. Six is what both hold. */
  const redis = totalsFrom([{ ingredientId: "x", qtyBase: 0.1 }, { ingredientId: "x", qtyBase: 0.2 }]);
  assert.equal(driftBetween(redis, new Map([["x", 0.3]])).length, 0);
  assert.equal(driftBetween(redis, new Map([["x", 0.31]])).length, 1, "but a real difference is");
});

/* ── The live path, end to end ─────────────────────────────────────────── */

await test("recording a movement the ordinary way writes both ledgers", async () => {
  /* Not the mirror called directly — `recordMovement`, the function every
     screen and scanner in the app goes through. If dual writing is not wired
     into that, everything else here is a test of a function nobody calls. */
  const inv = await import("./_inventory.js");
  const mv = await import("./_movements.js");

  await inv.saveIngredient(BIZ, { name: "Olive oil", stockUnit: "L" });
  /* Its own branch. Every other test in this file writes straight to Postgres
     to exercise the mirror, so the shared branch has rows Redis never saw —
     comparing against it would report drift this test did not cause. */
  const LIVE = "b-live";
  const written = await mv.recordMovement(BIZ, LIVE, {
    ingredientId: "olive-oil", type: "receive", qty: 5, unit: "L", unitCost: 22, actor: "sam",
  });
  assert.equal(written.error, undefined, JSON.stringify(written));

  const [row] = await rowsFor(written.movement.id);
  assert.ok(row, "the movement reached Postgres without anybody asking it to");
  assert.equal(Number(row.quantity_signed), 5000, "5 L as 5000 ml");
  assert.equal(row.type, "receive");
  assert.equal(row.actor, "sam");

  /* And the two agree, which is the only thing the migration claims. */
  const redis = await mv.listMovements(BIZ, LIVE, { limit: Infinity });
  const { totalsFrom, driftBetween } = await import("./_mirror.js");
  const pg = await db().query(
    `SELECT ingredient_id, sum(quantity_signed)::float8 total FROM inventory_movements
      WHERE business_id = $1 AND branch_id = $2 GROUP BY ingredient_id`, [BIZ, LIVE]);
  const drift = driftBetween(
    totalsFrom(redis),
    new Map(pg.rows.map((r) => [r.ingredient_id, Number(r.total)])));
  assert.deepEqual(drift, [], "no drift between the two");
});

/* ── Leave it as it was found ───────────────────────────────────────────── */

try {
  await db().query("DELETE FROM inventory_movements WHERE business_id = $1", [BIZ]);
  await db().query("DELETE FROM businesses WHERE id = $1", [BIZ]);
  const left = await db().query(
    "SELECT count(*)::int n FROM inventory_movements WHERE business_id = $1", [BIZ]);
  if (left.rows[0].n !== 0) { failures += 1; console.error("  FAIL cleanup left rows"); }
} catch (err) {
  failures += 1;
  console.error("  FAIL cleanup:", err.message);
} finally {
  await close();
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
