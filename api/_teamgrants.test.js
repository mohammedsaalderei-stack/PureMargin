/* PATCH /api/team — the tabs an owner opens up beyond a role.

   Driven through the route's own handler rather than `_tabs.js`, because the
   fault this was written for lived in the route: the PATCH branch read
   `member.role` with no `member` in scope, so every request threw and came
   back as a 500. `_tabs.test.js` passed throughout — the arithmetic was right,
   and nobody could reach it.

   What these protect: the owner can save grants and they are stored, replace
   rather than merge, reach the granted member's capabilities, and drop
   anything that may not be handed out; and somebody without `manage:users`
   writes nothing. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

/* The handler reads the branch roster on every request. With no POS token on
   the account `branchList` falls back to these, and a developer who has one
   exported would send each test upstream to a real till. Without one, the
   roster is the register alone. */
delete process.env.POS_ACCESS_TOKEN;
delete process.env.LOYVERSE_ACCESS_TOKEN;

const { default: team } = await import("./team.js");
const { issueToken } = await import("./_auth.js");
const { createAccount, getAccount } = await import("./_accounts.js");
const { scopeFor, getOrg } = await import("./_org.js");
const { REGISTER_BRANCH } = await import("./_data.js");

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

function fakeRes() {
  const r = { code: null, body: null, headers: {} };
  Object.assign(r, {
    setHeader(k, v) { r.headers[k] = v; return r; },
    status(c) { r.code = c; return r; },
    json(b) { r.body = b; return r; },
  });
  return r;
}

async function call(username, method, { body, query } = {}) {
  const res = fakeRes();
  await team({
    method,
    body,
    query: query || {},
    headers: { authorization: `Bearer ${issueToken(username, 0)}` },
  }, res);
  return res;
}

/* An owner, and a chef seated through the route the Team screen uses: the
   seat is written before the chef registers, and registering picks it up. */
async function teamOfTwo() {
  await createAccount({ username: "owner", password: "goodpass1" });
  const seated = await call("owner", "POST", { body: { username: "chef", role: "chef", branches: [REGISTER_BRANCH.id] } });
  assert.equal(seated.code, 200, `seating the chef: ${JSON.stringify(seated.body)}`);
  await createAccount({ username: "chef", password: "goodpass1" });
  const { org } = await scopeFor(await getAccount("chef"));
  assert.equal(org.ownerUsername, "owner", "the chef joined the owner's organization");
  return org.id;
}

await test("the owner can save grants", async () => {
  const orgId = await teamOfTwo();
  const res = await call("owner", "PATCH", { body: { roles: { chef: ["watch"] }, users: {} } });

  assert.equal(res.code, 200, `PATCH answered ${res.code}: ${JSON.stringify(res.body)}`);
  assert.deepEqual(res.body.grants, { roles: { chef: ["watch"] }, users: {} });
  assert.ok(Array.isArray(res.body.grantable) && res.body.grantable.includes("watch"));
  assert.deepEqual((await getOrg(orgId)).tabGrants, { roles: { chef: ["watch"] }, users: {} });
});

await test("a grant reaches the member it was given to", async () => {
  await teamOfTwo();
  const before = await scopeFor(await getAccount("chef"));
  assert.equal(before.capabilities.includes("view:profitability"), false, "a chef starts without it");

  await call("owner", "PATCH", { body: { users: { Chef: ["watch"] } } });

  const after = await scopeFor(await getAccount("chef"));
  assert.ok(after.capabilities.includes("view:profitability"), "the granted tab carries its capability");
});

await test("saving replaces the grants rather than merging them", async () => {
  const orgId = await teamOfTwo();
  await call("owner", "PATCH", { body: { roles: { chef: ["watch"] }, users: { chef: ["menu"] } } });
  const res = await call("owner", "PATCH", { body: { roles: { chef: ["watch"] } } });

  assert.equal(res.code, 200);
  assert.deepEqual((await getOrg(orgId)).tabGrants, { roles: { chef: ["watch"] }, users: {} },
    "leaving an entry out is how a grant is taken back");
});

await test("team and billing cannot be granted through the route", async () => {
  const orgId = await teamOfTwo();
  const res = await call("owner", "PATCH", {
    body: { roles: { chef: ["team", "billing", "watch"], nosuchrole: ["watch"] } },
  });

  assert.equal(res.code, 200);
  assert.deepEqual((await getOrg(orgId)).tabGrants, { roles: { chef: ["watch"] }, users: {} });
});

await test("the grants come back on the team listing", async () => {
  await teamOfTwo();
  await call("owner", "PATCH", { body: { roles: { chef: ["watch"] } } });
  const res = await call("owner", "GET");

  assert.equal(res.code, 200);
  assert.deepEqual(res.body.grants, { roles: { chef: ["watch"] }, users: {} });
  assert.deepEqual(res.body.members.find((m) => m.username === "chef").extraTabs, ["watch"]);
});

await test("a member without manage:users writes nothing", async () => {
  const orgId = await teamOfTwo();
  const res = await call("chef", "PATCH", { body: { roles: { chef: ["watch"] } } });

  assert.equal(res.code, 403);
  assert.equal((await getOrg(orgId)).tabGrants, undefined);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
