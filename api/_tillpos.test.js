/* The register as a till of its own.

   What these protect: a discount comes off the lines it applies to so item
   reports still add up; VAT included and VAT added both reconcile; a bill
   split across payments has to cover the bill exactly; points cannot be spent
   that were never earned; a refund gives back what was paid and never more
   than was sold; a sale sent twice by a till that was offline is one sale; a
   shift's expected cash is float + cash in − cash out; a PIN names one person
   and locks after repeated guesses; and the route holds every permission the
   screens rely on — a cashier cannot refund, cannot invent a discount, and
   cannot sell without saying who they are once the business uses PINs. */

import assert from "node:assert/strict";
import { backend, __resetMemory } from "./_store.js";

if (backend !== "memory") {
  console.error(`Refusing to run: the store backend is "${backend}", not memory. Run \`npm test\`.`);
  process.exit(1);
}
delete process.env.POS_ACCESS_TOKEN;
delete process.env.LOYVERSE_ACCESS_TOKEN;

const { buildSale, buildRefund, receiptNumber } = await import("../shared/tillprice.js");
const till = await import("./_till.js");
const shifts = await import("./_tillshift.js");
const book = await import("./_tillbook.js");
const staff = await import("./_tillstaff.js");
const setup = await import("./_tillsetup.js");
const { aggregate } = await import("./_aggregate.js");

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
const near = (a, b, tol = 0.005) => assert.ok(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);

const CAT = [
  { id: "wrap", name: "Chicken wrap", price: 18, priced: true, addons: [] },
  { id: "fries", name: "Fries", price: 9, priced: true, addons: [] },
  { id: "tea", name: "Karak", price: 4, priced: true, addons: [] },
];
const TYPES = [
  { id: "cash", name: "Cash", kind: "cash" },
  { id: "card", name: "Card", kind: "card" },
  { id: "talabat", name: "Talabat", kind: "other" },
];
const sale = (over = {}, opts = {}) => buildSale(
  { orderType: "takeaway", lines: [{ itemId: "wrap", qty: 2 }, { itemId: "fries", qty: 1 }], payments: [{ type: "card" }], ...over },
  { catalogue: CAT, vatPct: 5, paymentTypes: TYPES, at: Date.UTC(2026, 10, 8, 10), ...opts },
);

/* ── Pricing ── */

await test("a ticket discount comes off the lines, so the lines still add up to the bill", async () => {
  const r = sale({ discount: { type: "pct", value: 10 } }).receipt;
  near(r.subtotal_money, 45);
  near(r.total_discount, 4.5);
  near(r.line_items.reduce((s, li) => s + li.total_money, 0), 40.5);
  near(r.total_tax, 2.03);
  near(r.total_money, 42.53);
  assert.equal(r.discounts[0].custom, true, "a typed discount is marked as one nobody preset");
});

await test("with VAT included in prices, the total is the menu price and the tax is inside it", async () => {
  const r = sale({}, { vatMode: "inclusive" }).receipt;
  near(r.total_money, 45);
  near(r.total_tax, 2.14);
});

await test("a line discount applies to its own line only", async () => {
  const r = sale({ lines: [{ itemId: "wrap", qty: 2, discount: { type: "amount", value: 6 } }, { itemId: "fries", qty: 1 }] }).receipt;
  near(r.line_items[0].total_money, 30);
  near(r.line_items[1].total_money, 9);
});

await test("a preset discount is applied by id, and carries whether it is managers-only", async () => {
  const presets = [{ id: "staff", name: "Staff", type: "pct", value: 50, restricted: true }];
  const r = sale({ discount: { id: "staff" } }, { discounts: presets }).receipt;
  near(r.total_discount, 22.5);
  assert.equal(r.discounts[0].restricted, true);
  assert.equal(sale({ discount: { id: "nope" } }, { discounts: presets }).error, "discount");
});

await test("a split bill must cover the total exactly, with change only on cash", async () => {
  const total = sale().receipt.total_money; // 47.25
  const r = sale({ payments: [{ type: "card", amount: 20 }, { type: "cash", received: 30 }] }).receipt;
  near(r.payments[1].money_amount, total - 20);
  near(r.payments[1].change, 30 - (total - 20));
  assert.equal(sale({ payments: [{ type: "card", amount: 20 }, { type: "cash", amount: 10 }] }).error, "split");
});

await test("a payment type of the business's own is recorded by its name", async () => {
  const r = sale({ payments: [{ type: "talabat" }] }).receipt;
  assert.equal(r.payments[0].name, "Talabat");
  assert.equal(r.payments[0].type, "OTHER");
  assert.equal(sale({ payments: [{ type: "bitcoin" }] }).error, "payment");
});

