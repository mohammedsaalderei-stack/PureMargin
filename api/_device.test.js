/* A register-only device (`issueDeviceToken`, `requireAuth`, `api/till.js`).

   What this protects: a till handed to staff reaches the register and
   nothing else, whatever the account behind it can see; it cannot be passed
   off as an ordinary session; "sign out everywhere" ends it; only somebody
   signed in properly can make one; and on it the account's own permissions
   give way to whoever's PIN is at the counter. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const { createAccount, getAccount } = await import("./_accounts.js");
const { issueToken, issueDeviceToken, verifyToken, requireAuth } = await import("./_auth.js");
const { orgFor } = await import("./_org.js");
const { addEmployee } = await import("./_employees.js");
const { saveVersion } = await import("./_recipes.js");
const till = (await import("./till.js")).default;
const { getJSON, setJSON } = await import("./_store.js");

let failures = 0;
async function test(name, fn) {
  __resetMemory();
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

function fakeRes() {
  const r = { code: null, body: null, headers: {}, setHeader(k, v) { r.headers[k] = v; return r; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
  return r;
}
async function owner() {
  await createAccount({ username: "owner1", password: "Till-test-9x!" });
  const account = await getAccount("owner1");
  const org = await orgFor(account);
  await saveVersion(org.id, { menuItem: "Chicken wrap", sellPrice: 18, lines: [{ name: "Chicken", qty: 150, unit: "g" }] });
  return { account, org, session: issueToken("owner1", account.tokenVersion || 0) };
}
const ask = async (token, method, what, body, headers = {}) => {
  const res = fakeRes();
  await till({ method, url: `/api/till?what=${what}`, headers: { authorization: `Bearer ${token}`, ...headers }, query: { what }, body }, res);
  return res;
};
const authAt = async (token, url) => {
  const res = fakeRes();
  const session = await requireAuth({ url, headers: { authorization: `Bearer ${token}` } }, res);
  return { session, res };
};

await test("a device token names its account and says it is register-only", async () => {
  const t = issueDeviceToken("owner1", 3);
  assert.deepEqual(verifyToken(t), { username: "owner1", version: 3, registerOnly: true });
  assert.equal(verifyToken(issueToken("owner1", 3)).registerOnly, undefined);
});

await test("it cannot be passed off as an ordinary session, or altered", async () => {
  const t = issueDeviceToken("owner1", 0);
  assert.equal(verifyToken(t.slice(2)), null, "dropping the marker leaves a signature made for another purpose");
  const parts = t.split(".");
  parts[1] = Buffer.from("someone-else").toString("base64url");
  assert.equal(verifyToken(parts.join(".")), null);
});

await test("it reaches the register and nothing else", async () => {
  const { account } = await owner();
  const t = issueDeviceToken("owner1", account.tokenVersion || 0);
  assert.ok((await authAt(t, "/api/till?what=catalogue")).session);
  for (const url of ["/api/metrics", "/api/team", "/api/costs", "/api/account", "/api/stores", "/api/chat"]) {
    const { session, res } = await authAt(t, url);
    assert.equal(session, null, url);
    assert.equal(res.code, 403, url);
    assert.equal(res.body.error, "registeronly", url);
  }
});

await test("signing out everywhere ends the device too", async () => {
  const { account } = await owner();
  const t = issueDeviceToken("owner1", account.tokenVersion || 0);
  const stored = await getJSON("acct:owner1");
  await setJSON("acct:owner1", { ...stored, tokenVersion: (stored.tokenVersion || 0) + 1 });
  const { session, res } = await authAt(t, "/api/till");
  assert.equal(session, null);
  assert.equal(res.code, 401);
});

await test("only a proper session can make a device, and a device cannot make another", async () => {
  const { session } = await owner();
  const made = await ask(session, "POST", "device");
  assert.equal(made.code, 200);
  assert.equal(verifyToken(made.body.token).registerOnly, true);
  assert.equal((await ask(made.body.token, "POST", "device")).code, 403);
});

await test("on a device the owner's permissions give way to the PIN at the counter", async () => {
  const { org, session } = await owner();
  const device = (await ask(session, "POST", "device")).body.token;

  const cat = await ask(device, "GET", "catalogue");
  assert.equal(cat.body.device.registerOnly, true);
  assert.equal(cat.body.can.manageSettings, false, "no PIN: nobody at the counter may change settings");
  assert.equal(cat.body.can.refund, false);
  assert.equal((await ask(device, "PUT", "vat", { vatPct: 0 })).code, 403);

  const omar = await addEmployee(org.id, { name: "Omar", title: "Manager", branchId: "register" });
  await ask(session, "PUT", "pins", { employeeId: omar.employee?.id || omar.id, pin: "5678", role: "manager" });
  const as = { "x-register-operator": (await ask(device, "POST", "pin", { pin: "5678" })).body.token };
  const managed = await ask(device, "GET", "catalogue", undefined, as);
  assert.equal(managed.body.can.manageSettings, true);
  assert.equal(managed.body.can.refund, true);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
