/* The register's line to the server, and what it does when there is none.

   A till that stops selling when the Wi-Fi drops is not a till. So the menu
   is kept on the device after every successful load, and a sale made while
   offline is priced here — by the same code the server prices with
   (`shared/tillprice.js`) — printed, and queued. The queue is sent in order as
   soon as the connection is back, each sale carrying the id and the receipt
   number it was given here, so a sale sent twice is recorded once and the
   number on the customer's receipt is the number in the books.

   Who is at the register travels as an operator token in a header of its
   own, never in the session token, so signing a cashier out of the register
   does not sign the device out of the business. */

import { buildSale, receiptNumber } from "../../shared/tillprice.js";

const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const OP_KEY = "pm_reg_operator";
/* Before unsent sales were kept per person, they were kept under this one
   key. Anything still there is adopted by whoever opens the register next —
   which is who would have sent it. */
const LEGACY_QUEUE = "pm_reg_queue";
const QUEUE_KEY = "pm_reg_q";
const REFUSED_KEY = "pm_reg_qx";
/* How many times a sale the server keeps failing on (not refusing — failing)
   is tried before it is set aside so the ones behind it can be sent. */
const MAX_TRIES = 6;
const CATALOGUE_KEY = "pm_reg_catalogue";
const BRANCH_KEY = "pm_reg_branch";
const SHIFT_KEY = "pm_reg_shift";
const CUSTOMERS_KEY = "pm_reg_customers";
const PINS_KEY = "pm_reg_pins";

const read = (key, fallback) => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or private */ }
};

export const operatorToken = () => read(OP_KEY, null)?.token || "";
export const savedOperator = () => read(OP_KEY, null)?.operator || null;
export const setOperator = (operator, token) => write(OP_KEY, operator ? { operator, token } : null);
export const savedBranch = () => read(BRANCH_KEY, "");
export const saveBranch = (id) => write(BRANCH_KEY, id);

export class RegisterError extends Error {
  constructor(status, body) {
    super(body?.error || `http-${status}`);
    this.status = status;
    this.body = body || {};
  }
}

/* One request. A thrown TypeError from fetch means the network, not the
   server, and is what the offline path listens for.

   So does an answer that is not the server's: every reply from the register
   is JSON, so a page of HTML — a café's Wi-Fi sign-in, a proxy's "bad
   gateway" — is the network standing in for it, however cheerful its status
   code. Reading that as "the sale went through" would lose the sale. */
