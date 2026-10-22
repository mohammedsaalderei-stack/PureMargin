/* Take a backup, put one back, or look inside one.
 *
 *   node scripts/backup.mjs dump    [file]     write every table to a file
 *   node scripts/backup.mjs verify  <file>     read it back, change nothing
 *   node scripts/backup.mjs restore <file>     put it into the database
 *
 * ── Why you want this ────────────────────────────────────────────────────
 *
 * Neon's free plan keeps six hours of instant restore. That covers a bad
 * migration noticed immediately; it does not cover one noticed on Monday, and
 * it does not cover the account going away. The provider that deleted the
 * Redis in October was also the only copy of it. One provider's retention
 * policy is not a backup — including the current provider's.
 *
 * Run `dump` on a schedule somewhere you control, and keep the files
 * somewhere that is not Neon. They are small and they gzip well.
 *
 * ── restore is deliberately hard to do by accident ───────────────────────
 *
 * It refuses a database that already has rows unless `--force` is passed, and
 * it does the whole thing in one transaction, so a restore that fails
 * half-way leaves the database as it was rather than half-replaced. With
 * `--force` it empties each table first, which is the only way a restore can
 * mean "the database as it was" rather than "the database as it was, plus
 * whatever is in here".
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { loadLocalEnv } from "../api/_env.js";

loadLocalEnv();

const {
  SUPPORTED_TYPES, CAST_TYPES, unsupportedColumns,
  orderTables, selfRefColumns, headerLine, checkHeader,
} = await import("../api/_backup.js");
const { configured, db, close, transaction } = await import("../api/_db.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!configured) {
  console.error("No DATABASE_URL. Nothing to back up — see .env.example.");
  process.exit(1);
}

const command = process.argv[2] || "dump";
const force = process.argv.includes("--force");
const fileArg = process.argv.slice(3).find((a) => !a.startsWith("--"));

/* ── What is in the database ─────────────────────────────────────────── */

