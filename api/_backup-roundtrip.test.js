/* Putting a backup back, against a real database.

   `_backup.test.js` covers the parts that can be reasoned about on paper.
   This is the part that cannot: whether a file written by `dump` actually
   goes back in, with the self-references relinked, the jsonb still an object
   and the numerics still exact to the last place.

   It is the only test that matters for a backup tool. A dump that has never
   been restored is a file, and the moment anybody finds out whether it was a
   backup is the worst possible moment to find out.

   Nothing real is touched. A scratch table is created, used and dropped; the
   dump file it restores from names only that table, and `restore` only ever
   empties the tables the file names. Skipped entirely without a database. */

import { loadLocalEnv } from "./_env.js";

loadLocalEnv();

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";

const { configured } = await import("./_db.js");
if (!configured) {
  console.log("  skip  backup round trip — no DATABASE_URL set");
  console.log("\nall passed");
  process.exit(0);
}

const { db, close } = await import("./_db.js");
const { headerLine } = await import("./_backup.js");

/* Configured but unreachable is a misconfiguration worth failing on — a
   silent skip would hide every assertion below behind a stale password. It
   should read as one sentence, though, not as a driver stack trace. */
try {
  await db().query("SELECT 1");
} catch (err) {
  console.error(`\n  cannot reach the database: ${err.message}`);
  console.error("  DATABASE_URL in .env is probably stale — check the Neon dashboard.\n");
  await close();
  process.exit(1);
}


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

const TABLE = "backup_selftest";
const file = path.join(os.tmpdir(), `puremargin-roundtrip-${Date.now()}.ndjson.gz`);

/* Three rows. The middle one points at the last one by primary key, so the
   row it references has not been inserted when its own INSERT runs — which is
   the whole reason self-references are nulled and relinked afterwards. If the
   deferral were dropped, this fails on a foreign key rather than passing
   quietly, which is the right way round. */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

/* The tenant id every row carries, so the shape here matches the real one. */
const BIZ = "99999999-9999-4999-8999-999999999999";

/* A and B deliberately carry an identical document.

   Two movements with the same note is ordinary — "spoiled in the walk-in"
   twice in a week — and it is what stops a wrong key passing by luck. Every
   row used to hold a distinct `doc`, so a relink keyed on the wrong column
   still matched exactly one row and the test went green. With these two the
   same, keying on anything but the real primary key matches two, which the
   relink refuses; and if it did not refuse, A would come back pointing at C
   and the null assertion below would fail. */
const SAME = { note: "spoiled in the walk-in", nested: { of: [1, 2, 3] } };

const ROWS = [
  { id: A, business_id: BIZ, parent_id: null, doc: SAME, amount: "10.500000", code: "AED" },
  { id: B, business_id: BIZ, parent_id: C, doc: SAME, amount: "0.022800", code: "US " },
  { id: C, business_id: BIZ, parent_id: null, doc: { note: "مطعم", unicode: true }, amount: "1234567.891234", code: null },
];

/* `id` is deliberately not first. The restore used to take the primary key to
   be the first column of the table, which is true of every table in this
   schema and would have gone unnoticed until the one where it is not. */
const COLUMNS = [
  { name: "doc", type: "jsonb" },
  { name: "id", type: "uuid" },
  { name: "business_id", type: "uuid" },
  { name: "parent_id", type: "uuid" },
  { name: "amount", type: "numeric" },
  { name: "code", type: "character" },
];