await test("points cannot be spent beyond the balance, and are earned on what was paid", async () => {
  assert.equal(sale({ customerId: "C1", redeemPoints: 10 }, { pointsBalance: 5 }).error, "points");
  const r = sale({ customerId: "C1", redeemPoints: 5 }, { pointsBalance: 5, loyaltyPct: 10 }).receipt;
  near(r.points_redeemed, 5);
  /* 45 less 5 of points is 40, and VAT is on what is actually paid for. */
  near(r.total_money, 40 * 1.05);
  near(r.points_earned, Math.floor(r.total_money * 10) / 100);
});

/* ── Refunds ── */

await test("a partial refund gives back what those lines were paid, VAT and discount included", async () => {
  const s = sale({ discount: { type: "pct", value: 10 } }).receipt;
  const r = buildRefund(s, { lines: [{ index: 0, qty: 1 }], paymentTypes: TYPES }).receipt;
  assert.equal(r.receipt_type, "REFUND");
  assert.equal(r.refund_for, s.receipt_number);
  near(r.subtotal_money, 16.2);
  near(r.total_money, 16.2 * 1.05, 0.02);
});

await test("a line cannot be refunded beyond what was sold, counting earlier refunds", async () => {
  const s = sale().receipt;
  assert.equal(buildRefund(s, { lines: [{ index: 0, qty: 3 }] }).error, "over");
  assert.equal(buildRefund(s, { lines: [{ index: 0, qty: 1 }], already: { 0: 2 } }).error, "over");
  assert.equal(buildRefund({ ...s, receipt_type: "REFUND" }, { lines: [{ index: 0, qty: 1 }] }).error, "receipt");
});

await test("a refund recorded is remembered against the sale it refunds", async () => {
  const s = sale().receipt;
  await till.recordSale("org1", s);
  const r = buildRefund(s, { lines: [{ index: 0, qty: 2 }] }).receipt;
  await till.recordSale("org1", r);
  const so = await till.refundedSoFar("org1", s.receipt_number);
  assert.deepEqual(so.lines, { 0: 2 });
  assert.equal((await till.findReceipt("org1", s.receipt_number)).total_money, s.total_money, "the sale itself is untouched");
});

/* ── Offline ── */

await test("a sale sent twice by a till that was offline is recorded once", async () => {
  const s = sale({}, { clientId: "abc-1" }).receipt;
  await till.recordSale("org1", s);
  const again = await till.recordSale("org1", { ...sale({}, { clientId: "abc-1" }).receipt, id: "PM-261108-100000-ZZZ", receipt_number: "PM-261108-100000-ZZZ" });
  assert.equal(again.duplicate, true);
  assert.equal(again.receipt_number, s.receipt_number);
  assert.equal((await till.registerReceipts("org1", { since: Date.UTC(2026, 10, 1), now: Date.UTC(2026, 10, 30) })).length, 1);
});

await test("an offline receipt number is kept when it is the sale's own day and unused", async () => {
  const at = Date.UTC(2026, 10, 8, 10);
  const n = receiptNumber(at);
  assert.equal(await till.acceptNumber("org1", n, at), n);
  assert.equal(await till.acceptNumber("org1", n, at + 3 * 864e5), null, "a number from another day is not accepted");
  await till.recordSale("org1", { ...sale().receipt, id: n, receipt_number: n });
  assert.equal(await till.acceptNumber("org1", n, at), null, "a number already used is not accepted");
});

/* ── Shifts ── */

await test("a shift's expected cash is the float plus cash taken, less refunds and pay-outs", async () => {
  const { shift } = await shifts.openShift("org1", "register", { float: 200 });
  assert.equal((await shifts.openShift("org1", "register", { float: 0 })).error, "open");
  await shifts.cashMove("org1", "register", { type: "out", amount: 30, note: "Ice" });
  await shifts.cashMove("org1", "register", { type: "in", amount: 50, note: "Change" });
  assert.equal((await shifts.cashMove("org1", "register", { type: "out", amount: 5, note: "" })).error, "note");
  const cashSale = sale({ payments: [{ type: "cash", received: 50 }] }, { shiftId: shift.id }).receipt;
  const cardSale = sale({}, { shiftId: shift.id }).receipt;
  const refund = buildRefund(cashSale, { lines: [{ index: 1, qty: 1 }], shiftId: shift.id, paymentType: "cash", paymentTypes: TYPES }).receipt;
  const current = await shifts.currentShift("org1", "register");
  const sum = shifts.summarise(current, [cashSale, cardSale, refund]);
  near(sum.cash.expected, 200 + 47.25 - 9.45 + 50 - 30);
  const out = await shifts.closeShift("org1", "register", { counted: 257, receipts: [cashSale, cardSale, refund] });
  near(out.shift.difference, 257 - sum.cash.expected);
  assert.equal(await shifts.currentShift("org1", "register"), null, "closing frees the drawer for the next shift");
});

