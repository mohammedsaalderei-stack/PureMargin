/* Stage 6: the assistant's grounding.

   These are the document's assistant acceptance tests, written against the brief
   rather than against the model — because the boundary has to hold in what the
   model is given, not in how it behaves. A prompt cannot leak what was never put
   in it.

   What they protect: an owner sees the group and a branch ranking; a branch manager
   sees only their own branch and no other branch's name or figures, whatever they
   request; capabilities decide which sections exist at all; sales from outside the
   scope can't enter a total; every brief states period, branches, coverage and
   confidence; thin or stale data is disclosed; and no other organization appears. */

import assert from "node:assert/strict";
import { backend, __resetMemory, setJSON } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const { createOrg, setMember } = await import("./_org.js");
const inv = await import("./_inventory.js");
const mv = await import("./_movements.js");
const rc = await import("./_recipes.js");
const gr = await import("./_grounding.js");

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

const DAY = 864e5;
const now = Date.now();
const from = now - 28 * DAY;
const BRANCHES = ["b1", "b2"];
const NAMES = { b1: "Marina", b2: "Deira" };

async function account(username, orgId) {
  const acct = { username, orgId, email: `${username}@x.co`, business: "" };
  await setJSON(`acct:${username}`, acct);
  return acct;
}

const sold = (branchId, qty = 100) =>
  [{ branchId, name: "Cheeseburger", variant: "", qty, revenue: qty * 30, lines: qty }];

/* Two branches trading the same dish. Deira gets through three times the beef it
   should, which is the leak an owner is meant to find. */
async function seed(orgId) {
  await inv.saveIngredient(orgId, { name: "Beef mince", stockUnit: "kg" });
  for (const branch of BRANCHES) {
    await mv.recordMovement(orgId, branch, {
      ingredientId: "beef-mince", type: "receive", qty: 200, unit: "kg", unitCost: 40, at: from,
    });
  }
  await rc.saveVersion(orgId, {
    menuItem: "Cheeseburger", portions: 1, yieldPct: 100, sellPrice: 30, effectiveFrom: from,
    lines: [{ ingredientId: "beef-mince", qty: 100, unit: "g" }],
  });
  await mv.recordMovement(orgId, "b1", { ingredientId: "beef-mince", type: "consume", qty: 10, unit: "kg", at: from + 10 * DAY });
  await mv.recordMovement(orgId, "b2", { ingredientId: "beef-mince", type: "consume", qty: 30, unit: "kg", at: from + 10 * DAY });
}

const ground = (acct, over = {}) => gr.groundingFor(acct, {
  allBranchIds: BRANCHES, branchNames: NAMES,
  salesRows: [...sold("b1"), ...sold("b2")],
  salesFetchedAt: now, from, to: now, ...over,
});

/* ------------------------- the boundary -------------------------- */

await test("an owner's brief covers the whole organization and ranks the branches", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  await seed(org.id);
  const out = await ground(await account("owner", org.id));
  assert.deepStrictEqual(out.scope.branches, BRANCHES);
  assert.ok(out.scope.complete);
  assert.ok(out.brief.includes("BRANCH COMPARISON"));
  assert.ok(out.brief.includes("Marina") && out.brief.includes("Deira"));
});

await test("a branch manager's brief contains no other branch, at all", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  await setMember(org.id, "sara", { role: "branch_manager", branches: ["b1"] });
  await seed(org.id);
  const out = await ground(await account("sara", org.id));
  assert.deepStrictEqual(out.scope.branches, ["b1"]);
  assert.ok(!out.brief.includes("Deira"), "another branch's name is absent, not withheld");
  assert.ok(!out.brief.includes("b2"));
  assert.ok(!out.brief.includes("BRANCH COMPARISON"), "one branch is nothing to compare");
});

await test("asking for another branch does not widen the brief", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  await setMember(org.id, "sara", { role: "branch_manager", branches: ["b1"] });
  await seed(org.id);
  const out = await ground(await account("sara", org.id), { requested: ["b1", "b2"] });
  assert.deepStrictEqual(out.scope.branches, ["b1"], "the intersection, never the request");
  assert.ok(!out.brief.includes("Deira"));
});

await test("sales from outside the scope cannot enter a total", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  await setMember(org.id, "sara", { role: "branch_manager", branches: ["b1"] });
  await seed(org.id);
  const mine = await ground(await account("sara", org.id));
  /* b1 sold 100 burgers: 3000, not the group's 6000. A branch manager has no
     `view:costs`, so the figure is checked where their role can see it. */
  assert.strictEqual(mine.evidence.variance, undefined);
  assert.strictEqual(mine.evidence.alerts.totals.revenue, 3000);
});

await test("the brief is empty of an organization the user doesn't belong to", async () => {
  const mine = await createOrg({ ownerUsername: "owner", name: "Group" });
  const other = await createOrg({ ownerUsername: "rival", name: "Rival" });
  await seed(mine.id);
  const out = await gr.groundingFor(await account("rival", other.id), {
    allBranchIds: BRANCHES, branchNames: NAMES, salesRows: sold("b1"), salesFetchedAt: now, from, to: now,
  });
  assert.strictEqual(out.evidence.variance.totals.unexplained, 0);
  assert.ok(!out.brief.includes("Beef mince"));
});

