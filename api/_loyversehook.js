/* Real-time receipts, pushed rather than polled.

   ── What was already here ────────────────────────────────────────────────

   Most of what a receipt has to do on arrival exists and is proven:
   `_pos.js` reads `/v1.0/receipts?created_at_min=` with a cursor, `_data.js`
   normalises a page of them, and `_salesdepletion.js` matches each line to a
   recipe, converts the units and writes an append-only `consume` entry per
   ingredient, idempotent by receipt number.

   What was missing was the trigger. Depletion ran when somebody's browser
   refreshed the dashboard, which means a kitchen that sold all evening with
   nobody logged in depleted nothing until the next morning — and the stock
   screen, which is supposed to answer "what have I got right now", was as
   stale as the last time anyone looked at it.

   So this module is the front door for a push, and it deliberately does not
   reimplement the engine behind it. A webhook receipt and a polled receipt go
   through the same normaliser and the same depletion path, because two paths
   that write stock are two chances for them to disagree.

   ── Who the receipt belongs to ───────────────────────────────────────────

   A webhook is one URL receiving events for every account on the deployment,
   and the payload says which *store* it came from, not which business. Mapping
   store ids to organizations would mean a registry to keep in step with every
   connect, disconnect and new branch — and a wrong entry would post one
   business's sales into another's ledger.

   Instead the URL carries the answer. Each organization gets its own
   unguessable token, and the token resolves to exactly one org. That also
   makes the endpoint authenticated: it is a public URL that decrements stock,
   so an unauthenticated one would let anybody on the internet empty a
   restaurant's inventory a receipt at a time.

   ── On signatures ────────────────────────────────────────────────────────

   The specification says to validate the payload signature "if configured",
   and that is how it is implemented: when `LOYVERSE_WEBHOOK_SECRET` is set,
   the body must carry a matching HMAC and is refused otherwise. The header
   name and digest scheme are configurable because they are Loyverse's to
   define and this has not been run against their signer — inventing a fixed
   scheme here and calling it verified would be worse than a token in the URL,
   which is at least honestly what it is. */

import crypto from "node:crypto";
import { getJSON, setJSON, del } from "./_store.js";
import { provider } from "./_pos.js";

const SECRET = (orgId) => `poshook:secret:${orgId}`;
const OWNER = (token) => `poshook:org:${token}`;

/* Long enough that guessing is not a strategy, and URL-safe so it survives
   being pasted into a webhook configuration field. */
const newToken = () => crypto.randomBytes(24).toString("base64url");

/* The org's webhook token, created on first use.

   Returned rather than shown once: this is not a password, it is an address,
   and somebody re-opening the settings screen a month later needs to be able
   to read it again rather than being told to rotate it. */
export async function webhookToken(orgId) {
  if (!orgId) return null;
  const existing = await getJSON(SECRET(orgId));
  if (existing?.token) return existing.token;

  const token = newToken();
  await setJSON(SECRET(orgId), { token, createdAt: Date.now() });
  await setJSON(OWNER(token), { orgId, createdAt: Date.now() });
  return token;
}

/* Replace the token, and retire the old one in the same breath.

   The old mapping is deleted rather than left to expire: a rotation happens
   because somebody thinks the old URL leaked, and a leaked URL that still
   works for an hour is not rotated. */
export async function rotateWebhookToken(orgId) {
  if (!orgId) return null;
  const existing = await getJSON(SECRET(orgId));
  if (existing?.token) await del(OWNER(existing.token));
  await del(SECRET(orgId));
  return webhookToken(orgId);
}

export async function orgForToken(token) {
  const clean = String(token || "").trim();
  if (!clean) return null;
  const row = await getJSON(OWNER(clean));
  return row?.orgId || null;
}

/* Constant-time comparison, so a wrong signature cannot be narrowed down one
   byte at a time by measuring how long the rejection took. */
function sameDigest(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length || !left.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export const SIGNATURE_HEADER =
  (process.env.LOYVERSE_WEBHOOK_SIGNATURE_HEADER || "x-loyverse-signature").toLowerCase();

/* Refuses when a secret is configured and the body does not match it.

   Returns `{ ok }` rather than throwing, and says which of the two states it
   is in, because "no secret configured" and "signature wrong" want different
   handling and different log lines. */
export function verifySignature(rawBody, headers = {}) {
  const secret = process.env.LOYVERSE_WEBHOOK_SECRET;
  if (!secret) return { ok: true, checked: false };

  /* The exact bytes, or nothing.

     A signature is an HMAC over what the sender transmitted. Re-serialising a
     parsed body does not reproduce those bytes — key order, spacing and number
     formatting are all free to differ — so `JSON.stringify(req.body)` would
     produce a digest that never matches and would refuse every correctly
     signed request. Refusing loudly here is better than a check that silently
     passes nothing, and better than one that quietly compares the wrong thing
     and calls the result verified.

     `server.js` sets `req.rawBody`. A platform that parses the body for you
     needs its parser turned off for this route before the secret is set. */
  if (typeof rawBody !== "string" || !rawBody) {
    return { ok: false, checked: true, reason: "norawbody" };
  }

  const sent = String(headers[SIGNATURE_HEADER] || "").trim().replace(/^sha256=/i, "");
  if (!sent) return { ok: false, checked: true, reason: "missing" };

  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

  return sameDigest(sent, digest)
    ? { ok: true, checked: true }
    : { ok: false, checked: true, reason: "mismatch" };
}

/* One pushed event, in the shape the depletion engine already takes.

   Loyverse wraps a receipt in an envelope on some event types and sends it
   bare on others, so both are accepted. Everything past that goes through
   `provider().receipt`, which is the same function the poller uses — the point
   being that a receipt cannot mean one thing when pushed and another when
   fetched. */
export function receiptFromEvent(body) {
  const payload = body?.receipt || body?.data?.receipt || body?.data || body;
  if (!payload || typeof payload !== "object") return { error: "payload" };

  const receiptNumber = String(payload.receipt_number || payload.id || "").trim();
  if (!receiptNumber) return { error: "receipt_number" };
  if (!Array.isArray(payload.line_items)) return { error: "line_items" };

  const normalised = provider().receipt(payload);
  const at = Number.isFinite(normalised.at) ? normalised.at : Date.now();

  return {
    receipt: {
      /* `id` is what idempotency keys on throughout, and it is the till's
         receipt number — so a receipt that arrives by push and is then found
         again by the poller is recognised as the same sale. */
      id: receiptNumber,
      branchId: normalised.branchId,
      at,
      lines: normalised.lines,
      total: Number(payload.total_money) || null,
    },
  };
}

/* Which events carry a receipt worth acting on. Anything else is acknowledged
   and ignored rather than refused: a 4xx to a webhook makes the sender retry
   an event we will never want, and some senders disable an endpoint that keeps
   refusing. */
export const RECEIPT_EVENTS = new Set(["receipt.created", "receipts.update", "receipt.updated"]);

export function eventNameOf(body) {
  return String(body?.type || body?.event || body?.event_type || "").trim();
}
