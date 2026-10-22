/* The store, against the real Postgres it now prefers.

   `_store.js` has had three backends and a memory fallback for a long time,
   and only the fallback was ever exercised by the suite — every other test
   file runs on memory by design, because they write fixture accounts and a
   real store would put them in live records.

   That was survivable while Redis held everything and a bug would have shown
   up as the app not working at all. It is not survivable now: this is where
   accounts, organizations, the item master, every stock ledger, every recipe
   and every purchase order live, and the failure this is guarding against is
   not "does not work" but "works, and is wrong by a little".

   Opt-in, like `_mirror.test.js`: it loads the local env itself, because
   `scripts/test.mjs` deletes DATABASE_URL from the child environment. It
   writes only under `selftest:` and removes what it wrote. */

import { loadLocalEnv } from "./_env.js";

loadLocalEnv();

import assert from "node:assert/strict";

const { configured } = await import("./_db.js");
if (!configured) {
  console.log("  skip  store/postgres — no DATABASE_URL set");
  process.exit(0);
}

const { getJSON, setJSON, del, listKeys, backend } = await import("./_store.js");
const { close } = await import("./_db.js");

if (backend !== "pg") {
  console.error(`Refusing to run: backend is "${backend}", expected "pg".`);
  process.exit(1);
}

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

const P = `selftest:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
const written = [];
const key = (k) => { const full = `${P}:${k}`; written.push(full); return full; };

try {
  await test("a missing key is null, not an error", async () => {
    assert.equal(await getJSON(key("absent")), null);
  });

  await test("a document survives the round trip unchanged", async () => {
    /* Nested objects, arrays, numbers that are not integers, booleans, null,
       an empty string and a unicode name — an account record and a movement
       between them use every one of these. */
    const doc = {
      username: "chef", tokenVersion: 3, active: true, deletedAt: null,
      name: "مطعم السفرة", note: "", ratio: 0.0228,
      branches: ["b1", "b2"], meta: { deep: { deeper: [1, 2, { three: 3 }] } },
    };
    const k = key("doc");
    await setJSON(k, doc);
    assert.deepEqual(await getJSON(k), doc);
  });

  await test("writing twice replaces rather than duplicating", async () => {
    const k = key("twice");
    await setJSON(k, { v: 1 });
    await setJSON(k, { v: 2 });
    /* The primary key makes this structural, but the upsert is the half that
       could be written wrong — an INSERT without ON CONFLICT would throw on
       the second save of any account that ever changes. */
    assert.deepEqual(await getJSON(k), { v: 2 });
  });

  await test("an array at the top level is still an array", async () => {
    /* Every ledger is one: `inv:<org>:moves:<branch>` is a bare array, and a
       store that handed it back as an object would break every balance in
       the app without failing anything. */
    const k = key("ledger");
    const ledger = [{ id: "m1", qtyBase: 5000 }, { id: "m2", qtyBase: -150 }];
    await setJSON(k, ledger);
    const back = await getJSON(k);
    assert.ok(Array.isArray(back), "came back as an array");
    assert.deepEqual(back, ledger);
  });

  await test("a large value is stored whole", async () => {
    /* Attendance photos are data URIs in the store. The old Redis had a 30MB
       database limit for everything; this checks the new home does not
       quietly truncate a single one. */
    const k = key("photo");
    const big = "data:image/jpeg;base64," + "A".repeat(400_000);
    await setJSON(k, { shot: big });
    assert.equal((await getJSON(k)).shot.length, big.length);
  });

  await test("listKeys returns everything under the prefix and nothing else", async () => {
    await setJSON(key("list:a"), 1);
    await setJSON(key("list:b"), 2);
    await setJSON(key("other"), 3);
    const found = await listKeys(`${P}:list:`);
    assert.deepEqual(found.sort(), [`${P}:list:a`, `${P}:list:b`]);
  });

  await test("a prefix containing a LIKE wildcard matches only itself", async () => {
    /* `_` and `%` are wildcards in LIKE. Unescaped, a prefix carrying one
       matches keys it does not name — which on the admin screen means
       listing somebody else's records. */
    const under = key("wild_one");
    const decoy = key("wildXone");
    await setJSON(under, "mine");
    await setJSON(decoy, "not mine");
    assert.deepEqual(await listKeys(under), [under]);

    const pct = key("100%");
    await setJSON(pct, "mine");
    assert.deepEqual(await listKeys(pct), [pct]);
  });

  await test("listKeys on a prefix with nothing under it is empty, not everything", async () => {
    assert.deepEqual(await listKeys(`${P}:nothing-here:`), []);
  });

  await test("delete removes it, and deleting again is not an error", async () => {
    const k = key("gone");
    await setJSON(k, { v: 1 });
    await del(k);
    assert.equal(await getJSON(k), null);
    await del(k);
  });
} finally {
  /* Named individually rather than by prefix, so a bug in listKeys cannot
     turn cleanup into a wider delete than intended. */
  for (const k of new Set(written)) {
    try { await del(k); } catch { /* best effort */ }
  }
  await close();
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
