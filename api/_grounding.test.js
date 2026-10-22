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

/* Every organization here is created without a branch allowance.

   These tests are about branch scope — who may read which store — and the
   allowance is a separate question about what a business has been granted. A
   new organization now starts at one branch, so leaving it at the default
   would have every case below quietly testing one branch instead of three,
   and the failures would read as scope bugs. */
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
const fc = await import("./_fixedcosts.js");
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

/* Every package, unless a test says otherwise.

   These cases are about branch scope and capability, which is a different
   question from what a business has bought — and the entitlement gate fails
   closed, so without this every one of them would quietly be testing an
   empty brief and the failures would read as scope bugs. The cases that are
   about billing pass their own `features`. */
/* `table` is the free package and is in the list the same way `activeItems`
   builds it — net profit lives on the Overview, which is free. */
const ALL_FEATURES = ["table", "assistant", "operations", "costs"];

const ground = (acct, over = {}) => gr.groundingFor(acct, {
  allBranchIds: BRANCHES, branchNames: NAMES,
  salesRows: [...sold("b1"), ...sold("b2")],
  salesFetchedAt: now, from, to: now, features: ALL_FEATURES, ...over,
});

/* ------------------------- the boundary -------------------------- */

await test("an owner's brief covers the whole organization and ranks the branches", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await ground(await account("owner", org.id));
  assert.deepStrictEqual(out.scope.branches, BRANCHES);
  assert.ok(out.scope.complete);
  assert.ok(out.brief.includes("BRANCH COMPARISON"));
  assert.ok(out.brief.includes("Marina") && out.brief.includes("Deira"));
});

await test("a branch manager's brief contains no other branch, at all", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await setMember(org.id, "sara", { role: "branch_manager", branches: ["b1"] });
  await seed(org.id);
  const out = await ground(await account("sara", org.id));
  assert.deepStrictEqual(out.scope.branches, ["b1"]);
  assert.ok(!out.brief.includes("Deira"), "another branch's name is absent, not withheld");
  assert.ok(!out.brief.includes("b2"));
  assert.ok(!out.brief.includes("BRANCH COMPARISON"), "one branch is nothing to compare");
});

await test("asking for another branch does not widen the brief", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await setMember(org.id, "sara", { role: "branch_manager", branches: ["b1"] });
  await seed(org.id);
  const out = await ground(await account("sara", org.id), { requested: ["b1", "b2"] });
  assert.deepStrictEqual(out.scope.branches, ["b1"], "the intersection, never the request");
  assert.ok(!out.brief.includes("Deira"));
});

await test("sales from outside the scope cannot enter a total", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await setMember(org.id, "sara", { role: "branch_manager", branches: ["b1"] });
  await seed(org.id);
  const mine = await ground(await account("sara", org.id));
  /* b1 sold 100 burgers: 3000, not the group's 6000. A branch manager has no
     `view:costs`, so the figure is checked where their role can see it. */
  assert.strictEqual(mine.evidence.variance, undefined);
  assert.strictEqual(mine.evidence.alerts.totals.revenue, 3000);
});

await test("the brief is empty of an organization the user doesn't belong to", async () => {
  const mine = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  const other = await createOrg({ ownerUsername: "rival", name: "Rival", branchAllowance: null });
  await seed(mine.id);
  const out = await gr.groundingFor(await account("rival", other.id), {
    allBranchIds: BRANCHES, branchNames: NAMES, salesRows: sold("b1"), salesFetchedAt: now, from, to: now,
    features: ALL_FEATURES,
  });
  assert.strictEqual(out.evidence.variance.totals.unexplained, 0);
  assert.ok(!out.brief.includes("Beef mince"));
});

await test("a brand-new account starts from its own empty organization", async () => {
  const mine = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(mine.id);
  /* Signing in without an organization resolves to a fresh one of the account's
     own, never into somebody else's figures. */
  const out = await ground({ username: "newcomer" });
  assert.ok(!out.brief.includes("Beef mince"));
  assert.strictEqual(out.evidence.variance.totals.unexplained, 0);
});

await test("an owner can narrow the brief to one branch without changing session", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await ground(await account("owner", org.id), { requested: ["b2"] });
  assert.deepStrictEqual(out.scope.branches, ["b2"]);
  assert.ok(!out.brief.includes("Marina"), "the selector narrows, it does not enter a branch");
  assert.ok(!out.scope.complete, "and the brief says it is a subset");
});

