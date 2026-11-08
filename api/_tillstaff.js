/* Who is at the register.

   One device behind the counter, signed in as the business, used by whoever
   is on. A PIN says which of them is pressing the buttons right now, so a
   sale is put against the right name and a refund is done by somebody
   allowed to do refunds. That is all it is for.

   `_employees.js` explains why a PIN was the wrong way to record attendance:
   it proves only that somebody who knows the code was standing there. That is
   still true, and it is why this file does not touch attendance. At a till
   the question is different — not "were you at work" but "which of the
   people here rang this up" — and every till answers it this way, because a
   cashier cannot sign out of the business and back in between customers.

   PINs are hashed, unique within a business, and locked out for a few
   minutes after repeated wrong guesses, since four digits is ten thousand
   tries. The operator token is signed under its own label, lasts one shift,
   and names a business: it cannot be used anywhere but this register. */

import crypto from "crypto";
import { getJSON, setJSON } from "./_store.js";
import { signScoped } from "./_auth.js";

export const OPERATOR_ROLES = ["cashier", "manager"];
const pinsKey = (orgId) => `register:${orgId}:pins`;
const failKey = (orgId) => `register:${orgId}:pinfail`;
const HOURS = 12;
const MAX_FAILS = 8;
const LOCK_MS = 5 * 60 * 1000;

const hash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString("base64url");

export function readPin(pin) {
  const s = String(pin ?? "");
  return /^\d{4,6}$/.test(s) ? s : null;
}

export async function listPins(orgId) {
  const map = (await getJSON(pinsKey(orgId))) || {};
  return Object.entries(map).map(([employeeId, p]) => ({ employeeId, name: p.name, role: p.role }));
}

export async function setPin(orgId, { employeeId, name, pin, role }) {
  const id = String(employeeId || "").trim();
  if (!id) return { error: "employee" };
  const ok = readPin(pin);
  if (!ok) return { error: "pin" };
  if (!OPERATOR_ROLES.includes(role)) return { error: "role" };
  const map = (await getJSON(pinsKey(orgId))) || {};
  /* Two people with one PIN would make every sale either of theirs. */
  for (const [other, p] of Object.entries(map)) {
    if (other !== id && hash(ok, p.salt) === p.hash) return { error: "taken" };
  }
  const salt = crypto.randomBytes(12).toString("base64url");
  map[id] = { name: String(name || "").trim().slice(0, 60), role, salt, hash: hash(ok, salt), setAt: Date.now() };
  await setJSON(pinsKey(orgId), map);
  return { employeeId: id, role };
}

export async function removePin(orgId, employeeId) {
  const map = (await getJSON(pinsKey(orgId))) || {};
  delete map[String(employeeId)];
  await setJSON(pinsKey(orgId), map);
  return { removed: true };
}

/* Whether the register asks for a PIN at all: only once somebody has one. */
export async function pinsInUse(orgId) {
  return Object.keys((await getJSON(pinsKey(orgId))) || {}).length > 0;
}

export async function checkPin(orgId, pin, now = Date.now()) {
  const fails = (await getJSON(failKey(orgId))) || { count: 0, until: 0 };
  if (fails.until > now) return { error: "locked", until: fails.until };
  const ok = readPin(pin);
  const map = (await getJSON(pinsKey(orgId))) || {};
  const hit = ok ? Object.entries(map).find(([, p]) => hash(ok, p.salt) === p.hash) : null;
  if (!hit) {
    const count = fails.count + 1;
    await setJSON(failKey(orgId), count >= MAX_FAILS ? { count: 0, until: now + LOCK_MS } : { count, until: 0 });
    return { error: "pin" };
  }
  if (fails.count) await setJSON(failKey(orgId), { count: 0, until: 0 });
  const [employeeId, p] = hit;
  return { operator: { employeeId, name: p.name, role: p.role }, token: issueOperator(orgId, { employeeId, name: p.name, role: p.role }, now) };
}

export function issueOperator(orgId, { employeeId, name, role }, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ o: orgId, e: employeeId, n: name, r: role, x: now + HOURS * 36e5 })).toString("base64url");
  return `${body}.${signScoped("operator", body)}`;
}

/* The operator a token names, for this business, or null. */
export function readOperator(token, orgId, now = Date.now()) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = signScoped("operator", body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  if (data.o !== orgId || !(data.x > now) || !OPERATOR_ROLES.includes(data.r)) return null;
  return { employeeId: data.e, name: data.n, role: data.r };
}
