/* Open tickets and customers: the register's two address books.

   ── Open tickets ─────────────────────────────────────────────────────────

   An order taken now and paid later — a table that will ask for the bill in
   an hour, a phone order collected at seven. It is saved where every till in
   the business can see it, so the waiter who took it and the cashier who
   closes it need not be standing at the same screen.

   A ticket holds what was ordered, never what it costs. The price is worked
   out when it is paid, from the catalogue as it is then, exactly as a sale
   rung up on the spot would be; a ticket saved before a price change is
   charged at the new price, which is what a till does.

   ── Customers ────────────────────────────────────────────────────────────

   A name, a phone number, a note — enough to find them again and put a sale
   against them. What they have spent, how often they come and the points
   they hold are read off their receipts rather than kept on the record, for
   the reason every balance in this app is derived: a stored total is a
   second truth, and the first one to go wrong. */

import crypto from "crypto";
import { getJSON, setJSON, del, listJSON } from "./_store.js";

const text = (v, max) => String(v ?? "").trim().slice(0, max);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`;

const ticketKey = (orgId, id) => `register:${orgId}:ticket:${id}`;
const ticketPrefix = (orgId) => `register:${orgId}:ticket:`;
const customerKey = (orgId, id) => `register:${orgId}:customer:${id}`;
const customerPrefix = (orgId) => `register:${orgId}:customer:`;

/* ── Tickets ── */

export function readTicketLines(lines) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 100) return null;
  const out = [];
  for (const raw of lines) {
    const itemId = text(raw?.itemId, 80);
    const qty = Number(raw?.qty);
    if (!itemId || !Number.isInteger(qty) || qty < 1 || qty > 999) return null;
    out.push({
      /* The till's own id for the line, so the kitchen can be sent only what
         was added since the ticket was last printed. */
      key: text(raw?.key, 40) || undefined,
      itemId,
      qty,
      addons: Array.isArray(raw?.addons) ? raw.addons.map((a) => text(a, 80)).slice(0, 20) : [],
      note: text(raw?.note, 120),
      ...(raw?.discount ? { discount: raw.discount } : {}),
    });
  }
  return out;
}

export async function saveTicket(orgId, input, { by = "", branchId = "", at = Date.now() } = {}) {
  const lines = readTicketLines(input?.lines);
  if (!lines) return { error: "lines" };
  const id = input?.id && /^T[0-9a-z]+$/.test(String(input.id)) ? String(input.id) : newId("T");
  const existing = await getJSON(ticketKey(orgId, id));
  const ticket = {
    id,
    name: text(input?.name, 40) || null,
    table: text(input?.table, 10) || null,
    orderType: text(input?.orderType, 20) || "dine_in",
    customerId: text(input?.customerId, 60) || null,
    discount: input?.discount || null,
    note: text(input?.note, 200) || null,
    /* How much of each line the kitchen has already been sent. */
    printed: input?.printed && typeof input.printed === "object" && !Array.isArray(input.printed)
      ? Object.fromEntries(Object.entries(input.printed).slice(0, 100).map(([k, v]) => [text(k, 40), Math.max(0, Math.min(999, Number(v) || 0))]))
      : {},
    branchId: existing?.branchId || String(branchId || ""),
    lines,
    createdAt: existing?.createdAt || at,
    createdBy: existing?.createdBy || text(by, 60),
    updatedAt: at,
    updatedBy: text(by, 60),
  };
  await setJSON(ticketKey(orgId, id), ticket);
  return { ticket };
}

export async function listTickets(orgId, branchIds = null) {
  const rows = await listJSON(ticketPrefix(orgId));
  return rows
    .map((r) => r.value)
    .filter((t) => !branchIds || branchIds.includes(t.branchId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getTicket(orgId, id) {
  return getJSON(ticketKey(orgId, String(id)));
}

export async function deleteTicket(orgId, id) {
  await del(ticketKey(orgId, String(id)));
  return { deleted: true };
}

/* ── Customers ── */

export async function saveCustomer(orgId, input, { at = Date.now() } = {}) {
  const name = text(input?.name, 60);
  if (!name) return { error: "name" };
  const phone = text(input?.phone, 20).replace(/[^\d+]/g, "");
  const email = text(input?.email, 80);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "email" };
  const id = input?.id && /^C[0-9a-z]+$/.test(String(input.id)) ? String(input.id) : newId("C");
  const existing = await getJSON(customerKey(orgId, id));
  /* One phone number, one customer: the number is how a cashier finds them. */
  if (phone) {
    const clash = (await listCustomers(orgId)).find((c) => c.phone === phone && c.id !== id);
    if (clash) return { error: "phone", customer: clash };
  }
  const customer = {
    id,
    name,
    phone,
    email,
    note: text(input?.note, 200),
    createdAt: existing?.createdAt || at,
    updatedAt: at,
  };
  await setJSON(customerKey(orgId, id), customer);
  return { customer };
}

export async function listCustomers(orgId) {
  const rows = await listJSON(customerPrefix(orgId));
  return rows.map((r) => r.value).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getCustomer(orgId, id) {
  return getJSON(customerKey(orgId, String(id)));
}

/* What a customer has done, from their receipts. Points are what sales earned
   less what they redeemed, refunds taking theirs back. */
export function customerStats(customerId, receipts) {
  const mine = (receipts || []).filter((r) => r.customer_id === customerId);
  const sales = mine.filter((r) => r.receipt_type === "SALE");
  const refunds = mine.filter((r) => r.receipt_type === "REFUND");
  const spent = sales.reduce((s, r) => s + Number(r.total_money || 0), 0)
    - refunds.reduce((s, r) => s + Number(r.total_money || 0), 0);
  const points = mine.reduce((s, r) => s + Number(r.points_earned || 0) - Number(r.points_redeemed || 0), 0);
  const last = sales.reduce((m, r) => Math.max(m, new Date(r.receipt_date).getTime()), 0);
  return { visits: sales.length, spent: round2(spent), points: round2(Math.max(0, points)), lastVisit: last || null };
}
