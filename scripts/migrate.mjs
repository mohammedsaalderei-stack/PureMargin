/* Apply the migrations that have not been applied.

   ── Why a script rather than a hand-run .sql ─────────────────────────────

   Somebody running the file by hand in a SQL console works exactly once, and
   then nobody can say which environment has which version. A migration that
   is not recorded is a migration somebody will run twice.

   Each file runs inside a transaction together with the row that records it,
   so a failure halfway through leaves the database exactly as it was — not
   half-migrated with no note of it. That matters more here than usual: these
   tables carry money, and a partially-applied schema is the kind of state
   somebody fixes by hand at midnight.

   ── The direct connection, not the pooled one ────────────────────────────

   `_db.js` explains it: a pooler in transaction mode cannot carry the
   session-level state some DDL needs, and a migration that half-applies
   through one is a worse afternoon than any latency it saves.

   Run:  node scripts/migrate.mjs           apply what is pending
         node scripts/migrate.mjs --status   say what would run, change nothing
*/

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "migrations");

const { loadLocalEnv } = await import("../api/_env.js");
loadLocalEnv();

const { directClient, configured } = await import("../api/_db.js");

if (!configured) {
  console.error(
    "No database configured.\n\n"
    + "  Set DATABASE_URL to the pooled Neon connection string and\n"
    + "  DATABASE_URL_UNPOOLED to the direct one, in a local .env.\n\n"
    + "  Both are in the Neon dashboard under Connection Details. The pooled\n"
    + "  host has `-pooler` in it; migrations need the one that does not.\n",
  );
  process.exit(1);
}

const statusOnly = process.argv.includes("--status");

const files = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort()
  : [];

if (files.length === 0) {
  console.log("No migrations to run.");
  process.exit(0);
}

const client = await directClient();
let applied = 0;

try {
  /* The ledger of what has run. Created outside a migration because it has to
     exist before the first one can be recorded. */
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await client.query("SELECT name FROM schema_migrations");
  const done = new Set(rows.map((r) => r.name));

  for (const name of files) {
    if (done.has(name)) {
      console.log(`  ok      ${name}`);
      continue;
    }
    if (statusOnly) {
      console.log(`  pending ${name}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(DIR, name), "utf8");
    process.stdout.write(`  running ${name} … `);

    /* The file brings its own BEGIN/COMMIT, so the recording statement is
       wrapped in its own transaction immediately after. A file that failed
       has already rolled itself back and is simply not recorded. */
    try {
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING",
        [name],
      );
      applied += 1;
      console.log("applied");
    } catch (err) {
      console.log("FAILED");
      console.error(`\n${err.message}\n`);
      /* Loud about what did and did not happen. The thing that costs a night
         is not a failed migration, it is not knowing whether it half-ran. */
      console.error(
        `${name} was rolled back. Migrations before it are applied and recorded; `
        + "this one and everything after it are not.",
      );
      process.exitCode = 1;
      break;
    }
  }

  if (statusOnly) console.log("\nNothing was changed.");
  else if (applied === 0 && process.exitCode !== 1) console.log("\nAlready up to date.");
  else if (process.exitCode !== 1) console.log(`\n${applied} applied.`);
} finally {
  await client.end();
}