await test("a brand-new account starts from its own empty organization", async () => {
  const mine = await createOrg({ ownerUsername: "owner", name: "Group" });
  await seed(mine.id);
  /* Signing in without an organization resolves to a fresh one of the account's
     own, never into somebody else's figures. */
  const out = await ground({ username: "newcomer" });
  assert.ok(!out.brief.includes("Beef mince"));
  assert.strictEqual(out.evidence.variance.totals.unexplained, 0);
});

await test("an owner can narrow the brief to one branch without changing session", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  await seed(org.id);
  const out = await ground(await account("owner", org.id), { requested: ["b2"] });
  assert.deepStrictEqual(out.scope.branches, ["b2"]);
  assert.ok(!out.brief.includes("Marina"), "the selector narrows, it does not enter a branch");
  assert.ok(!out.scope.complete, "and the brief says it is a subset");
});

/* ---------------------- capability filtering --------------------- */

await test("a chef gets stock and usage but no branch ranking", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  await setMember(org.id, "chef", { role: "chef", branches: BRANCHES });
  await seed(org.id);
  const out = await ground(await account("chef", org.id));
  assert.ok(out.brief.includes("ALERTS"));
  assert.ok(!out.brief.includes("BRANCH COMPARISON"), "no view:profitability");
});

await test("an accountant gets cost and leakage without recipe administration", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  await setMember(org.id, "acct", { role: "accountant", branches: BRANCHES });
  await seed(org.id);
  const out = await ground(await account("acct", org.id));
  assert.ok(out.brief.includes("FOOD COST AND LEAKAGE"));
  assert.ok(out.evidence.variance, "costs are theirs to see");
});

await test("a role without the forecast capability gets no purchasing plan", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  await setMember(org.id, "acct", { role: "accountant", branches: BRANCHES });
  await seed(org.id);
  const out = await ground(await account("acct", org.id));
  assert.ok(!out.brief.includes("PURCHASING PLAN"));
  assert.strictEqual(out.evidence.plan, undefined);
});

/* -------------------- provenance and honesty --------------------- */

await test("every brief states its role, branches and period", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  await seed(org.id);
  const out = await ground(await account("owner", org.id));
  assert.ok(out.brief.startsWith("SCOPE OF THIS ANSWER"));
  assert.ok(out.brief.includes("Role: owner"));
  assert.ok(out.brief.includes(new Date(from).toISOString().slice(0, 10)));
});

await test("recipe coverage is disclosed with the food cost, not after it", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  await seed(org.id);
  const out = await ground(await account("owner", org.id), {
    salesRows: [...sold("b1"), { branchId: "b1", name: "Mystery wrap", variant: "", qty: 100, revenue: 3000, lines: 100 }],
  });
  assert.ok(/Recipe coverage 50%/.test(out.brief));
  assert.ok(out.brief.includes("Mystery wrap"), "the uncosted item is named so it can be fixed");
});

await test("stale sales are stated as such and told to lower confidence", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  await seed(org.id);
  const out = await ground(await account("owner", org.id), { salesFetchedAt: now - 3 * DAY });
  assert.strictEqual(out.stale, true);
  assert.ok(out.brief.includes("NOT current"));
});

await test("figures with no data say so instead of reading as zero achievement", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  const out = await ground(await account("owner", org.id), { salesRows: [] });
  assert.ok(out.brief.includes("Recipe coverage 0%"));
  assert.ok(/nothing above the configured thresholds/.test(out.brief));
});

await test("the leakage the owner is meant to find is in the brief, with its driver", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  await seed(org.id);
  const out = await ground(await account("owner", org.id));
  /* 40 kg used against 20 expected, at AED 40 → AED 800 unaccounted. */
  assert.ok(out.brief.includes("AED 800"), out.brief.slice(0, 400));
  assert.ok(out.brief.includes("Beef mince"));
});

await test("the brief and the engines cannot disagree — it is the same call", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  await seed(org.id);
  const out = await ground(await account("owner", org.id));
  const ranked = out.evidence.ranking.map((r) => r.branchId);
  assert.deepStrictEqual(ranked, ["b2", "b1"]);
  assert.strictEqual(out.evidence.variance.totals.unexplained, out.evidence.alerts.totals.unexplained);
});

await test("the answer contract demands value, period, branches, evidence and actions", () => {
  const c = gr.ANSWER_CONTRACT;
  /* "recommendations" rather than "actions": the contract still has to demand
     that an answer ends with something to do, only the noun changed when the
     assistant's register moved to a written business briefing. */
  for (const word of ["value", "period", "branches", "evidence", "drivers", "confidence", "recommendations"]) {
    assert.ok(c.includes(word), `the contract must require ${word}`);
  }
  assert.ok(/outside their access/.test(c), "an out-of-scope branch must be refused, not guessed");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
