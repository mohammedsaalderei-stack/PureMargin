/* Stage 1 authorization tests.

   These are the acceptance tests named in the direction document, written
   against the scope resolver rather than over HTTP so they can run with
   `node api/_org.test.js` and no server.

   The one that matters most is the branch manager: a request body, query
   string or export that names another branch must not widen their scope. */

import assert from "assert";
import { __resetMemory, setJSON, backend } from "./_store.js";
import {
  createOrg, setMember, removeMember, authorizedBranches,
  effectiveBranches, parseBranchParam, can, scopeFor, orgFor, ROLES,
} from "./_org.js";
import { applyScope } from "./_scope-metrics.js";

/* These tests write accounts and organizations through the real store module.
   If a Redis backend is attached they would write into it — and `__resetMemory`
   only clears the in-process map, so the fixtures would survive as live
   records. Refuse to run anywhere but the in-memory backend. */
if (backend !== "memory") {
  console.error(
    `\nRefusing to run: the store backend is "${backend}", so these tests would\n` +
      "write fixture accounts into real storage. Run them with the backend\n" +
      "detached:\n\n  REDIS_URL= KV_URL= KV_REST_API_URL= npm test\n"
  );
  process.exit(1);
}

const BRANCHES = ["b1", "b2", "b3"];
let passed = 0;

