/* The business's own stores (`_stores.js`).

   They replace the branches a connected till used to report, so the things
   that matter are the ones the rest of the app leans on: the first store
   keeps the id early receipts were filed under, ids never change once given,
   archiving keeps the record, and a business can never end up with no open
   store at all. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

const st = await import("./_stores.js");

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

await test("a business starts with one store, under the id its first sales used", async () => {
  const list = await st.listStores("org1", { orgName: "Olive House" });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, st.FIRST_STORE_ID);
  assert.equal(list[0].id, "register");
  assert.equal(list[0].name, "Olive House");
});

await test("a new store gets an id of its own and a second one with the same name does not collide", async () => {
  const a = await st.saveStore("org1", { name: "Marina" });
  const b = await st.saveStore("org1", { name: "Marina" });
  assert.equal(a.store.id, "s-marina");
  assert.equal(b.store.id, "s-marina-2");
  assert.equal((await st.listStores("org1")).length, 3);
});

await test("renaming keeps the id, because receipts and stock point at it", async () => {
  const a = await st.saveStore("org1", { name: "Marina" });
  const b = await st.saveStore("org1", { id: a.store.id, name: "Dubai Marina", trn: "100 2003 0040 0005" });
  assert.equal(b.created, false);
  assert.equal(b.store.id, a.store.id);
  assert.equal(b.store.trn, "100200300400005");
});

await test("a store with no name, or an id that does not exist, is refused", async () => {
  assert.equal((await st.saveStore("org1", { name: "  " })).error, "name");
  assert.equal((await st.saveStore("org1", { id: "s-nowhere", name: "X" })).error, "notfound");
});

await test("archiving keeps the store, and its name stays readable for old reports", async () => {
  const a = await st.saveStore("org1", { name: "Marina" });
  assert.equal((await st.archiveStore("org1", a.store.id)).archived, true);
  assert.deepEqual((await st.listStores("org1")).map((s) => s.id), ["register"]);
  assert.equal((await st.listStores("org1", { includeArchived: true })).length, 2);
  assert.equal((await st.storeNames("org1"))[a.store.id], "Marina");
});

await test("the last open store cannot be archived", async () => {
  assert.equal((await st.archiveStore("org1", "register")).error, "last");
  const a = await st.saveStore("org1", { name: "Marina" });
  assert.equal((await st.archiveStore("org1", "register")).archived, true);
  assert.equal((await st.archiveStore("org1", a.store.id)).error, "last");
});

await test("one business's stores are not another's", async () => {
  await st.saveStore("org1", { name: "Marina" });
  assert.deepEqual((await st.listStores("org2")).map((s) => s.id), ["register"]);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
