/* Move the stock ledger into Postgres, and prove the two agree.
 *
 *   node scripts/ledger.mjs verify     compare both ledgers, change nothing
 *   node scripts/ledger.mjs backfill   copy Redis into Postgres, then verify
 *
 * ── Why verify is the default thing to run ───────────────────────────────
 *
 * The migration's whole claim is that the two ledgers say the same thing. A
 * back-fill that reports "9,412 written" has proved nothing: it says rows were
 * inserted, not that the balances match. Stock is money, and a balance that is
 * wrong does not look wrong — it just says a number.
 *
 * So `verify` sums both sides per business, branch and ingredient, and reports
 * every disagreement with both figures. It writes nothing and can be run as
 * often as you like, including in the weeks of dual writing before anything
 * switches over.
 *
 * ── Safe to re-run ───────────────────────────────────────────────────────
 *
 * Every row carries the Redis ledger's own id in `legacy_id`, unique per
 * business, so a back-fill interrupted halfway is resumed by running it again.
 * Nothing is deleted, ever, by either command.
 */

import { loadLocalEnv } from "../api/_env.js";

loadLocalEnv();

const { listKeys, getJSON, backend } = await import("../api/_store.js");
const { configured, db, close } = await import("../api/_db.js");
const { mirrorMany, totalsFrom, driftBetween } = await import("../api/_mirror.js");

const command = process.argv[2] || "verify";

if (!configured) {
  console.error("No DATABASE_URL. Nothing to migrate into — see .env.example.");
  process.exit(1);
}
if (backend === "memory") {
  console.error(
    "Redis is not configured, so there is no ledger to read.\n\n"
    + "  Set REDIS_URL (or KV_REST_API_URL and KV_REST_API_TOKEN) in .env,\n"
    + "  pointed at the PRODUCTION store. The whole point is the real ledgers.\n",
  );
  process.exit(1);
}

/* Every `inv:<orgId>:moves:<branchId>` there is.

   `listKeys` is a Redis KEYS scan, which `_store.js` already flags as fine at
   this scale. This runs once per migration, not per request. */
async function ledgers() {
  const keys = await listKeys("inv:");
  const out = [];
  for (const key of keys) {
    const m = /^inv:(.+):moves:(.*)$/.exec(key);
    if (m) out.push({ orgId: m[1], branchId: m[2], key });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}


async function postgresTotals(orgId, branchId) {
  const r = await db().query(
    `SELECT ingredient_id, sum(quantity_signed)::float8 AS total
       FROM inventory_movements
      WHERE business_id = $1::uuid AND branch_id IS NOT DISTINCT FROM $2
      GROUP BY ingredient_id`,
    [orgId, branchId || null],
  );
  return new Map(r.rows.map((row) => [row.ingredient_id, Number(row.total)]));
}


async function verify(found) {
  let checked = 0;
  let drifted = 0;
  const problems = [];

  for (const { orgId, branchId, key } of found) {
    const movements = (await getJSON(key)) || [];
    const mine = totalsFrom(movements);
    let theirs;
    try {
      theirs = await postgresTotals(orgId, branchId);
    } catch (err) {
      /* An org id that is not a uuid cannot be a business row. Reported rather
         than crashing the run — one malformed key must not stop the audit. */
      problems.push({ orgId, branchId, ingredientId: "—", redis: "?", postgres: err.message });
      drifted += 1;
      continue;
    }

    checked += new Set([...mine.keys(), ...theirs.keys()]).size;
    for (const d of driftBetween(mine, theirs)) {
      drifted += 1;
      if (problems.length < 40) problems.push({ orgId, branchId, ...d });
    }
  }

  console.log(`\n  ${found.length} ledgers, ${checked} balances checked`);
  if (drifted === 0) {
    console.log("  the two ledgers agree\n");
    return true;
  }

  console.error(`  ${drifted} disagree:\n`);
  for (const p of problems) {
    console.error(
      `    ${p.orgId.slice(0, 8)} / ${p.branchId || "—"} / ${p.ingredientId}`
      + `   redis ${p.redis}   postgres ${p.postgres}`,
    );
  }
  if (drifted > problems.length) console.error(`    … and ${drifted - problems.length} more`);
  console.error("");
  return false;
}

const found = await ledgers();
if (found.length === 0) {
  console.log("No stock ledgers found in Redis. Nothing to do.");
  await close();
  process.exit(0);
}

try {
  if (command === "backfill") {
    console.log(`  copying ${found.length} ledgers\n`);
    const totals = { written: 0, already: 0, skipped: 0, failed: 0 };

    for (const { orgId, branchId, key } of found) {
      const movements = (await getJSON(key)) || [];
      /* Oldest first, so a reversal is mirrored after the movement it undoes
         and the link between them resolves. The ledger is stored newest-first.
         Not required for correctness — an unresolved link is left null and the
         balance is the same either way — but a link that resolves is one
         somebody can follow. */
      const ordered = [...movements].reverse();

      const out = await mirrorMany(orgId, branchId, ordered);
      for (const k of Object.keys(totals)) totals[k] += out[k];

      const note = out.failed > 0 ? `  ${out.failed} FAILED` : "";
      console.log(
        `    ${orgId.slice(0, 8)} / ${branchId || "—"}`.padEnd(30)
        + `${ordered.length} entries → ${out.written} new, ${out.already} already${note}`,
      );
      for (const p of out.problems) console.error(`        ${p.id}: ${p.reason}`);
    }

    console.log(
      `\n  ${totals.written} written, ${totals.already} already there, `
      + `${totals.skipped} skipped, ${totals.failed} failed`,
    );
    if (totals.failed > 0) process.exitCode = 1;
  } else if (command !== "verify") {
    console.error(`Unknown command "${command}". Use verify or backfill.`);
    process.exitCode = 2;
  }

  if (command === "verify" || command === "backfill") {
    const agreed = await verify(found);
    if (!agreed) process.exitCode = 1;
  }
} finally {
  await close();
}