async function schema() {
  const tables = (await db().query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  )).rows.map((r) => r.table_name);

  const cols = (await db().query(
    `SELECT table_name, column_name, data_type, ordinal_position
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  )).rows;

  /* `conkey` holds the child column numbers of the constraint; only the
     single-column self-references matter here, and a composite key cannot
     point a row at itself in a way this needs to defer. */
  const edges = (await db().query(
    `SELECT c.conrelid::regclass::text  AS child,
            c.confrelid::regclass::text AS parent,
            (SELECT a.attname FROM pg_attribute a
              WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS column
       FROM pg_constraint c
       JOIN pg_class t      ON t.oid = c.conrelid
       JOIN pg_namespace n  ON n.oid = t.relnamespace
      WHERE c.contype = 'f' AND n.nspname = 'public'
        AND array_length(c.conkey, 1) = 1`,
  )).rows;

  const byTable = new Map(tables.map((t) => [t, []]));
  for (const c of cols) {
    if (byTable.has(c.table_name)) {
      byTable.get(c.table_name).push({ name: c.column_name, type: c.data_type });
    }
  }
  return { tables, byTable, edges };
}

/* ── dump ────────────────────────────────────────────────────────────── */

async function dump(target) {
  const { tables, byTable, edges } = await schema();
  if (!tables.length) {
    console.error("No tables. Run `node scripts/migrate.mjs` first.");
    process.exitCode = 1;
    return;
  }

  /* Refuse before writing anything, naming the column. A dump that silently
     skipped a type would restore cleanly and be missing data. */
  for (const t of tables) {
    const bad = unsupportedColumns(byTable.get(t));
    if (bad.length) {
      console.error(
        `Cannot back up ${t}: unsupported column type`
        + ` ${bad.map((c) => `${c.name} (${c.type})`).join(", ")}.`
        + `\nAdd it to SUPPORTED_TYPES in api/_backup.js once you know how it round-trips.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  const ordered = orderTables(tables, edges);
  const server = (await db().query("SHOW server_version")).rows[0].server_version;

  const out = target || path.join(
    ROOT, "backups",
    `puremargin-${new Date().toISOString().replace(/[:.]/g, "-")}.ndjson.gz`,
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const gzip = zlib.createGzip({ level: 9 });
  const written = pipeline(gzip, fs.createWriteStream(out));

  const write = (line) => new Promise((res, rej) => {
    gzip.write(line + "\n", (err) => (err ? rej(err) : res()));
  });

  await write(headerLine({ server, tables: ordered }));

  let total = 0;
  for (const table of ordered) {
    const columns = byTable.get(table);
    const names = columns.map((c) => c.name);
    await write(JSON.stringify({ table, columns }));

    /* Ordered by the primary key so two dumps of an unchanged database are
       byte-identical and can be compared without being read. */
    const pk = (await db().query(
      `SELECT a.attname FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = $1::regclass AND i.indisprimary
        ORDER BY a.attnum`, [table],
    )).rows.map((r) => `"${r.attname}"`);
    const order = pk.length ? ` ORDER BY ${pk.join(", ")}` : "";

    const { rows } = await db().query(
      `SELECT ${names.map((n) => `"${n}"`).join(", ")} FROM "${table}"${order}`,
    );
    for (const row of rows) await write(JSON.stringify(names.map((n) => row[n] ?? null)));

    total += rows.length;
    console.log(`    ${table.padEnd(26)} ${rows.length}`);
  }

  gzip.end();
  await written;
  const size = fs.statSync(out).size;
  console.log(`\n  ${total} rows from ${ordered.length} tables → ${out} (${(size / 1024).toFixed(1)} KB)`);
}

/* ── reading one back ────────────────────────────────────────────────── */

async function* lines(file) {
  if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
  const rl = readline.createInterface({
    input: fs.createReadStream(file).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

async function read(file) {
  const content = [];
  let header = null;
  let current = null;

  for await (const obj of lines(file)) {
    if (!header) {
      const problem = checkHeader(obj);
      if (problem) throw new Error(problem);
      header = obj;
      continue;
    }
    if (!Array.isArray(obj) && obj.table) {
      current = { table: obj.table, columns: obj.columns, rows: [] };
      content.push(current);
      continue;
    }
    if (!current) throw new Error("row before any table descriptor");
    current.rows.push(obj);
  }
  if (!header) throw new Error("empty backup");
  return { header, content };
}

async function verify(file) {
  const { header, content } = await read(file);
  console.log(`\n  taken ${header.at}  (server ${header.server})\n`);
  let total = 0;
  for (const { table, rows, columns } of content) {
    console.log(`    ${table.padEnd(26)} ${String(rows.length).padStart(7)} rows, ${columns.length} columns`);
    total += rows.length;
  }
  console.log(`\n  ${total} rows across ${content.length} tables — readable\n`);
}

/* ── restore ─────────────────────────────────────────────────────────── */

async function restore(file) {
  const { header, content } = await read(file);
  const { edges } = await schema();
  const selfRefs = selfRefColumns(edges);

  const existing = [];
  for (const { table } of content) {
    const r = await db().query(`SELECT count(*)::int n FROM "${table}"`);
    if (r.rows[0].n > 0) existing.push(`${table} (${r.rows[0].n})`);
  }
  if (existing.length && !force) {
    console.error(
      `\nRefusing: the database is not empty.\n\n  ${existing.join("\n  ")}\n\n`
      + "A restore on top of existing rows is a merge, and a merge of two\n"
      + "versions of the same ledger is not something anybody can unpick later.\n"
      + "Pass --force to empty these tables first, or restore into a new database.\n",
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\n  restoring the backup taken ${header.at}\n`);

  await transaction(async (client) => {
    if (existing.length) {
      /* Reverse order, so a child is emptied before its parent. One statement
         so the tables are consistent at every point a constraint is checked. */
      const names = content.map((c) => `"${c.table}"`).reverse().join(", ");
      await client.query(`TRUNCATE ${names} CASCADE`);
    }

    const pending = [];
    for (const { table, columns, rows } of content) {
      if (!rows.length) { console.log(`    ${table.padEnd(26)} 0`); continue; }

      const names = columns.map((c) => c.name);
      const deferred = selfRefs.get(table) || [];
      const deferredAt = deferred.map((d) => names.indexOf(d)).filter((i) => i >= 0);
      const pk = names[0];

      const placeholders = names
        .map((n, i) => `$${i + 1}${CAST_TYPES[columns[i].type] || ""}`)
        .join(", ");
      const sql = `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")})
                   VALUES (${placeholders})`;

      for (const row of rows) {
        const values = names.map((n, i) => {
          const v = row[i];
          if (deferredAt.includes(i)) return null;
          if (v !== null && CAST_TYPES[columns[i].type]) return JSON.stringify(v);
          return v;
        });
        await client.query(sql, values);

        /* A self-reference is filled in afterwards: the row it points at may
           not exist yet, and the order rows appear in is not something the
           dump promises. */
        for (const i of deferredAt) {
          if (row[i] !== null) {
            pending.push({ table, column: names[i], pk, key: row[0], value: row[i] });
          }
        }
      }
      console.log(`    ${table.padEnd(26)} ${rows.length}`);
    }

    for (const p of pending) {
      await client.query(
        `UPDATE "${p.table}" SET "${p.column}" = $1 WHERE "${p.pk}" = $2`,
        [p.value, p.key],
      );
    }
    if (pending.length) console.log(`\n  ${pending.length} self-references relinked`);
  });

  console.log("\n  restored\n");
}

/* ── ─────────────────────────────────────────────────────────────────── */

try {
  if (command === "dump") await dump(fileArg);
  else if (command === "verify") {
    if (!fileArg) throw new Error("verify needs a file");
    await verify(fileArg);
  } else if (command === "restore") {
    if (!fileArg) throw new Error("restore needs a file");
    await restore(fileArg);
  } else {
    console.error(`Unknown command "${command}". Use dump, verify or restore.`);
    process.exitCode = 2;
  }
} catch (err) {
  console.error(`\n  ${err.message}\n`);
  process.exitCode = 1;
} finally {
  await close();
}
