/* Accounts: optional address, and renaming.

   What these protect: an account can exist without an email; a rename moves
   the record rather than leaving two, carries the address index and the
   organization's membership with it, invalidates old tokens, and refuses a
   name somebody already holds or a wrong password. */

import assert from "node:assert/strict";
import { backend, __resetMemory, getJSON } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const acc = await import("./_accounts.js");
const { createOrg } = await import("./_org.js");

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

const PW = "goodpass1";

await test("an account can be created without an address", async () => {
  const { account, error } = await acc.createAccount({ username: "chef", password: PW });
  assert.equal(error, undefined);
  assert.equal(account.email, "");
  assert.ok(await acc.getAccount("chef"));
});

await test("two accounts without addresses do not collide", async () => {
  await acc.createAccount({ username: "chef", password: PW });
  const { account, error } = await acc.createAccount({ username: "cashier", password: PW });
  assert.equal(error, undefined, "an empty address must not read as taken");
  assert.equal(account.username, "cashier");
});

await test("an account without an address can still sign in", async () => {
  await acc.createAccount({ username: "chef", password: PW });
  assert.ok(await acc.verifyPassword("chef", PW));
  assert.equal(await acc.verifyPassword("chef", "wrong"), null);
});

await test("a duplicate address is still refused", async () => {
  await acc.createAccount({ username: "one", password: PW, email: "a@b.co" });
  const { error } = await acc.createAccount({ username: "two", password: PW, email: "a@b.co" });
  assert.equal(error, "emailtaken");
});

await test("an address can be added later", async () => {
  await acc.createAccount({ username: "chef", password: PW });
  const { account, error } = await acc.setEmail("chef", PW, "chef@b.co");
  assert.equal(error, undefined);
  assert.equal(account.email, "chef@b.co");
  assert.equal((await acc.getAccountByEmail("chef@b.co")).username, "chef");
});

await test("a rename moves the record and leaves nothing behind", async () => {
  await acc.createAccount({ username: "old", password: PW });
  const { account, previous, error } = await acc.renameAccount("old", PW, "new");
  assert.equal(error, undefined);
  assert.equal(account.username, "new");
  assert.equal(previous, "old");
  assert.ok(await acc.getAccount("new"));
  assert.equal(await acc.getAccount("old"), null, "the old name must not still resolve");
});

await test("a rename carries the address index with it", async () => {
  await acc.createAccount({ username: "old", password: PW, email: "a@b.co" });
  await acc.renameAccount("old", PW, "new");
  const found = await acc.getAccountByEmail("a@b.co");
  assert.equal(found.username, "new", "signing in by address must find the renamed account");
});

await test("a rename invalidates tokens issued under the old name", async () => {
  await acc.createAccount({ username: "old", password: PW });
  const before = (await acc.getAccount("old")).tokenVersion || 0;
  const { account } = await acc.renameAccount("old", PW, "new");
  assert.ok(account.tokenVersion > before, "every old session must stop working");
});

await test("a rename refuses a name somebody already holds", async () => {
  await acc.createAccount({ username: "old", password: PW });
  await acc.createAccount({ username: "taken", password: PW });
  const { error } = await acc.renameAccount("old", PW, "taken");
  assert.equal(error, "taken");
  assert.ok(await acc.getAccount("old"), "a refused rename must not have moved anything");
});

await test("a rename refuses a wrong password", async () => {
  await acc.createAccount({ username: "old", password: PW });
  const { error } = await acc.renameAccount("old", "nope", "new");
  assert.equal(error, "wrongcurrent");
  assert.ok(await acc.getAccount("old"));
});

await test("a rename refuses a name of the wrong shape", async () => {
  await acc.createAccount({ username: "old", password: PW });
  const { error } = await acc.renameAccount("old", PW, "no spaces allowed");
  assert.equal(error, "username");
});

await test("renaming to the same name is a no-op, not an error", async () => {
  await acc.createAccount({ username: "same", password: PW });
  const { unchanged, error } = await acc.renameAccount("same", PW, "same");
  assert.equal(error, undefined);
  assert.equal(unchanged, true);
});

await test("a rename follows the account through its organization", async () => {
  const { account } = await acc.createAccount({ username: "owner", password: PW });
  const org = await createOrg({ ownerUsername: "owner", name: "Group" });
  account.orgId = org.id;
  await (await import("./_store.js")).setJSON(`acct:owner`, account);

  await acc.renameAccount("owner", PW, "boss");
  const after = await getJSON(`org:${org.id}`);
  assert.equal(after.ownerUsername, "boss", "the organization must follow the owner");
  assert.ok(after.members.boss, "membership is keyed by name and must move");
  assert.equal(after.members.owner, undefined, "the old membership row must not linger");
  assert.equal(after.members.boss.role, "owner", "the role must survive the move");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