/* ---------------------- capability filtering --------------------- */

await test("a chef gets stock and usage but no branch ranking", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await setMember(org.id, "chef", { role: "chef", branches: BRANCHES });
  await seed(org.id);
  const out = await ground(await account("chef", org.id));
  assert.ok(out.brief.includes("ALERTS"));
  assert.ok(!out.brief.includes("BRANCH COMPARISON"), "no view:profitability");
});

await test("an accountant gets cost and leakage without recipe administration", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await setMember(org.id, "acct", { role: "accountant", branches: BRANCHES });
  await seed(org.id);
  const out = await ground(await account("acct", org.id));
  assert.ok(out.brief.includes("FOOD COST AND LEAKAGE"));
  assert.ok(out.evidence.variance, "costs are theirs to see");
});

await test("a role without the forecast capability gets no purchasing plan", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await setMember(org.id, "acct", { role: "accountant", branches: BRANCHES });
  await seed(org.id);
  const out = await ground(await account("acct", org.id));
  assert.ok(!out.brief.includes("PURCHASING PLAN"));
  assert.strictEqual(out.evidence.plan, undefined);
});

/* -------------------- provenance and honesty --------------------- */

await test("every brief states its role, branches and period", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await ground(await account("owner", org.id));
  assert.ok(out.brief.startsWith("SCOPE OF THIS ANSWER"));
  assert.ok(out.brief.includes("Role: owner"));
  assert.ok(out.brief.includes(new Date(from).toISOString().slice(0, 10)));
});

await test("recipe coverage is disclosed with the food cost, not after it", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await ground(await account("owner", org.id), {
    salesRows: [...sold("b1"), { branchId: "b1", name: "Mystery wrap", variant: "", qty: 100, revenue: 3000, lines: 100 }],
  });
  assert.ok(/Recipe coverage 50%/.test(out.brief));
  assert.ok(out.brief.includes("Mystery wrap"), "the uncosted item is named so it can be fixed");
});

await test("stale sales are stated as such and told to lower confidence", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await ground(await account("owner", org.id), { salesFetchedAt: now - 3 * DAY });
  assert.strictEqual(out.stale, true);
  assert.ok(out.brief.includes("NOT current"));
});

await test("figures with no data say so instead of reading as zero achievement", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  const out = await ground(await account("owner", org.id), { salesRows: [] });
  assert.ok(out.brief.includes("Recipe coverage 0%"));
  assert.ok(/nothing above the configured thresholds/.test(out.brief));
});

await test("the leakage the owner is meant to find is in the brief, with its driver", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await ground(await account("owner", org.id));
  /* 40 kg used against 20 expected, at AED 40 → AED 800 unaccounted. */
  assert.ok(out.brief.includes("AED 800"), out.brief.slice(0, 400));
  assert.ok(out.brief.includes("Beef mince"));
});

await test("the brief and the engines cannot disagree — it is the same call", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
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

/* ------------------- what the business has paid for ------------------- */

/* Capability answers "may this person see it". It does not answer "has this
   business bought it", and until these existed nothing asked. Every section
   of the brief belongs to the operations package, so an account holding only
   `assistant` could read its entire back-of-house by asking the chat instead
   of opening a tab that was greyed out. */

await test("an unpaid package is absent from the brief, not merely unmentioned", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  /* An owner: every capability there is. The only thing missing is money. */
  const out = await ground(await account("owner", org.id), { features: ["assistant"] });

  assert.strictEqual(out.evidence.variance, undefined, "no leakage");
  assert.strictEqual(out.evidence.alerts, undefined, "no alerts");
  assert.strictEqual(out.evidence.plan, undefined, "no purchasing plan");
  assert.strictEqual(out.evidence.ranking, undefined, "no branch ranking");
  assert.strictEqual(out.sections, 0);

  /* The figures themselves, not just the headings: a section could be
     dropped while its numbers survived somewhere else in the prose. */
  assert.ok(!out.brief.includes("FOOD COST AND LEAKAGE"));
  assert.ok(!out.brief.includes("PURCHASING PLAN"));
  assert.ok(!out.brief.includes("Beef mince"), "no ingredient from a locked section");
});

