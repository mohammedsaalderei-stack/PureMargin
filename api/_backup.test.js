/* Table ordering and self-references, which are the parts of a backup that
   can be wrong without anything failing.

   A restore that violates a foreign key throws, and is therefore fine — the
   error is the feature. The two faults worth testing are quieter than that:
   a table left out of the ordering, which restores a database missing rows
   nobody notices are missing, and a self-reference dropped on the way back
   in, which turns a reversal into an ordinary movement and makes a cancelled
   stock correction look like a real one. */

import assert from "node:assert/strict";
import {
  orderTables, selfRefColumns, unsupportedColumns,
  headerLine, checkHeader, SUPPORTED_TYPES, CAST_TYPES, FORMAT_VERSION,
} from "./_backup.js";

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const edge = (child, parent, ...columns) => ({ child, parent, columns });

/* Which columns a table will allow to be null. Every FK column here is
   nullable unless a test says otherwise; business_id never is, which is the
   whole reason a composite self-reference needs thinking about. */
const nullableAll = (table, ...cols) => new Map([[table, new Set(cols)]]);

test("a parent is always written before its child", () => {
  const order = orderTables(
    ["order_lines", "orders", "businesses"],
    [edge("orders", "businesses", "business_id"), edge("order_lines", "orders", "order_id")],
  );
  assert.deepEqual(order, ["businesses", "orders", "order_lines"]);
});

test("every table appears exactly once, including ones nothing references", () => {
  const tables = ["kv", "businesses", "orders", "schema_migrations"];
  const order = orderTables(tables, [edge("orders", "businesses", "business_id")]);
  assert.equal(order.length, tables.length);
  assert.deepEqual([...order].sort(), [...tables].sort());
});

test("the order is stable, so two dumps of one database are identical", () => {
  /* Nothing here constrains kv against schema_migrations, so without a tie
     break the order would depend on whatever the catalogue happened to
     return. A backup that differs from yesterday's only in table order is one
     nobody can diff. */
  const a = orderTables(["kv", "schema_migrations", "businesses"], []);
  const b = orderTables(["businesses", "kv", "schema_migrations"], []);
  assert.deepEqual(a, b);
  assert.deepEqual(a, ["businesses", "kv", "schema_migrations"]);
});

test("a self-reference is not an ordering edge", () => {
  /* inventory_movements.reverses_id points at inventory_movements. Counted as
     an edge it makes the table its own prerequisite, the graph unsortable,
     and the dump empty. */
  const order = orderTables(
    ["inventory_movements", "businesses"],
    [
      edge("inventory_movements", "businesses", "business_id"),
      edge("inventory_movements", "inventory_movements", "reverses_id"),
    ],
  );
  assert.deepEqual(order, ["businesses", "inventory_movements"]);
});

test("a genuine cycle is reported, with the tables named", () => {
  assert.throws(
    () => orderTables(["a", "b"], [edge("a", "b", "x"), edge("b", "a", "y")]),
    (err) => {
      assert.match(err.message, /circular/);
      assert.match(err.message, /a, b/, "names them, so it can be acted on");
      return true;
    },
  );
});

test("an edge to a table not being dumped is ignored, not a crash", () => {
  /* A view, or a table added after the list was taken. Refusing here would
     make the whole backup fail over something irrelevant to it. */
  assert.deepEqual(orderTables(["kv"], [edge("kv", "not_dumped", "x")]), ["kv"]);
});

test("self-referencing columns are found, and only those", () => {
  const found = selfRefColumns([
    edge("inventory_movements", "inventory_movements", "reverses_id"),
    edge("inventory_movements", "businesses", "business_id"),
    edge("orders", "businesses", "business_id"),
  ], nullableAll("inventory_movements", "reverses_id"));
  assert.deepEqual(found.get("inventory_movements"), ["reverses_id"]);
  assert.equal(found.has("orders"), false, "an ordinary foreign key is not deferred");
  assert.equal(found.size, 1);
});

