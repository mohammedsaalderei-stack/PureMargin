/* The one public index, and what it will and will not hand out.

   This is the only read in the codebase that takes no session, so the tests
   that matter are not about finding a restaurant — they are about the shapes
   of query that must come back empty. A single letter must not enumerate the
   customer list, and a business that has switched attendance off must
   disappear from it. */

import assert from "node:assert/strict";
import {
  publishStore, unpublishStore, getStore, readDirectory, searchStores, MIN_QUERY,
} from "./_directory.js";

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

const dir = (rows) => Object.fromEntries(rows.map((r, i) => [r.id || `o${i}`, r]));

await test("a published business is findable and carries its branches", async () => {
  await publishStore("org-1", {
    name: "Al Manara Grill",
    branches: [{ id: "b1", name: "Jumeirah" }, { id: "b2", name: "Marina" }],
  });

  const found = await getStore("org-1");
  assert.equal(found.name, "Al Manara Grill");
  assert.equal(found.branches.length, 2);
  assert.equal(found.branches[1].name, "Marina");

  const hits = searchStores(await readDirectory(), "manara");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "org-1");
});

await test("a query shorter than two characters finds nothing at all", () => {
  const d = dir([{ id: "a", name: "Anar" }, { id: "b", name: "Amber" }]);
  assert.equal(MIN_QUERY, 2);
  assert.deepEqual(searchStores(d, "a"), []);
  assert.deepEqual(searchStores(d, ""), []);
  assert.deepEqual(searchStores(d, "   "), []);
  /* And two characters do work, so the emptiness above is the length rule and
     not a broken search. */
  assert.equal(searchStores(d, "an").length, 1);
});

await test("the closest name comes first", () => {
  const d = dir([
    { id: "x", name: "Bab Al Bahr" },
    { id: "y", name: "Al Manara" },
    { id: "z", name: "Al" },
  ]);
  const order = searchStores(d, "al").map((r) => r.id);
  /* Exact, then starts-with, then found somewhere inside. Somebody standing in
     a doorway should not have to scroll past two other restaurants. */
  assert.deepEqual(order, ["z", "y", "x"]);
});

await test("every word typed has to appear", () => {
  const d = dir([{ id: "a", name: "Manara Grill" }, { id: "b", name: "Manara Laundry" }]);
  assert.deepEqual(searchStores(d, "manara grill").map((r) => r.id), ["a"]);
  assert.deepEqual(searchStores(d, "manara bakery"), []);
});

await test("Arabic spelt either way finds the same restaurant", () => {
  const d = dir([{ id: "a", name: "مطعم الأصالة" }]);
  /* The owner registered with a hamza on the alef and the cook's keyboard does
     not produce one. `_text.js` folds both; this is the reason it exists. */
  assert.equal(searchStores(d, "الأصالة").length, 1);
  assert.equal(searchStores(d, "الاصاله").length, 1);
  assert.equal(searchStores(d, "الاصالة").length, 1);
});

await test("only so many come back, however common the word", () => {
  const many = dir(Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, name: `Cafe ${i}` })));
  assert.equal(searchStores(many, "cafe").length, 8);
});

await test("a business with no name is not a row of nothing", () => {
  const d = dir([{ id: "a", name: "" }, { id: "b", name: "Cafe" }]);
  assert.deepEqual(searchStores(d, "ca").map((r) => r.id), ["b"]);
});

await test("switching it off takes the business out of the search", async () => {
  await publishStore("org-2", { name: "Nakheel Kitchen", branches: [{ id: "b9", name: "Deira" }] });
  assert.equal(searchStores(await readDirectory(), "nakheel").length, 1);

  await unpublishStore("org-2");
  assert.equal(searchStores(await readDirectory(), "nakheel").length, 0);
  assert.equal(await getStore("org-2"), null, "and it cannot be opened by id either");
});

await test("republishing the same thing writes nothing", async () => {
  const same = { name: "Zaytoun", branches: [{ id: "b1", name: "Main" }] };

  /* The clock is supplied, because the staff screen republishes on every read
     and two publishes in the same millisecond are indistinguishable by a
     timestamp either of them could have produced. */
  await publishStore("org-3", { ...same, at: 1 });
  await publishStore("org-3", { ...same, at: 2 });
  assert.equal((await getStore("org-3")).at, 1, "unchanged means untouched");

  /* A branch renamed in the till does count as a change, and is picked up by
     the ordinary act of somebody opening the staff screen. */
  await publishStore("org-3", { name: "Zaytoun", branches: [{ id: "b1", name: "Karama" }], at: 3 });
  const after = await getStore("org-3");
  assert.equal(after.branches[0].name, "Karama");
  assert.equal(after.at, 3, "and it was written afresh");
});

await test("a branch with no id is dropped rather than published as null", async () => {
  await publishStore("org-4", {
    name: "Souk Cafe",
    branches: [{ id: "", name: "Ghost" }, { id: "b1", name: "Real" }],
  });
  const branches = (await getStore("org-4")).branches;
  assert.equal(branches.length, 1);
  assert.equal(branches[0].id, "b1");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
