/* Stage 3: sync log, provenance, audit log.

   Same guard as the authorization tests — these write through `_store.js`, so
   they refuse to run against a real backend rather than pollute live records. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(
    `Refusing to run: the store backend is "${backend}", not memory. ` +
      "Run `npm test`, which blanks the store env vars."
  );
  process.exit(1);
}

const { append, recent } = await import("./_journal.js");
const { recordAudit, readAudit, AUDIT_ACTIONS } = await import("./_audit.js");
const { noteSync, readSyncs, lastSync } = await import("./_sync.js");
const { provenance } = await import("./_provenance.js");

let failures = 0;
async function test(name, fn) {
  __resetMemory();
  try {
    await fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

/* ---------------------------- journal ---------------------------- */

await test("entries come back newest first", async () => {
  await append("j", { n: 1 });
  await append("j", { n: 2 });
  const list = await recent("j");
  assert.deepStrictEqual(list.map((e) => e.n), [2, 1]);
});

await test("every entry is timestamped by the journal, not the caller", async () => {
  await append("j", { n: 1 });
  const [entry] = await recent("j");
  assert.ok(entry.at > 0);
});

await test("the log is capped, so one account can't grow a key forever", async () => {
  for (let i = 0; i < 60; i++) await append("j", { n: i }, 10);
  const list = await recent("j", 100);
  assert.strictEqual(list.length, 10);
  // The cap drops the oldest, never the newest.
  assert.strictEqual(list[0].n, 59);
});

/* ----------------------------- audit ----------------------------- */

await test("an administrative change is recorded with actor and target", async () => {
  await recordAudit("org1", { actor: "owner", action: "member.add", target: "chef1", detail: { role: "chef" } });
  const [entry] = await readAudit("org1");
  assert.strictEqual(entry.actor, "owner");
  assert.strictEqual(entry.action, "member.add");
  assert.strictEqual(entry.target, "chef1");
  assert.strictEqual(entry.detail.role, "chef");
});

await test("an unrecognised action is refused rather than logged unlabelled", async () => {
  const written = await recordAudit("org1", { actor: "owner", action: "something.invented" });
  assert.strictEqual(written, null);
  assert.deepStrictEqual(await readAudit("org1"), []);
});

await test("every action the code records has a label", async () => {
  // Guards against an action string being added in an endpoint but not here,
  // which would silently drop the entry.
  for (const key of Object.keys(AUDIT_ACTIONS)) {
    assert.ok(AUDIT_ACTIONS[key].length > 0, `${key} has no label`);
  }
});

await test("one organization cannot read another's audit log", async () => {
  await recordAudit("org1", { actor: "owner", action: "member.add", target: "a" });
  await recordAudit("org2", { actor: "other", action: "member.add", target: "b" });
  assert.deepStrictEqual((await readAudit("org1")).map((e) => e.target), ["a"]);
  assert.deepStrictEqual((await readAudit("org2")).map((e) => e.target), ["b"]);
});

await test("an audit write without an organization is dropped, not thrown", async () => {
  assert.strictEqual(await recordAudit(null, { actor: "x", action: "member.add" }), null);
});

/* ------------------------------ sync ----------------------------- */

await test("a successful sync records what it covered", async () => {
  await noteSync("org1", { ok: true, receipts: 120, branches: 2 });
  const [entry] = await readSyncs("org1");
  assert.strictEqual(entry.ok, true);
  assert.strictEqual(entry.receipts, 120);
});

await test("a failure is recorded with its reason", async () => {
  await noteSync("org1", { ok: false, error: "The access token was rejected" });
  const [entry] = await readSyncs("org1");
  assert.strictEqual(entry.ok, false);
  assert.match(entry.error, /rejected/);
});

await test("the last successful sync is findable behind later failures", async () => {
  // This is the question that matters after an outage: when did it last work?
  await noteSync("org1", { ok: true, receipts: 10 });
  await noteSync("org1", { ok: false, error: "unreachable" });
  await noteSync("org1", { ok: false, error: "unreachable" });

  assert.strictEqual((await lastSync("org1")).ok, false);
  const good = await lastSync("org1", { ok: true });
  assert.strictEqual(good.receipts, 10);
});

/* --------------------------- provenance -------------------------- */

const metrics = (over = {}) => ({
  connected: true,
  source: "Loyverse POS",
  totals: { receipts: 40, sales: 1000 },
  costCoverage: 62,
  missingCosts: [{ name: "Tea" }, { name: "Water" }],
  scope: { branches: ["b1"], branchCount: 1, totalBranches: 2, complete: false, exact: true },
  fetch: {
    at: 1700000000000,
    since: new Date(1700000000000 - 60 * 864e5).toISOString(),
    receiptCount: 100,
    limitedHistory: false,
    overrideCount: 3,
    branchNames: { b1: "Marina", b2: "Deira" },
  },
  ...over,
});

await test("provenance names the source, the period and the branches", async () => {
  const p = provenance(metrics(), { role: "branch_manager", ageSeconds: 12, lastSync: null });
  assert.strictEqual(p.source, "Loyverse POS");
  assert.strictEqual(p.period.reportedDays, 30);
  assert.strictEqual(p.period.fetchedDays, 60);
  assert.deepStrictEqual(p.branches.names, ["Marina"]);
  assert.strictEqual(p.branches.complete, false);
  assert.strictEqual(p.viewerRole, "branch_manager");
});

await test("fetched and counted receipts are reported separately", async () => {
  // The gap is the honest explanation for a small branch total.
  const p = provenance(metrics(), { ageSeconds: 0 });
  assert.strictEqual(p.receipts.fetched, 100);
  assert.strictEqual(p.receipts.counted, 40);
});

await test("cost coverage travels with the figures", async () => {
  const p = provenance(metrics(), { ageSeconds: 0 });
  assert.strictEqual(p.costs.coveragePct, 62);
  assert.strictEqual(p.costs.itemsMissingCost, 2);
  assert.strictEqual(p.costs.ownerEntered, 3);
});

await test("a limited-history plan is disclosed, not hidden", async () => {
  const p = provenance(metrics({ fetch: { ...metrics().fetch, limitedHistory: true } }), { ageSeconds: 0 });
  assert.strictEqual(p.period.limitedHistory, true);
  assert.strictEqual(p.period.fetchedDays, 30);
});

await test("cache age and last fetch are distinct facts", async () => {
  const p = provenance(metrics(), {
    ageSeconds: 5,
    lastSync: { at: 1699999000000, ok: false, error: "unreachable" },
  });
  assert.strictEqual(p.ageSeconds, 5);
  assert.strictEqual(p.fetchedAt, new Date(1700000000000).toISOString());
  // A failing POS behind warm figures must be visible.
  assert.strictEqual(p.lastSync.ok, false);
  assert.match(p.lastSync.error, /unreachable/);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