/* ── Tickets and customers ── */

await test("an open ticket keeps what was ordered and what the kitchen has had", async () => {
  const { ticket } = await book.saveTicket("org1", { name: "Window 2", lines: [{ key: "l1", itemId: "wrap", qty: 2 }], printed: { l1: 2 } }, { branchId: "register" });
  const again = await book.saveTicket("org1", { id: ticket.id, lines: [{ key: "l1", itemId: "wrap", qty: 3 }], printed: { l1: 2 } }, { branchId: "register" });
  assert.equal(again.ticket.createdAt, ticket.createdAt);
  assert.equal(again.ticket.lines[0].qty, 3);
  assert.deepEqual(again.ticket.printed, { l1: 2 });
  assert.equal((await book.listTickets("org1", ["register"])).length, 1);
  assert.equal((await book.listTickets("org1", ["other"])).length, 0, "another branch's tickets are not listed");
  assert.equal((await book.saveTicket("org1", { lines: [] })).error, "lines");
});

await test("one phone number is one customer, and points are earned less spent", async () => {
  const { customer } = await book.saveCustomer("org1", { name: "Mariam", phone: "+971 50 111 2222" });
  assert.equal(customer.phone, "+971501112222");
  assert.equal((await book.saveCustomer("org1", { name: "Other", phone: "+971501112222" })).error, "phone");
  const stats = book.customerStats(customer.id, [
    { customer_id: customer.id, receipt_type: "SALE", total_money: 100, points_earned: 5, points_redeemed: 0, receipt_date: "2026-11-01T10:00:00Z" },
    { customer_id: customer.id, receipt_type: "SALE", total_money: 50, points_earned: 2, points_redeemed: 4, receipt_date: "2026-11-02T10:00:00Z" },
    { customer_id: customer.id, receipt_type: "REFUND", total_money: 20, points_earned: -1, points_redeemed: 0, receipt_date: "2026-11-03T10:00:00Z" },
  ]);
  assert.equal(stats.visits, 2);
  near(stats.spent, 130);
  near(stats.points, 2);
});

/* ── PINs ── */

await test("a PIN names one person, and two people cannot share one", async () => {
  await staff.setPin("org1", { employeeId: "e1", name: "Sara", pin: "1234", role: "cashier" });
  assert.equal((await staff.setPin("org1", { employeeId: "e2", name: "Omar", pin: "1234", role: "manager" })).error, "taken");
  assert.equal((await staff.setPin("org1", { employeeId: "e2", name: "Omar", pin: "12a4", role: "manager" })).error, "pin");
  const out = await staff.checkPin("org1", "1234");
  assert.equal(out.operator.name, "Sara");
  assert.deepEqual(staff.readOperator(out.token, "org1"), { employeeId: "e1", name: "Sara", role: "cashier" });
  assert.equal(staff.readOperator(out.token, "org2"), null, "a token is for one business only");
  assert.equal(staff.readOperator(`${out.token.split(".")[0]}x.${out.token.split(".")[1]}`, "org1"), null, "a tampered token is refused");
});

await test("repeated wrong PINs lock the register for a while", async () => {
  await staff.setPin("org1", { employeeId: "e1", name: "Sara", pin: "1234", role: "cashier" });
  for (let i = 0; i < 8; i += 1) await staff.checkPin("org1", "9999");
  assert.equal((await staff.checkPin("org1", "1234")).error, "locked");
});

/* ── Setup ── */

await test("payment types and products are read before they are saved", async () => {
  assert.equal(setup.readPaymentTypes([]).error, "paymentTypes");
  assert.equal(setup.readPaymentTypes([{ name: "Talabat", kind: "bank" }]).error, "kind");
  const ok = setup.readPaymentTypes([{ name: "Cash", kind: "cash" }, { name: "Cash", kind: "cash" }]);
  assert.deepEqual(ok.paymentTypes.map((p) => p.id), ["cash", "cash-2"]);
  const p = await setup.saveProduct("org1", { name: "Water", price: 2, barcode: "6291001" });
  assert.equal(p.id, "p-water");
  assert.equal((await setup.saveProduct("org1", { name: "Soda", price: 3, barcode: "6291001" })).error, "barcode");
  const cat = till.catalogueOf([], await till.getSettings("org1"));
  assert.equal(cat[0].kind, "product");
});