test("a composite self-reference defers only the column that may be null", () => {
  /* The real one. Migration 002 made every cross-table reference carry
     business_id so a row cannot point at another tenant's, which made this
     foreign key (reverses_id, business_id) rather than (reverses_id).

     business_id is NOT NULL and must stay set. A composite key declared
     MATCH SIMPLE — the default — is satisfied as soon as any one referencing
     column is null, so nulling reverses_id alone defers the link. */
  const found = selfRefColumns(
    [edge("inventory_movements", "inventory_movements", "reverses_id", "business_id")],
    nullableAll("inventory_movements", "reverses_id"),
  );
  assert.deepEqual(found.get("inventory_movements"), ["reverses_id"]);
});

test("a self-reference with nothing nullable is refused, not attempted", () => {
  /* The remaining option would be to order the rows by following the links,
     and a restore that quietly reordered a ledger is worse than one that
     stopped. */
  assert.throws(
    () => selfRefColumns(
      [edge("t", "t", "a_id", "tenant_id")],
      nullableAll("t"),
    ),
    (err) => {
      assert.match(err.message, /cannot be deferred/);
      assert.match(err.message, /a_id, tenant_id/, "names the columns");
      return true;
    },
  );
});

test("two separate self-references on one table are both deferred", () => {
  const found = selfRefColumns(
    [edge("t", "t", "b_id"), edge("t", "t", "a_id")],
    nullableAll("t", "a_id", "b_id"),
  );
  assert.deepEqual(found.get("t"), ["a_id", "b_id"], "sorted, so the dump is stable");
});

test("a composite foreign key still orders its tables", () => {
  /* The bug this replaces: the schema query filtered to single-column keys,
     so ten of the twenty-three foreign keys in this schema were invisible.
     Ordering silently degraded to alphabetical, which puts
     order_line_modifiers before order_lines — a dump that looks correct and
     will not go back in. */
  const order = orderTables(
    ["order_line_modifiers", "order_lines", "orders", "businesses"],
    [
      edge("order_line_modifiers", "order_lines", "order_line_id", "business_id"),
      edge("order_lines", "orders", "order_id", "business_id"),
      edge("orders", "businesses", "business_id"),
    ],
  );
  assert.deepEqual(order, ["businesses", "orders", "order_lines", "order_line_modifiers"]);
  assert.ok(
    order.indexOf("order_lines") < order.indexOf("order_line_modifiers"),
    "the child comes after the parent, not alphabetically before it",
  );
});

test("an unsupported column type is named rather than guessed at", () => {
  const bad = unsupportedColumns([
    { name: "id", type: "uuid" },
    { name: "blob", type: "bytea" },
    { name: "tags", type: "ARRAY" },
  ]);
  assert.deepEqual(bad.map((c) => c.name), ["blob", "tags"]);
});

test("the types the schema actually uses are all supported", () => {
  /* The ones 001-004 create. A type dropped from this set would make the
     backup refuse to run, which is loud; one wrongly added would make it
     round-trip something it has not been shown to round-trip. */
  for (const t of [
    "uuid", "text", "numeric", "boolean", "jsonb",
    "timestamp with time zone", "integer",
    "character",
  ]) assert.ok(SUPPORTED_TYPES.has(t), `${t} is supported`);

  assert.equal(SUPPORTED_TYPES.has("bytea"), false, "not shown to round-trip");
});

test("json columns are cast on the way back in", () => {
  /* Without the cast the driver sends an already-parsed object as a
     parameter and Postgres stores "[object Object]" — which inserts
     successfully. */
  assert.equal(CAST_TYPES.jsonb, "::jsonb");
  assert.equal(CAST_TYPES.json, "::json");
  assert.equal(CAST_TYPES.text, undefined, "nothing else is cast");
});

test("a header identifies itself and its version", () => {
  const h = JSON.parse(headerLine({ at: "2026-10-22T00:00:00.000Z", server: "18.6", tables: ["kv"] }));
  assert.equal(checkHeader(h), null);
  assert.equal(h.version, FORMAT_VERSION);
  assert.deepEqual(h.tables, ["kv"]);
});

test("something that is not a backup is refused before anything is restored", () => {
  assert.match(checkHeader({ format: "something else" }), /not a PureMargin backup/);
  assert.match(checkHeader(null), /not a PureMargin backup/);
  assert.match(checkHeader({ format: "puremargin-backup", version: 99 }), /unsupported backup version/);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
