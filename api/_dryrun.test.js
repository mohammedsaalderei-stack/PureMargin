/* A check that writes nothing must write nothing.

   Three routes in `stock.js` — a scanned invoice, a batch of receipts, a batch
   of consumption — check every line with a dry run before writing any of
   them, so one bad line refuses the set instead of leaving half of it on the
   shelf. The dry run was passed inside the movement, where `recordMovement`
   never looks; it reads it from its options. So every check was a real write,
   all of them at once against one ledger key. They overwrote each other and,
   usually, one survived: each delivery saved left an extra copy of one of its
   lines in stock. The consume route did the same with consumption.

   Found because a sample delivery of 19 lines left 20 entries and two
   kilograms of salt where one had arrived. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}

delete process.env.POS_ACCESS_TOKEN;
delete process.env.LOYVERSE_ACCESS_TOKEN;

const { createAccount, getAccount } = await import("./_accounts.js");
const { issueToken } = await import("./_auth.js");
const { orgFor } = await import("./_org.js");
const inv = await import("./_inventory.js");
const mv = await import("./_movements.js");
const stock = (await import("./stock.js")).default;

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
  const r = {
    code: null, body: null, headers: {},
    setHeader(k, v) { r.headers[k] = v; return r; },
    status(c) { r.code = c; return r; },
    json(b) { r.body = b; return r; },
  };
  return r;
}

const NAMES = ["Salt", "Sumac", "Cumin", "Garlic"];

async function kitchen() {
  await createAccount({ username: "owner1", password: "Dry-run-9x!" });
  const account = await getAccount("owner1");
  const org = await orgFor(account);
  for (const name of NAMES) await inv.saveIngredient(org.id, { name, stockUnit: "kg" });
  const token = issueToken("owner1", account.tokenVersion || 0);
  const post = async (what, body) => {
    const res = fakeRes();
    await stock({ method: "POST", headers: { authorization: `Bearer ${token}` }, query: { what }, body: { branchId: "register", ...body } }, res);
    assert.equal(res.code, 200, `${what}: ${JSON.stringify(res.body)}`);
    return res;
  };
  const ledger = () => mv.listMovements(org.id, "register", {});
  return { post, ledger };
}

await test("a saved delivery writes one entry per line, and no more", async () => {
  const { post, ledger } = await kitchen();
  await post("invoice", {
    invoiceNo: "INV-1",
    lines: NAMES.map((name) => ({ ingredientId: name.toLowerCase(), qty: 1, unit: "kg", unitCost: 2 })),
  });
  const entries = await ledger();
  assert.equal(entries.length, NAMES.length);
  for (const name of NAMES) {
    assert.equal(entries.filter((m) => m.ingredientId === name.toLowerCase()).length, 1, `${name} once`);
  }
});

await test("a batch of receipts writes one entry per line, and no more", async () => {
  const { post, ledger } = await kitchen();
  await post("receive-batch", { movements: NAMES.map((name) => ({ ingredientId: name.toLowerCase(), qty: 2, unit: "kg" })) });
  assert.equal((await ledger()).length, NAMES.length);
});

await test("a batch of consumption takes out exactly what it says", async () => {
  const { post, ledger } = await kitchen();
  await post("receive-batch", { movements: NAMES.map((name) => ({ ingredientId: name.toLowerCase(), qty: 2, unit: "kg" })) });
  await post("consume", { movements: NAMES.map((name) => ({ ingredientId: name.toLowerCase(), qty: 0.5, unit: "kg" })) });
  const entries = await ledger();
  assert.equal(entries.filter((m) => m.type === "consume").length, NAMES.length);
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
