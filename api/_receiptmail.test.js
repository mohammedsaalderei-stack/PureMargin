/* Emailed receipts (`_receiptmail.js`, `POST /api/till?what=email`).

   What this protects: the shop's name heads the receipt and its tax number
   makes it a tax invoice; the store's own details win over the business's;
   nothing on a receipt can become markup in somebody's inbox; Arabic reads
   right to left; and a receipt cannot be used to send a flood of mail. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}
delete process.env.RESEND_API_KEY;

const { receiptMail, allowSend, validEmail, PER_RECEIPT } = await import("./_receiptmail.js");
const { buildSale } = await import("../shared/tillprice.js");

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

const CAT = [{ id: "fries", kind: "recipe", name: "Fries <b>hot</b>", price: 9, addons: [], variants: [{ id: "v-large", name: "Large", price: 12, scale: 1.5 }] }];
const receipt = buildSale(
  { orderType: "takeaway", lines: [{ itemId: "fries", qty: 2, variantId: "v-large" }], payments: [{ type: "cash", received: 30 }] },
  { catalogue: CAT, vatPct: 5, paymentTypes: [{ id: "cash", name: "Cash", kind: "cash" }], number: "PM-261109-101500-ABC", branchId: "s-marina" },
).receipt;

await test("the shop's name heads it, and a TRN makes it a tax invoice", async () => {
  const plain = receiptMail(receipt, { business: "Olive House" });
  assert.match(plain.subject, /Olive House/);
  assert.match(plain.html, />Olive House</);
  assert.match(plain.html, />Receipt</);
  const taxed = receiptMail(receipt, { business: "Olive House", receiptSettings: { trn: "100200300400005" } });
  assert.match(taxed.html, />Tax invoice</);
  assert.match(taxed.html, /100200300400005/);
});

await test("a store's own address and TRN replace the business's", async () => {
  const out = receiptMail(receipt, { business: "Olive House", store: { address: "Marina Walk", trn: "999" }, receiptSettings: { address: "Downtown", trn: "111" } });
  assert.match(out.html, /Marina Walk/);
  assert.match(out.html, /999/);
  assert.doesNotMatch(out.html, /Downtown/);
});

await test("lines carry their variant, and totals are the receipt's own", async () => {
  const out = receiptMail(receipt, { business: "Olive House" });
  assert.match(out.text, /2 x Fries <b>hot<\/b> · Large/);
  assert.match(out.html, /AED 25\.20/);
  assert.match(out.html, /Change/);
});

await test("nothing on a receipt becomes markup", async () => {
  const out = receiptMail(receipt, { business: "<img src=x onerror=alert(1)>" });
  assert.doesNotMatch(out.html, /<img/);
  assert.doesNotMatch(out.html, /<b>hot<\/b>/);
  assert.match(out.html, /&lt;b&gt;hot/);
});

await test("Arabic reads right to left, in Arabic", async () => {
  const out = receiptMail(receipt, { business: "زيتونة", lang: "ar" });
  assert.match(out.html, /<html dir="rtl">/);
  assert.match(out.subject, /إيصالك من زيتونة/);
});

await test("a receipt can be sent a few times, not a flood", async () => {
  for (let i = 0; i < PER_RECEIPT; i += 1) assert.equal((await allowSend("org1", "PM-1")).ok, true);
  assert.equal((await allowSend("org1", "PM-1")).error, "toomany");
  assert.equal((await allowSend("org1", "PM-2")).ok, true, "another receipt is unaffected");
  assert.equal((await allowSend("org2", "PM-1")).ok, true, "another business is unaffected");
});

await test("addresses are checked", async () => {
  assert.equal(validEmail("sara@example.com"), true);
  for (const bad of ["", "sara", "sara@", "@example.com", "sara@example", "a b@example.com"]) assert.equal(validEmail(bad), false, bad);
});

await test("the route refuses a bad address, and says when mail is not set up", async () => {
  const { createAccount, getAccount } = await import("./_accounts.js");
  const { issueToken } = await import("./_auth.js");
  const route = (await import("./till.js")).default;
  await createAccount({ username: "owner1", password: "Till-test-9x!" });
  const token = issueToken("owner1", (await getAccount("owner1")).tokenVersion || 0);
  const ask = async (body) => {
    const r = { code: 0, body: null, setHeader() { return r; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
    await route({ method: "POST", url: "/api/till?what=email", headers: { authorization: `Bearer ${token}` }, query: { what: "email" }, body }, r);
    return r;
  };
  assert.equal((await ask({ number: "PM-1", email: "nope" })).code, 400);
  const off = await ask({ number: "PM-1", email: "sara@example.com" });
  assert.equal(off.code, 503);
  assert.equal(off.body.error, "mailoff");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
