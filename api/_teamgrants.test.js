/* Opening a tab somebody's role does not include: PATCH /api/team.

   The route read `member.role`, which does not exist in that handler, so
   every grant answered 500 and no owner could open a tab for anybody. And
   the audit entry it wrote had no label, so `recordAudit` dropped it: a grant
   that did work would never have been on record. Both are checked here
   against the route itself. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const { issueToken } = await import("./_auth.js");
const { createAccount, getAccount } = await import("./_accounts.js");
const { orgFor, setMember } = await import("./_org.js");
const { readAudit } = await import("./_audit.js");
const { grantable } = await import("./_tabs.js");
const team = (await import("./team.js")).default;

let failures = 0;
async function test(name, fn) {
  try {
    __resetMemory();
    await fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

function fakeRes() {
  const r = {
    code: null, body: null, headers: {},
    setHeader(k, v) { r.headers[k] = v; return r; },
    status(c) { r.code = c; return r; },
    json(b) { r.body = b; return r; },
  };
  return r;
}

const PASSWORD = "Grant-test-9x";
const TAB = grantable()[0];

async function owner() {
  await createAccount({ username: "owner1", password: PASSWORD });
  const account = await getAccount("owner1");
  const org = await orgFor(account);
  return { org, token: issueToken("owner1", account.tokenVersion || 0) };
}

async function patch(token, body) {
  const res = fakeRes();
  await team({ method: "PATCH", headers: { authorization: `Bearer ${token}` }, query: {}, body }, res);
  return res;
}

await test("an owner can open a tab for a role", async () => {
  assert.ok(TAB, "there is a grantable tab to test with");
  const { token } = await owner();
  const res = await patch(token, { roles: { chef: [TAB] } });
  assert.equal(res.code, 200, `answered ${res.code}: ${JSON.stringify(res.body)}`);
  assert.deepEqual(res.body.grants.roles.chef, [TAB]);
});

await test("the grant is kept on the organization", async () => {
  const { token } = await owner();
  await patch(token, { roles: { chef: [TAB] } });
  const org = await orgFor(await getAccount("owner1"));
  assert.deepEqual(org.tabGrants.roles.chef, [TAB]);
});

await test("the grant is on record in the audit log", async () => {
  const { org, token } = await owner();
  await patch(token, { roles: { chef: [TAB] } });
  const log = await readAudit(org.id);
  assert.ok(log.some((e) => e.action === "tabs.grant" && e.actor === "owner1"), "a tabs.grant entry by the owner");
});

await test("a member without user management is refused", async () => {
  /* Joined the way the app joins people: the seat first, then sign-up, which
     takes the seat. Adding an account that already exists to the member list
     leaves it in an organization of its own, where it is the owner. */
  const { org } = await owner();
  await setMember(org.id, "chef1", { role: "chef" });
  const signUp = (await import("./register.js")).default;
  const joined = fakeRes();
  await signUp({ method: "POST", headers: {}, body: { username: "chef1", password: PASSWORD } }, joined);
  assert.equal(joined.code, 200, `sign-up answered ${joined.code}`);
  const chef = await getAccount("chef1");
  const { scopeFor } = await import("./_org.js");
  assert.equal((await scopeFor(chef)).role, "chef", "the chef took the seat in the owner's organization");
  const res = await patch(issueToken("chef1", chef.tokenVersion || 0), { roles: { chef: [TAB] } });
  assert.equal(res.code, 403);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