await test("buying the package puts every section back", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await ground(await account("owner", org.id), { features: ["table", "assistant", "operations"] });

  assert.ok(out.evidence.variance, "leakage");
  assert.ok(out.evidence.plan, "purchasing plan");
  assert.ok(out.brief.includes("BRANCH COMPARISON"));
  assert.deepStrictEqual(out.entitlements.withheld, [], "nothing held back");
});

await test("forgetting to pass the packages withholds them, rather than granting them", async () => {
  /* The default has to fail closed. The cost of the other default is giving
     a package away silently, every time somebody adds a caller. */
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await gr.groundingFor(await account("owner", org.id), {
    allBranchIds: BRANCHES, branchNames: NAMES,
    salesRows: sold("b1"), salesFetchedAt: now, from, to: now,
  });
  assert.strictEqual(out.sections, 0);
  /* Sorted: the order is the order sections happen to run in, which is not
     a thing worth pinning a test to. */
  assert.deepStrictEqual([...out.entitlements.withheld].sort(), ["operations", "table"]);
});

await test("the brief names the package, so the answer can be useful about it", async () => {
  /* The packages are on the public pricing page and the owner chose them.
     "I don't have that information" is unhelpful about a thing they could
     switch on this afternoon. */
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await ground(await account("owner", org.id), { features: ["assistant"] });

  assert.ok(out.brief.includes("NOT INCLUDED IN THIS BUSINESS'S PACKAGES"));
  assert.ok(/operations/.test(out.brief), "names the package");
  assert.ok(/purchasing plan/.test(out.brief), "in words an owner would use");
});

await test("and forbids estimating the locked figures from the sales it does have", async () => {
  /* The failure that would hand the package over anyway: a model being
     helpful by working leakage out from the revenue in front of it, and
     presenting the guess beside real numbers. */
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await ground(await account("owner", org.id), { features: ["assistant"] });
  assert.ok(/Do not estimate/.test(out.brief));
});

await test("a section withheld for capability is not announced as unpaid", async () => {
  /* The two reasons are different and must not be confused. A chef is inside
     a team that paid for operations; what they cannot see is a boundary
     between colleagues, and calling it a billing matter would be wrong and a
     small leak about what their manager sees. */
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await setMember(org.id, "chef", { role: "chef", branches: BRANCHES });
  await seed(org.id);
  const out = await ground(await account("chef", org.id), { features: ["assistant", "operations", "costs"] });

  assert.strictEqual(out.evidence.ranking, undefined, "a chef gets no branch ranking");
  assert.deepStrictEqual(out.entitlements.withheld, [], "and it is not a billing matter");
  assert.ok(!out.brief.includes("NOT INCLUDED"));
});

await test("every section's package matches the screen it belongs to", async () => {
  /* A second copy of a decision, so it is asserted rather than remembered —
     the same reason `_packages.test.js` checks the two legacy maps agree. A
     section whose package drifts from its screen's is a feature given away
     or taken back without anybody deciding to. */
  const src = await import("../src/entitlements.js");
  const SCREEN = src.SCREEN_FEATURE;

  assert.strictEqual(gr.SECTION_FEATURE.leakage, SCREEN.variance, "leakage is the variance screen");
  assert.strictEqual(gr.SECTION_FEATURE.alerts, SCREEN.alerts);
  assert.strictEqual(gr.SECTION_FEATURE.plan, SCREEN.plan);
  assert.strictEqual(gr.SECTION_FEATURE.branches, SCREEN.plan, "the ranking is rendered on the plan screen");

  const { FEATURES, FREE_FEATURES } = await import("./_accounts.js");
  const real = [...FREE_FEATURES, ...FEATURES];
  for (const [section, feature] of Object.entries(gr.SECTION_FEATURE)) {
    assert.ok(real.includes(feature), `${section} -> ${feature} is a real package`);
  }

  /* The two added last: a dish margin is the recipes screen, and net profit
     is the Overview, which is free. */
  assert.strictEqual(gr.SECTION_FEATURE.menu, SCREEN.recipes, "margins are the recipes screen");
  assert.strictEqual(gr.SECTION_FEATURE.profit, SCREEN.overview, "net profit is on the Overview");
});


/* ------------------ which dishes make money, and whether ------------------ */

/* "Which dish is losing me money" is the question this product exists to
   answer, and the brief could not: it carried an aggregate food-cost
   percentage and never a single dish. */

