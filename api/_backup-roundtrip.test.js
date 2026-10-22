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

const ROWS = [
  { id: A, parent_id: null, doc: { note: "first", nested: { of: [1, 2, 3] } }, amount: "10.500000" },
  { id: B, parent_id: C, doc: { note: "points at the last one" }, amount: "0.022800" },
  { id: C, parent_id: null, doc: { note: "مطعم", unicode: true }, amount: "1234567.891234" },
];

const COLUMNS = [
  { name: "id", type: "uuid" },
  { name: "parent_id", type: "uuid" },
  { name: "doc", type: "jsonb" },
  { name: "amount", type: "numeric" },
];

try {
  await db().query(`DROP TABLE IF EXISTS "${TABLE}"`);
  await db().query(`
    CREATE TABLE "${TABLE}" (
      id        uuid PRIMARY KEY,
      parent_id uuid REFERENCES "${TABLE}"(id),
      doc       jsonb NOT NULL,
      amount    numeric(20,6)
    )`);

  /* Written by hand rather than by `dump`, because `dump` writes every table
     and this must not restore over the real ones. The shape is the same:
     header, descriptor, then one line per row positional to the columns. */
  const body = [
    headerLine({ server: "test", tables: [TABLE] }),
    JSON.stringify({ table: TABLE, columns: COLUMNS }),
    ...ROWS.map((r) => JSON.stringify([r.id, r.parent_id, r.doc, r.amount])),
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
