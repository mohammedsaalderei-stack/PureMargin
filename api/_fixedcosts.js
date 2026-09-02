import { getJSON, setJSON } from "./_store.js";
import crypto from "crypto";

/* The costs that do not move with sales.

   Everything the product measured until now scaled with trade: ingredients,
   waste, the cost of a dish. Rent does not. Salaries do not. A licence does
   not. They go out whether the room is full or empty, and leaving them out
   meant the dashboard's headline was gross margin wearing the word "net" —
   flattering on a slow month by exactly the amount that should have worried
   somebody.

   ── Apportioning ──────────────────────────────────────────────────────────

   A monthly figure has to be spread across whatever period is on screen, and
   the honest way is per day: a month's rent divided by the days in that month,
   times the days being shown. Not divided by covers, and not weighted towards
   busy days — rent does not care that Saturday was good, and pretending it
   does would make a quiet Tuesday look cheaper to run than it was.

   The consequence, stated because it surprises people: a single day now shows
   about a thirtieth of the rent against it. That is correct and it is why the
   daily view will show a loss on a slow day when the month is fine. The number
   is not broken; the day was.

   ── Dates ────────────────────────────────────────────────────────────────

   Each cost carries when it started and, once it ends, when it ended. A rent
   rise is a new entry rather than an edit, so last quarter is still costed at
   what was actually paid. Editing the amount in place would silently rewrite
   history that somebody may already have reported on. */

const KEY = (orgId) => `fixedcosts:${orgId}`;

/* Monthly and yearly, and nothing else.

   "weekly" was accepted here long after the screen stopped offering it, so a
   request could still create one — and the list rendered any non-monthly row
   as "{amount} a year", which is the wrong number on screen for a weekly cost.
   Refusing it at the door is the fix; `monthlyEquivalent` still converts the
   ones already stored, because they are real money and must not read as zero. */
export const PERIODS = ["monthly", "yearly"];

/* One constant cost expressed as what it comes to in a month.

   The simplified cost screen states a single figure — "constant costs, 8,450 a
   month" — and a yearly licence has to be comparable with monthly rent before
   they can be added together. A year is twelve months by definition, so /12 is
   exact rather than a convention.

   Weekly is legacy: the screen no longer offers it, but entries made before it
   was dropped are still real money and must not read as zero. 52/12 is the
   average month, which is the only honest conversion when weeks don't divide
   into months.

   This is a *display* normalisation and nothing else. `apportion` below is
   still what costs a date range, and it stays per-day — a month with 28 days
   and a month with 31 do not cost the same, and rounding that away here would
   put a number on screen that no report agrees with. */
export function monthlyEquivalent(cost) {
  const amount = Number(cost?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (cost.period === "yearly") return Math.round((amount / 12) * 100) / 100;
  if (cost.period === "weekly") return Math.round(((amount * 52) / 12) * 100) / 100;
  return Math.round(amount * 100) / 100;
}

export function monthlyTotal(costs = []) {
  return Math.round(costs.reduce((n, c) => n + monthlyEquivalent(c), 0) * 100) / 100;
}

export function validateCost({ name, amount, period, startedAt }) {
  if (!String(name || "").trim()) return "name";
  if (!(Number(amount) > 0)) return "amount";
  if (period && !PERIODS.includes(period)) return "period";
  if (startedAt && !Number.isFinite(Number(startedAt))) return "startedAt";
  return null;
}

export async function listCosts(orgId, { includeEnded = false } = {}) {
  const map = (await getJSON(KEY(orgId))) || {};
  return Object.values(map)
    .filter((c) => includeEnded || !c.endedAt)
    .sort((a, b) => Number(b.amount) - Number(a.amount));
}

export async function saveCost(orgId, input) {
  const error = validateCost(input);
  if (error) return { error };

  const map = (await getJSON(KEY(orgId))) || {};
  const id = input.id && map[input.id] ? input.id : crypto.randomUUID();

  const cost = {
    id,
    name: String(input.name).trim(),
    amount: Math.round(Number(input.amount) * 100) / 100,
    period: PERIODS.includes(input.period) ? input.period : "monthly",
    /* Null means the whole business. A branch manager's salary belongs to one
       branch; a group licence belongs to all of them, and splitting it evenly
       across branches that differ in size would be a guess presented as a
       fact. */
    branchId: input.branchId ? String(input.branchId) : null,
    startedAt: Number(input.startedAt) || map[id]?.startedAt || Date.now(),
    endedAt: map[id]?.endedAt || null,
    note: String(input.note || "").slice(0, 200),
    updatedAt: Date.now(),
  };

  map[id] = cost;
  await setJSON(KEY(orgId), map);
  return { cost };
}

/* Ending a cost rather than deleting it.

   A rent that stopped in March still applied in February, and a report run
   over February has to keep costing it. Deleting would quietly change a number
   somebody may already have acted on. */
export async function endCost(orgId, id, at = Date.now()) {
  const map = (await getJSON(KEY(orgId))) || {};
  if (!map[id]) return { error: "notfound" };
  map[id] = { ...map[id], endedAt: Number(at) || Date.now(), updatedAt: Date.now() };
  await setJSON(KEY(orgId), map);
  return { cost: map[id] };
}

export async function deleteCost(orgId, id) {
  const map = (await getJSON(KEY(orgId))) || {};
  if (!map[id]) return { error: "notfound" };
  delete map[id];
  await setJSON(KEY(orgId), map);
  return { deleted: true };
}