await test("the brief ranks dishes by margin, worst first", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  /* A dish that barely washes its face, beside the 30-for-4 burger. */
  await rc.saveVersion(org.id, {
    menuItem: "Beef platter", portions: 1, yieldPct: 100, sellPrice: 50, effectiveFrom: from,
    lines: [{ ingredientId: "beef-mince", qty: 1000, unit: "g" }],
  });
  const out = await ground(await account("owner", org.id));

  assert.ok(out.brief.includes("MENU MARGINS"));
  const platter = out.brief.indexOf("Beef platter");
  const burger = out.brief.indexOf("Cheeseburger");
  assert.ok(platter > -1 && burger > -1, "both dishes are named");
  assert.ok(platter < burger, "the thin margin is listed first — it is what to act on");
});

await test("a dish whose costing is incomplete says its margin is overstated", async () => {
  /* The caveat the model cannot work out for itself: a missing ingredient
     cost understates cost and therefore *overstates* margin, so the worst
     offender can be flattered into looking fine. */
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  await inv.saveIngredient(org.id, { name: "Truffle", stockUnit: "g" });
  await rc.saveVersion(org.id, {
    menuItem: "Truffle fries", portions: 1, yieldPct: 100, sellPrice: 40, effectiveFrom: from,
    lines: [{ ingredientId: "truffle", qty: 5, unit: "g" }],
  });
  const out = await ground(await account("owner", org.id));

  assert.ok(/COSTING INCOMPLETE/.test(out.brief), "flagged on the row");
  assert.ok(/overstated/.test(out.brief), "and explained");
});

await test("menu margins are part of the operations package", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await ground(await account("owner", org.id), { features: ["table", "assistant"] });
  assert.ok(!out.brief.includes("MENU MARGINS"));
  assert.strictEqual(out.evidence.menu, undefined);
});

/* ---------------------- what is actually left over ---------------------- */

const TOTALS = { sales: 100000, cost: 30000, costCoverage: 100 };

await test("net profit is reported, and is not gross profit", async () => {
  /* The brief has always carried gross profit. Nobody runs a restaurant on
     gross profit — the rent is the question. */
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  await fc.saveCost(org.id, { name: "Rent", amount: 30000, period: "monthly", startedAt: from });

  const out = await ground(await account("owner", org.id), { totals: TOTALS });

  assert.ok(out.brief.includes("NET PROFIT"));
  assert.ok(out.evidence.profit, "the figures travel with it");
  assert.ok(
    out.evidence.profit.net < out.evidence.profit.grossProfit,
    "rent has actually been taken off",
  );
  assert.ok(out.evidence.profit.hasOperatingCosts);
});

await test("with no overheads recorded it says so, rather than implying there are none", async () => {
  /* net === gross is the most flattering lie available here: a business that
     looks like it has no costs, because nobody typed them in. */
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await ground(await account("owner", org.id), { totals: TOTALS });

  assert.strictEqual(out.evidence.profit.hasOperatingCosts, false);
  assert.strictEqual(out.evidence.profit.net, out.evidence.profit.grossProfit);
  assert.ok(/has not recorded them/.test(out.brief), "the brief refuses to let that pass as fact");
});

await test("profit is withheld when the view is one branch, not divided between them", async () => {
  /* Rent belongs to the business. Narrowed to a branch the sales half shrinks
     while the overheads do not, so the figure would simply be wrong — the
     same rule metrics.js applies to the dashboard. */
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await ground(await account("owner", org.id), { totals: TOTALS, requested: ["b1"] });

  assert.ok(!out.scope.complete, "the view really is narrowed");
  assert.strictEqual(out.evidence.profit, undefined);
  assert.ok(!out.brief.includes("NET PROFIT"));
});

await test("profit needs view:profitability, and is not a billing matter", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await setMember(org.id, "chef", { role: "chef", branches: BRANCHES });
  await seed(org.id);
  const out = await ground(await account("chef", org.id), { totals: TOTALS });

  assert.strictEqual(out.evidence.profit, undefined);
  assert.ok(!out.entitlements.withheld.includes("table"), "a capability refusal, not an unpaid one");
});

await test("without the dashboard's totals no profit is invented", async () => {
  /* The figures are passed in rather than recomputed so the assistant cannot
     disagree with the screen. Absent, the honest output is nothing. */
  const org = await createOrg({ ownerUsername: "owner", name: "Group", branchAllowance: null });
  await seed(org.id);
  const out = await ground(await account("owner", org.id));
  assert.strictEqual(out.evidence.profit, undefined);
});


console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
