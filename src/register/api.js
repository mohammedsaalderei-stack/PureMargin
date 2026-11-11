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

const OP_KEY = "pm_reg_operator";
const QUEUE_KEY = "pm_reg_queue";
const CATALOGUE_KEY = "pm_reg_catalogue";
const BRANCH_KEY = "pm_reg_branch";

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
   server, and is what the offline path listens for. */
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
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new RegisterError(res.status, json);
  return json;
}

export const isNetworkError = (err) => !(err instanceof RegisterError);

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

const uuid = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function queued() {
  return read(QUEUE_KEY, []);
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
      /* Points can't be checked against a balance nobody can read offline,
         so they are not redeemed offline. */
      pointsBalance: 0,
      branchId: order.branchId,
      at,
      number,
      cashier: op?.name || "",
      clientId,
    });
    if (built.error) throw new RegisterError(422, built);
    write(QUEUE_KEY, [...queued(), { kind: "sale", body, at }]);
    return { receipt: { ...built.receipt, pending: true }, offline: true };
  }
}

/* Send what was sold offline, oldest first, stopping at the first failure so
   the order of the books is the order of the sales. A sale the server refuses
   outright (not a network failure) is kept aside rather than retried for ever. */
export async function flush(token) {
  const queue = queued();
  if (!queue.length) return { sent: 0, left: 0 };
  let sent = 0;
  const kept = [];
  const refused = read(`${QUEUE_KEY}:refused`, []);
  for (let i = 0; i < queue.length; i += 1) {
    const entry = queue[i];
    try {
      await call(token, entry.kind, { method: "POST", body: entry.body });
      sent += 1;
    } catch (err) {
      if (isNetworkError(err) || err.status === 401) { kept.push(...queue.slice(i)); break; }
      refused.push({ ...entry, error: err.body });
    }
  }
  write(QUEUE_KEY, kept);
  write(`${QUEUE_KEY}:refused`, refused);
  return { sent, left: kept.length, refused: refused.length };
}
