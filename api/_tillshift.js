/* Shifts: the cash in the drawer, from opening to counting it.

   A shift is what makes the cash on a register accountable. It opens with the
   float somebody put in the drawer, collects every cash sale, refund and
   pay-in or pay-out while it is open, and closes with the cash somebody
   actually counted. The difference between what should be there and what is
   is the one number a manager reads at the end of the night.

   One open shift per branch. Two would make "the drawer" mean two drawers and
   neither total would be the cash anybody can count.

   Everything about a shift's money is derived when it is read — from the
   receipts that carry its id and the cash moves recorded on it — and nothing
   is kept as a running total that a lost write could leave wrong. The closed
   record does keep its summary, because a closed shift's figures are what the
   manager signed off and must not move if a receipt is later corrected. */

import { getJSON, setJSON, del, listJSON } from "./_store.js";
import { monthOf } from "./_till.js";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const text = (v, max) => String(v ?? "").trim().slice(0, max);
const MAX_MONEY = 1_000_000;

const openKey = (orgId, branchId) => `register:${orgId}:shift:open:${branchId}`;
const closedPrefix = (orgId, month) => `register:${orgId}:shift:${month}:`;

const shiftId = (at) => `S-${new Date(at).toISOString().replace(/\D/g, "").slice(2, 14)}-${Math.floor(Math.random() * 36 ** 3).toString(36).toUpperCase().padStart(3, "0")}`;

const readMoney = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= MAX_MONEY ? round2(n) : null;
};

export async function currentShift(orgId, branchId) {
  if (!orgId || !branchId) return null;
  return getJSON(openKey(orgId, branchId));
}

export async function openShift(orgId, branchId, { float, by = "", employeeId = "", at = Date.now() } = {}) {
  if (await currentShift(orgId, branchId)) return { error: "open" };
  const amount = readMoney(float ?? 0);
  if (amount === null) return { error: "float" };
  const shift = {
    id: shiftId(at),
    branchId: String(branchId),
    openedAt: at,
    openedBy: text(by, 60),
    openedByEmployee: text(employeeId, 60) || null,
    float: amount,
    moves: [],
  };
  await setJSON(openKey(orgId, branchId), shift);
  return { shift };
}

/* Cash put into the drawer or taken out of it without a sale — change from
   the bank, a supplier paid at the door. Each needs a reason, because an
   unexplained pay-out is exactly what a shift report exists to catch. */
export async function cashMove(orgId, branchId, { type, amount, note, by = "", at = Date.now() } = {}) {
  const shift = await currentShift(orgId, branchId);
  if (!shift) return { error: "noshift" };
  if (!["in", "out"].includes(type)) return { error: "type" };
  const money = readMoney(amount);
  if (!money) return { error: "amount" };
  const reason = text(note, 120);
  if (!reason) return { error: "note" };
  const next = { ...shift, moves: [...(shift.moves || []), { type, amount: money, note: reason, by: text(by, 60), at }] };
  await setJSON(openKey(orgId, branchId), next);
  return { shift: next };
}

/* What a shift took, worked out from its receipts.

   Expected cash is the float, plus cash taken, less cash refunded, plus
   pay-ins, less pay-outs. Change given is already netted: a cash payment's
   `money_amount` is what the sale cost, not what was handed over. */
export function summarise(shift, receipts) {
  const mine = (receipts || []).filter((r) => r.shift_id === shift.id);
  const sales = mine.filter((r) => r.receipt_type === "SALE");
  const refunds = mine.filter((r) => r.receipt_type === "REFUND");
  const byType = {};
  const add = (p, sign) => {
    const key = p.payment_type_id || p.name || p.type;
    const row = byType[key] || { id: key, name: p.name || key, kind: p.type, amount: 0 };
    row.amount = round2(row.amount + sign * Number(p.money_amount || 0));
    byType[key] = row;
  };
  for (const r of sales) for (const p of r.payments || []) add(p, 1);
  for (const r of refunds) for (const p of r.payments || []) add(p, -1);

  const cash = (list) => list.reduce((sum, r) => sum + (r.payments || [])
    .filter((p) => p.type === "CASH").reduce((s, p) => s + Number(p.money_amount || 0), 0), 0);
  const payIns = (shift.moves || []).filter((m) => m.type === "in").reduce((s, m) => s + m.amount, 0);
  const payOuts = (shift.moves || []).filter((m) => m.type === "out").reduce((s, m) => s + m.amount, 0);

  const gross = sales.reduce((s, r) => s + Number(r.subtotal_money || 0), 0);
  const discounts = sales.reduce((s, r) => s + Number(r.total_discount || 0), 0);
  const refunded = refunds.reduce((s, r) => s + Number(r.total_money || 0), 0);
  const taken = sales.reduce((s, r) => s + Number(r.total_money || 0), 0);
  const tax = sales.reduce((s, r) => s + Number(r.total_tax || 0), 0)
    - refunds.reduce((s, r) => s + Number(r.total_tax || 0), 0);

  return {
    receipts: sales.length,
    refunds: refunds.length,
    grossSales: round2(gross),
    discounts: round2(discounts),
    refunded: round2(refunded),
    netSales: round2(taken - refunded),
    tax: round2(tax),
    payments: Object.values(byType).sort((a, b) => b.amount - a.amount),
    cash: {
      float: shift.float,
      sales: round2(cash(sales)),
      refunds: round2(cash(refunds)),
      payIns: round2(payIns),
      payOuts: round2(payOuts),
      expected: round2(shift.float + cash(sales) - cash(refunds) + payIns - payOuts),
    },
  };
}

export async function closeShift(orgId, branchId, { counted, note = "", by = "", receipts = [], at = Date.now() } = {}) {
  const shift = await currentShift(orgId, branchId);
  if (!shift) return { error: "noshift" };
  const actual = readMoney(counted);
  if (actual === null) return { error: "counted" };
  const summary = summarise(shift, receipts);
  const closed = {
    ...shift,
    closedAt: at,
    closedBy: text(by, 60),
    note: text(note, 200) || null,
    summary,
    counted: actual,
    difference: round2(actual - summary.cash.expected),
  };
  await setJSON(`${closedPrefix(orgId, monthOf(shift.openedAt))}${shift.id}`, closed);
  await del(openKey(orgId, branchId));
  return { shift: closed };
}

/* Closed shifts, newest first. */
export async function listShifts(orgId, months) {
  const rows = (await Promise.all(months.map((m) => listJSON(closedPrefix(orgId, m))))).flat();
  return rows.map((r) => r.value).sort((a, b) => b.closedAt - a.closedAt);
}
