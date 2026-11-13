/* The quiet catch-up of stock after sales are read (`depletion.js`).

   What this protects: it names each store by its id, asks once per store,
   asks nothing at all when it has no store to name — it used to ask for
   "no store", which can only be refused, on the first load of every visit —
   and a failure never reaches the screen that called it. */

import assert from "node:assert/strict";
import { depleteFromSales } from "./depletion.js";

let failures = 0;
const sent = [];
let fail = false;
globalThis.fetch = async (url, init) => {
  sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
  if (fail) throw new TypeError("Failed to fetch");
  return { ok: true, status: 200, json: async () => ({}) };
};
async function test(name, fn) {
  sent.length = 0;
  fail = false;
  try {
    await fn();
    console.log("  ok  ", name);
  } catch (err) {
    failures += 1;
    console.error("  FAIL", name, "\n       ", err.message);
  }
}

await test("each store is named by its id, whether it arrives as a record or an id", async () => {
  const asked = await depleteFromSales("tok", [{ id: "register", name: "Main" }, "s-marina"]);
  assert.equal(asked, 2);
  assert.deepEqual(sent.map((s) => s.body.branchId), ["register", "s-marina"]);
  assert.ok(sent.every((s) => s.url === "/api/stock?what=deplete-sales" && s.auth === "Bearer tok"));
});

await test("with no store to name, nothing is asked", async () => {
  for (const none of [undefined, null, [], [null], [{}], [""]]) {
    assert.equal(await depleteFromSales("tok", none), 0);
  }
  assert.equal(sent.length, 0, "not one request for 'no store in particular'");
});

await test("no connection is not the caller's problem, and the other stores are still tried", async () => {
  fail = true;
  assert.equal(await depleteFromSales("tok", ["register", "s-marina"]), 2);
  assert.equal(sent.length, 2);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
