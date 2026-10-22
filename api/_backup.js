/* The orderable, testable half of taking a backup.

   ── Why this exists at all ───────────────────────────────────────────────

   On 17-Oct-2026 the production Redis was deleted by its provider and there
   was nothing to restore from, because a free database has no backups and
   persistence had never been enabled. Everything moved to Postgres, which is
   durable — and Neon's free plan keeps an instant-restore window of six
   hours. Six hours is long enough to undo a bad migration noticed at once. It
   is not long enough to undo one noticed on Monday.

   So: a backup that lives somewhere the database provider does not control.
   The lesson of this month is that one provider's retention policy is not a
   backup, and that applies to the new provider exactly as much as the old.

   ── Why hand-rolled and not pg_dump ──────────────────────────────────────

   pg_dump is better at this and should be preferred wherever it exists. It
   does not exist here: there is no PostgreSQL client installed on the machine
   this is developed on, and pg_dump refuses to dump a server newer than
   itself, so a CI runner's packaged client (often several major versions
   behind) cannot read a Postgres 18 database either.

   The data is a handful of small tables. A dump that runs anywhere Node runs,
   with no binary to install and no version to match, is worth more than a
   better format nobody can produce. The restore is written here too, and
   tested by round trip, because a backup nobody has restored is not a backup
   — it is a file.

   ── What is in this file rather than the script ──────────────────────────

   The parts that can be wrong without failing: what order to write tables in,
   and which columns point at the same table they live in. Both are silent
   when wrong — a restore that violates a foreign key fails loudly and is
   fine, but one that quietly drops a link does not. They are here so they can
   be tested without a database. */

/* The types the schema actually uses. Anything else is refused rather than
   guessed at, because the failure mode of guessing is a backup that restores
   without complaint and is subtly not what was backed up.

   `numeric` is in the list but needs saying: `pg` returns it as a string, on
   purpose, so no float can round a price on the way past. That string is
   written to the dump and handed back verbatim. */
export const SUPPORTED_TYPES = new Set([
  /* `character` is bpchar — fixed width, blank-padded. `orders.currency` is
     character(3), and the padding is applied by the column on the way in, so
     whatever the dump holds is what the column produced and inserting it back
     produces the same thing. Added only after the round-trip test showed a
     short value padding identically both times; it was refused before that,
     which is the behaviour working. */
  "character",
  "uuid", "text", "character varying", "boolean",
  "numeric", "integer", "bigint", "smallint", "double precision",
  "timestamp with time zone", "timestamp without time zone", "date",
  "json", "jsonb",
]);

/* Columns needing an explicit cast on the way back in. A jsonb value arrives
   from the driver already parsed, so it goes into the dump as an object and
   has to be re-serialised and cast on insert; passing the object straight to
   a parameter would store the string "[object Object]". */
export const CAST_TYPES = { json: "::json", jsonb: "::jsonb" };

export function unsupportedColumns(columns = []) {
  return columns.filter((c) => !SUPPORTED_TYPES.has(c.type));
}

/* ── Table order ─────────────────────────────────────────────────────────

   A row cannot be inserted before the row it references, so parents are
   written and restored first. Kahn's algorithm over the foreign keys, with
   two deliberate details.

   Self-references are not edges. `inventory_movements.reverses_id` points at
   another row in the same table; that is an ordering problem *within* a
   table, handled separately, and treating it as an edge would make every such
   table a cycle and the whole graph unsortable.

   Ties break by name, so two runs of the same database produce byte-identical
   dumps. A backup that differs from yesterday's only in the order of its
   tables is one nobody can diff, and "has anything changed" is a question
   worth being able to answer cheaply. */
export function orderTables(tables = [], edges = []) {
  const names = [...new Set(tables)].sort();
  const known = new Set(names);

  const incoming = new Map(names.map((n) => [n, new Set()]));
  const children = new Map(names.map((n) => [n, new Set()]));

  for (const { child, parent } of edges) {
    if (child === parent) continue;
    if (!known.has(child) || !known.has(parent)) continue;
    incoming.get(child).add(parent);
    children.get(parent).add(child);
  }

  const out = [];
  const ready = names.filter((n) => incoming.get(n).size === 0);

  while (ready.length) {
    ready.sort();
    const n = ready.shift();
    out.push(n);
    for (const c of children.get(n)) {
      incoming.get(c).delete(n);
      if (incoming.get(c).size === 0) ready.push(c);
    }
  }

  /* A cycle between two tables cannot be ordered, and silently emitting a
     partial list would produce a dump missing whole tables. Said plainly
     instead, naming them. */
  if (out.length !== names.length) {
    const stuck = names.filter((n) => !out.includes(n));
    throw new Error(`circular foreign keys, cannot order: ${stuck.join(", ")}`);
  }
  return out;
}

/* Columns that point at their own table.

   These are nulled on insert and filled in by a second pass, because the row
   they reference may not have been written yet and the order within a table
   is not something the dump can guarantee. The alternative is deferring the
   constraint, which needs the constraint to have been declared DEFERRABLE and
   it was not. */
export function selfRefColumns(edges = [], nullable = new Map()) {
  const out = new Map();
  for (const { child, parent, columns } of edges) {
    if (child !== parent || !columns?.length) continue;

    /* A composite foreign key declared MATCH SIMPLE — the default, and what
       migration 002 wrote — is satisfied the moment any one of its
       referencing columns is null. `inventory_movements` references itself
       through (reverses_id, business_id); business_id is NOT NULL and must
       stay set, and nulling reverses_id alone defers the whole link.

       So one nullable column per foreign key, chosen by name so two runs
       choose the same one. */
    const can = [...columns].filter((c) => nullable.get(child)?.has(c)).sort();
    if (!can.length) {
      /* Nothing can be nulled, so the row cannot be inserted before the row
         it points at, and the only remaining option would be to order rows
         within the table by following the links. Said out loud rather than
         attempted: a restore that quietly reordered a ledger would be worse
         than one that refused. */
      throw new Error(
        `${child} references itself through (${columns.join(", ")}) and none of those`
        + " columns is nullable, so the link cannot be deferred on restore.",
      );
    }
    if (!out.has(child)) out.set(child, new Set());
    out.get(child).add(can[0]);
  }
  return new Map([...out].map(([t, cols]) => [t, [...cols].sort()]));
}

/* ── The dump's own shape ────────────────────────────────────────────────

   Newline-delimited JSON, gzipped. One header, then per table a descriptor
   line followed by one line per row, each row an array positional to the
   descriptor's columns.

   Arrays rather than objects for the rows: a hundred thousand repetitions of
   the same seventeen key names is most of the file, and the descriptor
   already says what the positions mean. Newline-delimited rather than one
   JSON document so a truncated file still yields every complete row before
   the truncation, which is the difference between losing a backup and losing
   the end of one. */
export const FORMAT = "puremargin-backup";
export const FORMAT_VERSION = 1;

export function headerLine({ at = new Date().toISOString(), server = "", tables = [] } = {}) {
  return JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, at, server, tables });
}

export function checkHeader(obj) {
  if (!obj || obj.format !== FORMAT) return "not a PureMargin backup";
  if (obj.version !== FORMAT_VERSION) return `unsupported backup version ${obj.version}`;
  return null;
}
