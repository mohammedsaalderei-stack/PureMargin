import { getJSON, setJSON } from "./_store.js";
import crypto from "crypto";

/* Variable costs — a plain ledger of one-off spends.

   Packaging, maintenance, delivery commissions. Money that went out on a
   particular day for a particular reason, typed in by a person.

   ── Deliberately not connected to anything ───────────────────────────────

   This module reads no invoice, matches no menu item and touches no stock.
   It stores what somebody typed and adds it up. That isolation is the point:
   the previous cost screen could only produce a variable cost as a by-product
   of an OCR scan that matched lines to the menu, which meant an owner who just
   wanted to record "1,620 on packaging" had no way to say so.

   ── Dates are calendar days, not instants ────────────────────────────────

   `date` is a `YYYY-MM-DD` string, never a timestamp. An expense happened on a
   day in the shop's own calendar; storing it as milliseconds means a spend
   entered at 2am in Dubai lands in the previous month once it is read back as
   UTC, and the month's total quietly disagrees with the list beneath it.
   String comparison on ISO dates is ordered, so range filtering needs no
   parsing at all. */

const KEY = (orgId) => `varcosts:${orgId}`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayISO(now = new Date()) {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/* The month a date belongs to, as `YYYY-MM`. */
export function monthOf(date) {
  return String(date || "").slice(0, 7);
}

/* Validation returns a field name, not a sentence. The client owns the wording
   in five languages; a message baked in here would only ever be in one. */
export function validateVarCost({ title, amount, date }) {
  if (!String(title || "").trim()) return "title";
  if (!(Number(amount) > 0)) return "amount";
  if (date && !DATE_RE.test(String(date))) return "date";
  return null;
}

export async function listVarCosts(orgId, { month = null } = {}) {
  const map = (await getJSON(KEY(orgId))) || {};
  const all = Object.values(map);
  const rows = month ? all.filter((c) => monthOf(c.date) === month) : all;
  /* Newest first. Two spends on the same day fall back to when they were
     entered, so re-typing a forgotten receipt doesn't scramble the order. */
  return rows.sort((a, b) =>
    a.date === b.date ? (b.createdAt || 0) - (a.createdAt || 0) : (a.date < b.date ? 1 : -1));
}

export async function saveVarCost(orgId, input) {
  const error = validateVarCost(input);
  if (error) return { error };

  const map = (await getJSON(KEY(orgId))) || {};
  /* An id that isn't already in this org's map is treated as a new entry
     rather than trusted. A client that invents one cannot reach across orgs,
     and a stale id from a deleted row re-creates instead of resurrecting. */
  const existing = input.id && map[input.id] ? map[input.id] : null;
  const id = existing ? input.id : crypto.randomUUID();

  const cost = {
    id,
    title: String(input.title).trim().slice(0, 120),
    amount: Math.round(Number(input.amount) * 100) / 100,
    date: DATE_RE.test(String(input.date)) ? String(input.date) : (existing?.date || todayISO()),
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  map[id] = cost;
  await setJSON(KEY(orgId), map);
  return { cost, created: !existing };
}

/* Deleted outright, unlike a constant cost.

   A constant cost is ended rather than removed because February's report has
   to keep costing February's rent. A variable cost is a single dated line; if
   it should not be there, nothing is preserved by keeping it. */
export async function deleteVarCost(orgId, id) {
  const map = (await getJSON(KEY(orgId))) || {};
  if (!map[id]) return { error: "notfound" };
  delete map[id];
  await setJSON(KEY(orgId), map);
  return { deleted: true, id };
}

export function totalOf(entries = []) {
  return Math.round(entries.reduce((n, c) => n + (Number(c.amount) || 0), 0) * 100) / 100;
}

export async function monthTotal(orgId, month) {
  if (!orgId || !month) return 0;
  return totalOf(await listVarCosts(orgId, { month }));
}