async function test(name, fn) {
  __resetMemory();
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`);
    process.exitCode = 1;
  }
}

/* An account as the store holds one, enough for scope resolution. */
async function account(username, orgId) {
  const acct = { username, orgId, email: `${username}@x.co`, business: "" };
  await setJSON(`acct:${username}`, acct);
  return acct;
}

console.log("\nStage 1 — organizations, branches, roles, permissions\n");

await test("an owner's scope covers every branch in the organization", async () => {
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  assert.deepStrictEqual(authorizedBranches(org, "owner", BRANCHES), BRANCHES);
});

await test("a branch manager is limited to assigned branches", async () => {
  const org = await createOrg({ ownerUsername: "owner" });
  await setMember(org.id, "bm", { role: "branch_manager", branches: ["b2"] });
  const fresh = await orgFor(await account("bm", org.id));
  assert.deepStrictEqual(authorizedBranches(fresh, "bm", BRANCHES), ["b2"]);
});

await test("a branch manager cannot widen scope through the request", async () => {
  const org = await createOrg({ ownerUsername: "owner" });
  await setMember(org.id, "bm", { role: "branch_manager", branches: ["b2"] });
  const authorized = authorizedBranches(await orgFor(await account("bm", org.id)), "bm", BRANCHES);

  // Asking for another branch outright.
  assert.deepStrictEqual(effectiveBranches(["b1"], authorized), []);
  // Smuggling it alongside their own.
  assert.deepStrictEqual(effectiveBranches(["b1", "b2", "b3"], authorized), ["b2"]);
  // Asking for everything by asking for nothing.
  assert.deepStrictEqual(effectiveBranches([], authorized), ["b2"]);
});

await test("a multi-branch user sees the intersection, not the union", async () => {
  const org = await createOrg({ ownerUsername: "owner" });
  await setMember(org.id, "ops", { role: "ops", branches: ["b1", "b3"] });
  const authorized = authorizedBranches(await orgFor(await account("ops", org.id)), "ops", BRANCHES);
  assert.deepStrictEqual(effectiveBranches(["b1", "b2"], authorized), ["b1"]);
});

await test("a branch removed from the POS drops out of permissions", async () => {
  const org = await createOrg({ ownerUsername: "owner" });
  await setMember(org.id, "bm", { role: "branch_manager", branches: ["b2", "gone"] });
  const fresh = await orgFor(await account("bm", org.id));
  assert.deepStrictEqual(authorizedBranches(fresh, "bm", BRANCHES), ["b2"]);
});

await test("a user with no membership row gets no scope at all", async () => {
  const org = await createOrg({ ownerUsername: "owner" });
  const outsider = await account("outsider", org.id);
  const scope = await scopeFor(outsider, BRANCHES);
  assert.strictEqual(scope.role, null);
  assert.deepStrictEqual(scope.authorized, []);
  assert.deepStrictEqual(scope.capabilities, []);
});

await test("no other organization's branches are reachable", async () => {
  const a = await createOrg({ ownerUsername: "ownera" });
  await createOrg({ ownerUsername: "ownerb" });
  // ownerb is not a member of org a, so org a grants them nothing.
  assert.deepStrictEqual(authorizedBranches(a, "ownerb", BRANCHES), []);
});

await test("only the owner role may administer users or integrations", async () => {
  assert.ok(can("owner", "manage:users"));
  for (const role of ["ops", "branch_manager", "chef", "accountant"]) {
    assert.ok(!can(role, "manage:users"), `${role} must not manage users`);
    assert.ok(!can(role, "manage:integrations"), `${role} must not manage integrations`);
  }
});

await test("role capabilities match the direction document", async () => {
  // An accountant reads costs but administers no recipes.
  assert.ok(can("accountant", "view:costs"));
  assert.ok(!can("accountant", "manage:recipes"));
  // A chef runs recipes and inventory but sees no costs or profitability.
  assert.ok(can("chef", "manage:recipes"));
  assert.ok(!can("chef", "view:costs"));
  assert.ok(!can("chef", "view:profitability"));
});

await test("the owner's own membership cannot be demoted or removed", async () => {
  const org = await createOrg({ ownerUsername: "owner" });
  assert.strictEqual((await setMember(org.id, "owner", { role: "chef" })).error, "owner");
  assert.strictEqual((await removeMember(org.id, "owner")).error, "owner");
  assert.strictEqual((await orgFor(await account("owner", org.id))).members.owner.role, "owner");
});

await test("an unknown role is refused", async () => {
  const org = await createOrg({ ownerUsername: "owner" });
  assert.strictEqual((await setMember(org.id, "x", { role: "superuser" })).error, "role");
});

await test("accounts predating organizations become their own owner", async () => {
  const legacy = { username: "legacy", email: "l@x.co", business: "Cafe" };
  await setJSON("acct:legacy", legacy);
  const org = await orgFor(legacy);
  assert.strictEqual(org.ownerUsername, "legacy");
  assert.deepStrictEqual(authorizedBranches(org, "legacy", BRANCHES), BRANCHES);
  // And the backfill is written, so the id is stable across requests.
  assert.strictEqual((await orgFor(legacy)).id, org.id);
});

await test("someone invited before registering joins that organization", async () => {
  const org = await createOrg({ ownerUsername: "owner" });
  // Invited while they have no account at all.
  await setMember(org.id, "newhire", { role: "branch_manager", branches: ["b3"] });

  // Then they register: a bare account with no orgId, as register.js creates.
  const joined = await orgFor({ username: "newhire", email: "n@x.co", business: "" });
  assert.strictEqual(joined.id, org.id, "should join the inviting organization");
  assert.strictEqual(joined.members.newhire.role, "branch_manager");
  assert.deepStrictEqual(authorizedBranches(joined, "newhire", BRANCHES), ["b3"]);
});

await test("a withdrawn invitation does not resurrect on registration", async () => {
  const org = await createOrg({ ownerUsername: "owner" });
  await setMember(org.id, "newhire", { role: "ops", branches: ["b1"] });
  await removeMember(org.id, "newhire");

  const own = await orgFor({ username: "newhire", email: "n@x.co", business: "" });
  assert.notStrictEqual(own.id, org.id, "must not join the organization they were removed from");
  assert.deepStrictEqual(authorizedBranches(org, "newhire", BRANCHES), []);
});

await test("a full scope returns the payload unchanged and complete", async () => {
  const metrics = {
    totals: { sales: 300, receipts: 30, avgTicket: 10, salesDelta: 5 },
    stores: [{ id: "b1", sales: 100, receipts: 10 }, { id: "b2", sales: 200, receipts: 20 }],
    items: [{ name: "Latte" }],
  };
  const out = applyScope(metrics, ["b1", "b2"], ["b1", "b2"]);
  assert.strictEqual(out.scope.complete, true);
  assert.deepStrictEqual(out.scope.orgWideFields, []);
  assert.strictEqual(out.totals.salesDelta, 5);
  assert.strictEqual(out.stores.length, 2);
});

await test("a narrowed scope hides other branches and recomputes totals", async () => {
  const metrics = {
    totals: { sales: 300, receipts: 30, avgTicket: 10, salesDelta: 5 },
    stores: [{ id: "b1", sales: 100, receipts: 10 }, { id: "b2", sales: 200, receipts: 20 }],
    items: [{ name: "Latte" }],
  };
  const out = applyScope(metrics, ["b1"], ["b1", "b2"]);
  assert.deepStrictEqual(out.stores.map((s) => s.id), ["b1"]);
  assert.strictEqual(out.totals.sales, 100);
  assert.strictEqual(out.totals.receipts, 10);
  assert.strictEqual(out.totals.avgTicket, 10);
  // Figures that can't be split honestly are withheld, not relabelled.
  assert.strictEqual(out.totals.salesDelta, null);
  assert.strictEqual(out.scope.complete, false);
  assert.ok(out.scope.orgWideFields.includes("items"));
});

await test("an empty effective scope exposes no branch data", async () => {
  const metrics = {
    totals: { sales: 300, receipts: 30 },
    stores: [{ id: "b1", sales: 100, receipts: 10 }],
  };
  const out = applyScope(metrics, [], ["b1"]);
  assert.deepStrictEqual(out.stores, []);
  assert.strictEqual(out.totals.sales, 0);
});

await test("branch parameters are parsed without trusting their shape", async () => {
  assert.deepStrictEqual(parseBranchParam("b1,b2"), ["b1", "b2"]);
  assert.deepStrictEqual(parseBranchParam(" b1 , b2 "), ["b1", "b2"]);
  assert.deepStrictEqual(parseBranchParam(["b1", "b2"]), ["b1", "b2"]);
  assert.deepStrictEqual(parseBranchParam(""), []);
  assert.deepStrictEqual(parseBranchParam(undefined), []);
  assert.deepStrictEqual(parseBranchParam(null), []);
});

await test("every role declares a scope rule and at least one capability", async () => {
  for (const [key, role] of Object.entries(ROLES)) {
    assert.ok(["all", "assigned"].includes(role.scope), `${key} scope`);
    assert.ok(role.can.length > 0, `${key} capabilities`);
    assert.ok(role.label, `${key} label`);
  }
});

console.log(`\n${passed} passed\n`);