/* ── The dashboard ── */

await test("discounts given at the register reach the dashboard's discount total", async () => {
  const now = Date.now();
  const r = sale({ discount: { type: "amount", value: 5 } }, { at: now - 3600e3 }).receipt;
  const out = aggregate({ now, receipts: [r], catalogue: new Map(), storeNames: {}, allBranches: ["register"] }, {});
  assert.equal(out.extras?.discounts ?? out.totals?.discounts, 5);
});

/* ── Through the route ── */

const { createAccount, getAccount } = await import("./_accounts.js");
const { issueToken } = await import("./_auth.js");
const { orgFor } = await import("./_org.js");
const { addEmployee } = await import("./_employees.js");
const route = (await import("./till.js")).default;
const { saveRecipeForTest } = await (async () => {
  const rc = await import("./_recipes.js");
  return { saveRecipeForTest: (orgId) => rc.saveVersion(orgId, { menuItem: "Chicken wrap", sellPrice: 18, lines: [{ name: "Chicken", qty: 150, unit: "g" }] }) };
})();

function fakeRes() {
  const r = { code: null, body: null, headers: {}, setHeader(k, v) { r.headers[k] = v; return r; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
  return r;
}
async function shop() {
  await createAccount({ username: "owner1", password: "Till-test-9x!" });
  const account = await getAccount("owner1");
  const org = await orgFor(account);
  await saveRecipeForTest(org.id);
  const token = issueToken("owner1", account.tokenVersion || 0);
  const ask = async (method, what, body, headers = {}, query = {}) => {
    const res = fakeRes();
    await route({ method, headers: { authorization: `Bearer ${token}`, ...headers }, query: { what, ...query }, body }, res);
    return res;
  };
  return { org, ask };
}
const order = { branchId: "register", orderType: "takeaway", lines: [{ itemId: "chicken-wrap", qty: 1 }], payments: [{ type: "card" }] };

await test("no sale before a shift is open, when the business counts its drawer", async () => {
  const { ask } = await shop();
  assert.equal((await ask("POST", "sale", order)).code, 409);
  assert.equal((await ask("POST", "shift-open", { branchId: "register", float: 100 })).code, 201);
  assert.equal((await ask("POST", "sale", order)).code, 201);
});

await test("once anyone has a PIN, nobody sells without one, and a cashier cannot refund or invent a discount", async () => {
  const { org, ask } = await shop();
  await ask("POST", "shift-open", { branchId: "register", float: 0 });
  const sara = await addEmployee(org.id, { name: "Sara", title: "Cashier", branchId: "register" });
  const id = sara.employee?.id || sara.id;
  assert.equal((await ask("PUT", "pins", { employeeId: id, pin: "1234", role: "cashier" })).code, 200);

  assert.equal((await ask("POST", "sale", order)).body.error, "operator");
  const pin = await ask("POST", "pin", { pin: "1234" });
  const as = { "x-register-operator": pin.body.token };

  const sold = await ask("POST", "sale", order, as);
  assert.equal(sold.code, 201);
  assert.equal(sold.body.receipt.cashier, "Sara");
  assert.equal((await ask("POST", "sale", { ...order, discount: { type: "pct", value: 50 } }, as)).code, 403);
  assert.equal((await ask("POST", "refund", { number: sold.body.receipt.receipt_number, lines: [{ index: 0, qty: 1 }], reason: "x" }, as)).code, 403);
});

await test("a manager's PIN can refund, and the refund is a receipt of its own", async () => {
  const { org, ask } = await shop();
  await ask("POST", "shift-open", { branchId: "register", float: 0 });
  const omar = await addEmployee(org.id, { name: "Omar", title: "Manager", branchId: "register" });
  await ask("PUT", "pins", { employeeId: omar.employee?.id || omar.id, pin: "5678", role: "manager" });
  const as = { "x-register-operator": (await ask("POST", "pin", { pin: "5678" })).body.token };
  const sold = await ask("POST", "sale", order, as);
  const refund = await ask("POST", "refund", { number: sold.body.receipt.receipt_number, lines: [{ index: 0, qty: 1 }], reason: "cold" }, as);
  assert.equal(refund.code, 201);
  assert.equal(refund.body.receipt.receipt_type, "REFUND");
  const again = await ask("POST", "refund", { number: sold.body.receipt.receipt_number, lines: [{ index: 0, qty: 1 }], reason: "cold" }, as);
  assert.equal(again.body.error, "over");
});

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