try {
  await db().query(`DROP TABLE IF EXISTS "${TABLE}"`);
  /* A composite primary key and a composite self-reference, because that is
     what migration 002 left every referenceable table looking like: every
     cross-table key carries business_id so a row cannot point at another
     tenant's. A scratch table with a single-column key tested a shape this
     database does not contain, and passed while the real one would not have
     restored at all. */
  await db().query(`
    CREATE TABLE "${TABLE}" (
      id          uuid,
      business_id uuid NOT NULL,
      parent_id   uuid,
      doc         jsonb NOT NULL,
      amount      numeric(20,6),
      code        character(3),
      PRIMARY KEY (id, business_id),
      FOREIGN KEY (parent_id, business_id) REFERENCES "${TABLE}"(id, business_id)
    )`);

  /* Written by hand rather than by `dump`, because `dump` writes every table
     and this must not restore over the real ones. The shape is the same:
     header, descriptor, then one line per row positional to the columns. */
  const body = [
    headerLine({ server: "test", tables: [TABLE] }),
    JSON.stringify({ table: TABLE, columns: COLUMNS }),
    /* Positional to COLUMNS, which deliberately does not start with the key. */
    ...ROWS.map((r) => JSON.stringify([r.doc, r.id, r.business_id, r.parent_id, r.amount, r.code])),
  ].join("\n") + "\n";
  fs.writeFileSync(file, zlib.gzipSync(body));

  const run = (...args) => execFileSync(
    process.execPath, ["scripts/backup.mjs", ...args],
    { cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(1)), ".."), encoding: "utf8" },
  );

  await test("a backup reads back before anything is restored from it", () => {
    const out = run("verify", file);
    assert.match(out, new RegExp(`${TABLE}\\s+3 rows`), "found all three");
  });

  await test("restoring into an empty table puts every row back", async () => {
    run("restore", file);
    const { rows } = await db().query(`SELECT count(*)::int n FROM "${TABLE}"`);
    assert.equal(rows[0].n, 3);
  });

  await test("a self-reference survives, though its target was written later", async () => {
    /* The assertion the deferral exists for. Dropped, this is null — and a
       null `reverses_id` on a real ledger turns a cancelled correction back
       into a movement that counts. */
    const { rows } = await db().query(`SELECT parent_id FROM "${TABLE}" WHERE id = $1`, [B]);
    assert.equal(rows[0].parent_id, C);
  });

  await test("a row with no self-reference keeps its null", async () => {
    const { rows } = await db().query(`SELECT parent_id FROM "${TABLE}" WHERE id = $1`, [A]);
    assert.equal(rows[0].parent_id, null, "not relinked to something it never pointed at");
  });

  await test("jsonb comes back as the document, not as a string of one", async () => {
    const { rows } = await db().query(`SELECT doc FROM "${TABLE}" WHERE id = $1`, [A]);
    assert.deepEqual(rows[0].doc, ROWS[0].doc);
    const uni = await db().query(`SELECT doc FROM "${TABLE}" WHERE id = $1`, [C]);
    assert.equal(uni.rows[0].doc.note, "مطعم", "unicode intact");
  });

  await test("numerics come back exact, to the last decimal place", async () => {
    /* The reason `pg` is configured to hand numerics back as strings. A
       backup that round-trips money through a float is a backup that changes
       the money. */
    const { rows } = await db().query(`SELECT id, amount FROM "${TABLE}" ORDER BY id`);
    assert.deepEqual(rows.map((r) => r.amount), ["10.500000", "0.022800", "1234567.891234"]);
  });

  await test("a fixed-width column keeps its padding, and its nulls", async () => {
    /* `orders.currency` is character(3). The padding is applied by the column
       on the way in, so a short code is padded identically on the original
       insert and on the restore — which is what makes it safe to back up, and
       what the dump refused to assume until it had been shown. */
    const { rows } = await db().query(`SELECT id, code FROM "${TABLE}" ORDER BY id`);
    assert.deepEqual(rows.map((r) => r.code), ["AED", "US ", null]);
  });

  await test("a dump of the real database is in an order it can be restored in", async () => {
    /* End to end against the live schema, because the bug this replaces was
       not in the ordering logic — that was always right — but in the query
       feeding it. It filtered `array_length(conkey, 1) = 1`, and ten of the
       twenty-three foreign keys here are composite, because migration 002
       made every cross-table reference carry business_id. With those edges
       invisible the order quietly degraded to alphabetical, which puts
       order_line_modifiers before order_lines.

       Nothing failed. The dump looked complete and simply would not have
       gone back in — which is the failure you find out about on the one day
       it matters. So the check is made against the database rather than
       against a fixture, and it keeps working as the schema grows. */
    const out = path.join(os.tmpdir(), `puremargin-order-${Date.now()}.ndjson.gz`);
    try {
      run("dump", out);
      const header = JSON.parse(
        zlib.gunzipSync(fs.readFileSync(out)).toString().split("\n")[0],
      );
      const at = new Map(header.tables.map((t, i) => [t, i]));

      const { rows: fks } = await db().query(`
        SELECT c.conrelid::regclass::text AS child,
               c.confrelid::regclass::text AS parent
          FROM pg_constraint c
          JOIN pg_class t     ON t.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
         WHERE c.contype = 'f' AND n.nspname = 'public'`);

      assert.ok(fks.length > 0, "the schema has foreign keys to check");
      let composite = 0;
      for (const { child, parent } of fks) {
        if (child === parent) continue;
        if (!at.has(child) || !at.has(parent)) continue;
        composite += 1;
        assert.ok(
          at.get(parent) < at.get(child),
          `${parent} must be restored before ${child}, but came after it`,
        );
      }
      assert.ok(composite >= 10, `checked ${composite} cross-table keys`);
    } finally {
      try { fs.unlinkSync(out); } catch { /* best effort */ }
    }
  });

  await test("restoring onto rows that already exist is refused", () => {
    /* The table is full from the restore above. A merge of two versions of
       one ledger is not something anybody can unpick afterwards. */
    let refused = false;
    let output = "";
    try { run("restore", file); } catch (err) {
      refused = true;
      output = `${err.stdout || ""}${err.stderr || ""}`;
    }
    assert.ok(refused, "exited non-zero");
    assert.match(output, /Refusing/, "and said why");
  });

  await test("--force empties first, so a restore is a replacement not a merge", async () => {
    run("restore", file, "--force");
    const { rows } = await db().query(`SELECT count(*)::int n FROM "${TABLE}"`);
    assert.equal(rows[0].n, 3, "three, not six");
  });
} finally {
  try { await db().query(`DROP TABLE IF EXISTS "${TABLE}"`); } catch { /* best effort */ }
  try { fs.unlinkSync(file); } catch { /* best effort */ }
  await close();
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
