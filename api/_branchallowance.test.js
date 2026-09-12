/* How many of the till's stores a business may use.

   ── Why there is a limit ─────────────────────────────────────────────────

   A branch is not something the app creates: it is a store the POS reports. So
   connecting a till to a nine-site chain handed over nine branches the moment
   the token was pasted — the whole product arriving without anybody agreeing
   to it, and no way to sell the second site or stage a rollout.

   ── The two rules that matter ────────────────────────────────────────────

   The allowance binds the owner. A limit the limited party can lift is not a
   limit, and "scope: all" used to mean all — so the allowance has to be
   applied before the role's own scope, not after.

   An allowance nobody has set means no limit. Organizations already exist with
   stores in daily use, and a default of one would have locked them on deploy:
   stock would stop being receivable where it had been receivable an hour
   earlier, with nothing on screen explaining why. New organizations are given
   one at creation, which is where a default belongs. */

import assert from "node:assert/strict";
import {
  unlockedBranches, lockedBranches, lockedForMember, authorizedBranches,
  createOrg, getOrg, setBranchAllowance, scopeFor, DEFAULT_BRANCH_ALLOWANCE,
} from "./_org.js";

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("  ok ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const POS = ["s1", "s2", "s3", "s4", "s5"];

const org = (branchAllowance, extra = {}) => ({
  id: "org1",
  ownerUsername: "sam",
  branchAllowance,
  members: {
    sam: { username: "sam", role: "owner", branches: [] },
    ali: { username: "ali", role: "ops", branches: ["s1", "s3"] },
    ...extra,
  },
});

await test("an allowance caps what the till hands over", () => {
  assert.deepEqual(unlockedBranches(org(1), POS), ["s1"]);
  assert.deepEqual(unlockedBranches(org(3), POS), ["s1", "s2", "s3"]);
  assert.deepEqual(unlockedBranches(org(0), POS), []);
  assert.deepEqual(unlockedBranches(org(9), POS), POS, "more than exist is just all of them");
});

await test("the owner is capped too", () => {
  /* The rule this exists for. "scope: all" meant every store the till
     reported, so an owner was the one person the allowance could not have
     bound — and an allowance the buyer can lift is not an allowance. */
  assert.deepEqual(authorizedBranches(org(1), "sam", POS), ["s1"]);
  assert.deepEqual(authorizedBranches(org(2), "sam", POS), ["s1", "s2"]);
});

await test("a member gets their assignment intersected with the allowance", () => {
  /* Assigned s1 and s3. With three branches granted they hold both; with one
     granted, s3 is behind the allowance and they hold only s1. */
  assert.deepEqual(authorizedBranches(org(3), "ali", POS), ["s1", "s3"]);
  assert.deepEqual(authorizedBranches(org(1), "ali", POS), ["s1"]);
});

await test("an allowance nobody set is no limit", () => {
  /* The grandfather clause. Both spellings mean unlimited: an organization
     created before the field existed has no property at all, and one an admin
     has explicitly unlimited carries null. */
  assert.deepEqual(unlockedBranches(org(undefined), POS), POS);
  assert.deepEqual(unlockedBranches(org(null), POS), POS);
  assert.deepEqual(unlockedBranches({ members: {} }, POS), POS, "no org record at all");
  assert.deepEqual(authorizedBranches(org(null), "sam", POS), POS);
});

await test("locked is whatever the allowance left out", () => {
  assert.deepEqual(lockedBranches(org(2), POS), ["s3", "s4", "s5"]);
  assert.deepEqual(lockedBranches(org(null), POS), []);
  assert.deepEqual(lockedBranches(org(9), POS), []);
});

await test("a person is only told about locked branches that would be theirs", () => {
  /* Two different reasons somebody cannot see a store, and only one of them
     should be visible. The allowance is the business's own arrangement and
     showing it is how they ask. Somebody else's branch is none of theirs, and
     a greyed row still discloses that a store exists and what it is called. */
  assert.deepEqual(lockedForMember(org(1), "sam", POS), ["s2", "s3", "s4", "s5"],
    "an owner sees every locked store");
  assert.deepEqual(lockedForMember(org(1), "ali", POS), ["s3"],
    "a member sees only the locked one already assigned to them");
  assert.deepEqual(lockedForMember(org(1), "nobody", POS), [],
    "somebody with no membership is told nothing");
});

await test("a stale assignment does not become visible through the lock", () => {
  /* Assigned a store the till no longer reports. It is not authorized and it
     is not lockable either — it simply is not there. */
  const withGhost = org(1, { raj: { username: "raj", role: "ops", branches: ["s9"] } });
  assert.deepEqual(authorizedBranches(withGhost, "raj", POS), []);
  assert.deepEqual(lockedForMember(withGhost, "raj", POS), []);
});

/* ── Through the store ──────────────────────────────────────────────────── */

await test("a new organization starts with one branch", async () => {
  const made = await createOrg({ ownerUsername: "newbiz", name: "New" });
  assert.equal(made.branchAllowance, DEFAULT_BRANCH_ALLOWANCE);
  assert.deepEqual(unlockedBranches(made, POS), ["s1"]);
});

await test("an organization can be created without a limit", async () => {
  /* The path `orgFor` uses when it is backfilling an account older than the
     allowance — explicitly unlimited rather than accidentally so. */
  const made = await createOrg({ ownerUsername: "legacy", name: "Old", branchAllowance: null });
  assert.equal(made.branchAllowance, null);
  assert.deepEqual(unlockedBranches(made, POS), POS);
});

await test("granting more branches takes effect, and can be lifted entirely", async () => {
  const made = await createOrg({ ownerUsername: "grow", name: "Growing" });
  assert.deepEqual(unlockedBranches(made, POS), ["s1"]);

  await setBranchAllowance(made.id, 3);
  assert.deepEqual(unlockedBranches(await getOrg(made.id), POS), ["s1", "s2", "s3"]);

  await setBranchAllowance(made.id, null);
  assert.deepEqual(unlockedBranches(await getOrg(made.id), POS), POS);

  /* And put back, because an arrangement can end. */
  await setBranchAllowance(made.id, 2);
  assert.deepEqual(unlockedBranches(await getOrg(made.id), POS), ["s1", "s2"]);
});

await test("a nonsense allowance changes nothing, and never opens everything", async () => {
  /* Two failures would matter here and they pull in opposite directions. A bad
     value read as "no limit" hands over every store; a bad value floored to
     zero locks a business out over a typo. Neither: it is refused, and
     whatever was granted before still stands. */
  const made = await createOrg({ ownerUsername: "junk", name: "Junk" });
  await setBranchAllowance(made.id, 3);

  assert.equal((await setBranchAllowance(made.id, "abc")).error, "allowance");
  assert.deepEqual(unlockedBranches(await getOrg(made.id), POS), ["s1", "s2", "s3"],
    "the three they had are still theirs");

  /* A negative is not nonsense, it is zero — somebody turning a business off. */
  await setBranchAllowance(made.id, -4);
  assert.deepEqual(unlockedBranches(await getOrg(made.id), POS), []);

  await setBranchAllowance(made.id, 2.7);
  assert.deepEqual(unlockedBranches(await getOrg(made.id), POS), ["s1", "s2"], "floored, not rounded up");
});

await test("setting an allowance on an organization that is not there is refused", async () => {
  assert.equal((await setBranchAllowance("no-such-org", 3)).error, "notfound");
});

await test("the scope a request resolves carries both lists", async () => {
  const made = await createOrg({ ownerUsername: "scoped", name: "Scoped" });
  await setBranchAllowance(made.id, 2);

  const scope = await scopeFor({ username: "scoped", orgId: made.id, createdAt: Date.now() }, POS);
  assert.deepEqual(scope.authorized, ["s1", "s2"]);
  assert.deepEqual(scope.locked, ["s3", "s4", "s5"]);
  assert.equal(scope.branchAllowance, 2);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