export async function call(token, what, { method = "GET", body, query = {} } = {}) {
  const qs = new URLSearchParams({ what, ...query }).toString();
  const res = await fetch(`/api/till?${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(operatorToken() ? { "x-register-operator": operatorToken() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (json === null || typeof json !== "object") throw new TypeError("no answer from the register");
  if (!res.ok) throw new RegisterError(res.status, json);
  return json;
}

/* The server could not be reached — or was reached and is failing, which
   from behind a counter is the same thing: sell now, send it later. */
export const isNetworkError = (err) => !(err instanceof RegisterError) || err.status >= 500;

/* ── What the register remembers so it can open with no connection ─────────

   The shift as it last stood at each branch, and the customers on file. The
   menu is kept by `loadCatalogue` below. All of it is this device's copy of
   something the server owns, shown only when the server cannot be asked. */
export const savedShift = (branchId) => read(`${SHIFT_KEY}:${branchId}`, null);
export const saveShift = (branchId, state) => write(`${SHIFT_KEY}:${branchId}`, state ? { ...state, savedAt: Date.now() } : null);
export const savedCustomers = (user) => read(`${CUSTOMERS_KEY}:${user}`, []);
export const saveCustomers = (user, list) => write(`${CUSTOMERS_KEY}:${user}`, list || []);

/* ── Signing in with a PIN, offline ────────────────────────────────────────

   A PIN is checked by the server, which is the only place it is stored. So a
   cashier who has signed in on this device before is remembered here — under
   a salted hash of the PIN, never the PIN — and can sign in again when the
   server cannot be reached. Somebody who has never used this device cannot,
   and the pad says so. Kept for two weeks, the last ten people. */
const PIN_DAYS = 14;
async function pinHash(pin) {
  let salt = read(`${PINS_KEY}:salt`, "");
  if (!salt) {
    salt = uuid();
    write(`${PINS_KEY}:salt`, salt);
  }
  if (!globalThis.crypto?.subtle) return null;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${pin}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function rememberPin(pin, operator, token) {
  try {
    const key = await pinHash(pin);
    if (!key) return;
    const all = read(PINS_KEY, {});
    all[key] = { operator, token, at: Date.now() };
    const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 10);
    write(PINS_KEY, Object.fromEntries(kept));
  } catch { /* remembered next time */ }
}
export async function offlinePin(pin) {
  try {
    const hit = read(PINS_KEY, {})[await pinHash(pin)];
    return hit && Date.now() - hit.at < PIN_DAYS * 864e5 ? hit : null;
  } catch {
    return null;
  }
}

export async function loadCatalogue(token, user) {
  try {
    const out = await call(token, "catalogue");
    write(`${CATALOGUE_KEY}:${user}`, { ...out, savedAt: Date.now() });
    return { ...out, offline: false };
  } catch (err) {
    const cached = read(`${CATALOGUE_KEY}:${user}`, null);
    if (cached && isNetworkError(err)) return { ...cached, offline: true };
    throw err;
  }
}

/* ── Selling, online or not ── */

/* Whose sales these are. The queue is kept per signed-in person, because a
   device outlives a sign-in: sales left unsent by one business must never be
   sent into the books of whoever signs in on that tablet next. They wait,
   under their own name, for that person to come back. */
let owner = "";
const queueKey = () => `${QUEUE_KEY}:${owner}`;
const refusedKey = () => `${REFUSED_KEY}:${owner}`;

export function setQueueOwner(user) {
  owner = String(user || "");
  if (!owner) return;
  const old = read(LEGACY_QUEUE, []);
  const oldRefused = read(`${LEGACY_QUEUE}:refused`, []);
  if (old.length) write(queueKey(), [...old, ...read(queueKey(), [])]);
  if (oldRefused.length) write(refusedKey(), [...oldRefused, ...read(refusedKey(), [])]);
  try {
    localStorage.removeItem(LEGACY_QUEUE);
    localStorage.removeItem(`${LEGACY_QUEUE}:refused`);
  } catch { /* nothing to move */ }
}

export function queued() {
  return owner ? read(queueKey(), []) : [];
}

/* Something done offline, to be sent in order when the connection is back. */
export function enqueue(kind, body) {
  if (!owner) throw new RegisterError(0, { error: "nouser" });
  write(queueKey(), [...queued(), { kind, body, at: Date.now() }]);
}

/* Sales the server would not take, kept where they can be seen and sent
   again rather than lost. */
export const refusedSales = () => (owner ? read(refusedKey(), []) : []);
export function retryRefused() {
  const list = refusedSales();
  if (!list.length) return 0;
  write(queueKey(), [...queued(), ...list.map(({ error: _e, tries: _t, ...entry }) => entry)]);
  write(refusedKey(), []);
  return list.length;
}

/* A sale: sent now, or priced here and queued. Either way the caller gets a
   receipt to show and print. */
export async function sell(token, order, catalogue) {
  const at = Date.now();
  const clientId = uuid();
  const number = receiptNumber(at);
  const body = { ...order, clientId, number, at };
  try {
    const out = await call(token, "sale", { method: "POST", body });
    return { receipt: out.receipt, offline: false };
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    /* Points are a balance only the server can read. With no connection the
       sale is not quietly charged in full instead — the screen has already
       shown the customer a total with them taken off — it is stopped, and
       says why. */
    if (Number(order.redeemPoints) > 0) throw new RegisterError(422, { error: "pointsOffline" });
    const op = savedOperator();
    /* The channel's own prices, from the copy of them kept on this device, so
       a delivery order rung up offline is charged what that channel lists. */
    const via = (catalogue.channels || []).find((c) => c.id === order.channelId);
    const built = buildSale(body, {
      catalogue: catalogue.items,
      channel: via ? { id: via.id, name: via.name, prices: via.prices || {} } : null,
      vatPct: catalogue.vatPct,
      vatMode: catalogue.vatMode,
      paymentTypes: catalogue.paymentTypes,
      discounts: catalogue.discounts,
      loyaltyPct: catalogue.loyaltyPct,
      pointsBalance: 0,
      branchId: order.branchId,
      at,
      number,
      cashier: op?.name || "",
      clientId,
    });
    if (built.error) throw new RegisterError(422, built);
    /* Sent later marked as made offline, with the receipt the customer was
       given: the server records what was charged even if the menu has moved
       by the time this arrives, and does not refuse it for want of a shift. */
    enqueue("sale", { ...body, offline: true, receipt: built.receipt });
    return { receipt: { ...built.receipt, pending: true }, offline: true };
  }
}

/* Send what was sold offline, oldest first, stopping at the first failure so
   the order of the books is the order of the sales. A sale the server refuses
   outright (not a network failure) is kept aside rather than retried for ever.

   One at a time. The timer, the connection coming back and the "try again"
   button can all ask at once, and two passes over the same queue would each
   write back what they thought was left — the second over the top of a sale
   rung up in between. */
let flushing = null;
export function flush(token) {
  if (!flushing) flushing = sendQueue(token).finally(() => { flushing = null; });
  return flushing;
}

async function sendQueue(token) {
  /* The keys as they are now: somebody else signing in while this runs must
     not have the rest of this queue written into theirs. */
  const qk = queueKey();
  const rk = refusedKey();
  const queue = queued();
  if (!queue.length) return { sent: 0, left: 0, refused: refusedSales().length };
  let sent = 0;
  let kept = [];
  const refused = [];
  for (let i = 0; i < queue.length; i += 1) {
    const entry = queue[i];
    try {
      await call(token, entry.kind, { method: "POST", body: entry.body });
      sent += 1;
    } catch (err) {
      const failing = err instanceof RegisterError && err.status >= 500;
      const tries = (entry.tries || 0) + (failing ? 1 : 0);
      /* No connection, or a sign-in that has run out: everything waits, in
         order. A server that keeps failing on this one sale is given a few
         goes and then stepped over, so one bad sale cannot hold up a day's. */
      if ((isNetworkError(err) && tries < MAX_TRIES) || err.status === 401) {
        kept = [{ ...entry, ...(tries ? { tries } : {}) }, ...queue.slice(i + 1)];
        break;
      }
      /* A shift opened offline that the server already has open is not a
         loss; anything else refused is kept to be seen. */
      if (entry.kind !== "shift-open") refused.push({ ...entry, error: failing ? { error: "server" } : err.body });
    }
  }
  /* Whatever was rung up, or put back to be tried again, while this was
     running is still in the queue behind what it started with. */
  const since = read(qk, []).slice(queue.length);
  write(qk, [...kept, ...since]);
  const set = [...read(rk, []), ...refused];
  if (refused.length) write(rk, set);
  return { sent, left: kept.length + since.length, refused: set.length };
}
