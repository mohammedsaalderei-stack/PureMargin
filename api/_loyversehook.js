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

   ── On signatures, per Loyverse's own specification ─────────────────────

   From the API reference (developer.loyverse.com/docs, "Validate
   notifications"), and worth stating precisely because a signature check that
   is subtly wrong is worse than none:

   - The header is `X-Loyverse-Signature`.
   - Its value is a **lowercase hex-encoded HMAC-SHA1** of the raw request
     body, keyed with the OAuth application's **Client Secret**. SHA-1, not
     SHA-256 — this was implemented as SHA-256 first, from a guess, and every
     genuine notification would have been refused.
   - It is present **only** on webhooks created by an OAuth2 application.
     Webhooks added through the Loyverse dashboard or with a Personal Access
     Token are unsigned, and for those the token in the URL is the only
     authentication there is.

   So the secret stays optional. Set `LOYVERSE_CLIENT_SECRET` when the webhook
   was registered by an OAuth2 app and every request is verified; leave it
   unset for a dashboard-registered webhook and the URL token carries the
   weight. What is not offered is a middle position where a signature is
   checked incorrectly and reported as verified. */

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

/* ── Whether receipts are actually arriving ──────────────────────────────

   Issuing a token is not the same as being connected. Somebody can open
   Settings, generate the address, and never paste it into Loyverse — and
   nothing about the token would say so. The only honest evidence that live
   ingestion works is that a delivery arrived.

   So each successful delivery is recorded, and the three states it separates
   are the three somebody actually asks about:

     "off"      no address has even been issued
     "waiting"  an address exists, nothing has ever been delivered — almost
                always a webhook that was never added at the Loyverse end
     "live"     receipts are arriving, and here is when the last one did

   Kept small on purpose: a timestamp and a count, not a log. This exists to
   answer "is it working", and a history of every delivery would be a second
   copy of the ledger that already holds them. */

const SEEN = (orgId) => `poshook:seen:${orgId}`;

export async function noteDelivery(orgId, { at = Date.now(), receipts = 1 } = {}) {
  if (!orgId) return;
  const row = (await getJSON(SEEN(orgId))) || {};
  await setJSON(SEEN(orgId), {
    firstAt: row.firstAt || at,
    lastAt: at,
    deliveries: (row.deliveries || 0) + 1,
    receipts: (row.receipts || 0) + receipts,
  });
}

/* Six hours. Long enough that a quiet night, a closed Monday or a slow
   afternoon does not read as a fault, short enough that a webhook Loyverse
   disabled two days ago does not still look healthy. */
const STALE_MS = 6 * 60 * 60 * 1000;

export async function ingestionStatus(orgId, { now = Date.now() } = {}) {
  if (!orgId) return { state: "off", configured: false };

  const secret = await getJSON(SECRET(orgId));
  const seen = (await getJSON(SEEN(orgId))) || null;

  if (!secret?.token) return { state: "off", configured: false };
  if (!seen?.lastAt) {
    return {
      state: "waiting",
      configured: true,
      /* Named so an answer can be specific about what to do rather than
         saying it is not working. */
      hint: "A webhook address exists but no receipt has ever arrived on it. It has probably not been added in Loyverse yet.",
    };
  }

  const quietFor = now - seen.lastAt;
  return {
    state: "live",
    configured: true,
    lastReceiptAt: seen.lastAt,
    firstReceiptAt: seen.firstAt,
    deliveries: seen.deliveries,
    receipts: seen.receipts,
    /* Reported rather than judged: whether six quiet hours is a problem
       depends on opening times, which this module does not know. */
    quietForMinutes: Math.round(quietFor / 60000),
    quiet: quietFor > STALE_MS,
  };
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

export const SIGNATURE_HEADER = "x-loyverse-signature";

/* The OAuth application's Client Secret, which is the HMAC key. The older
   name is still read so an existing deployment does not go quiet on upgrade. */
const clientSecret = () =>
  process.env.LOYVERSE_CLIENT_SECRET || process.env.LOYVERSE_WEBHOOK_SECRET || "";

/* Refuses when a secret is configured and the body does not match it.

   Returns `{ ok }` rather than throwing, and says which of the two states it
   is in, because "no secret configured" and "signature wrong" want different
   handling and different log lines. */
export function verifySignature(rawBody, headers = {}) {
  const secret = clientSecret();
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

  const sent = String(headers[SIGNATURE_HEADER] || "").trim().toLowerCase();
  if (!sent) return { ok: false, checked: true, reason: "missing" };

  /* SHA-1, hex, lowercase, keyed with the Client Secret used as it is given —
     it looks base64 but is not decoded first. All four details are Loyverse's,
     and getting any one of them wrong refuses every genuine notification. */
  const digest = crypto.createHmac("sha1", secret).update(rawBody, "utf8").digest("hex");

  return sameDigest(sent, digest)
    ? { ok: true, checked: true }
    : { ok: false, checked: true, reason: "mismatch" };
}

/* One receipt, in the shape the depletion engine already takes.

   Everything past the field checks goes through `provider().receipt`, the same
   function the poller uses, so a receipt cannot mean one thing when pushed and
   another when fetched. */
function oneReceipt(payload) {
  if (!payload || typeof payload !== "object") return { error: "payload" };

  const receiptNumber = String(payload.receipt_number || payload.id || "").trim();
  if (!receiptNumber) return { error: "receipt_number" };
  if (!Array.isArray(payload.line_items)) return { error: "line_items" };

  const normalised = provider().receipt(payload);

  return {
    receipt: {
      /* `id` is what idempotency keys on throughout, and it is the till's
         receipt number — so a receipt that arrives by push and is then found
         again by the poller is recognised as the same sale. */
      id: receiptNumber,
      branchId: normalised.branchId,
      at: Number.isFinite(normalised.at) ? normalised.at : Date.now(),
      lines: normalised.lines,
      total: Number(payload.total_money) || null,
      /* Carried so the caller can decide what not to deduct. */
      receiptType: String(payload.receipt_type || "SALE").toUpperCase(),
      cancelledAt: payload.cancelled_at || null,
      refundFor: payload.refund_for || null,
    },
  };
}

/* Receipts that must not draw stock, and why.

   A REFUND receipt lists the same items as the sale it reverses, with the same
   positive quantities. Deducting it would take the food out of stock a second
   time for one meal that left the kitchen once — the original sale already
   deducted it. Adding it back would be the opposite claim, that a served
   burger returned to the shelf, which is not true either.

   Neither is right, so neither is done: a refund is money, and this ledger is
   food. A cancelled receipt is skipped on the same reasoning — nothing was
   made, so nothing left the store.

   Stated rather than silent, because "my refunds do not affect stock" is a
   reasonable thing to be surprised by. */
export function drawsStock(receipt) {
  if (!receipt) return false;
  if (receipt.cancelledAt) return false;
  return receipt.receiptType !== "REFUND";
}

/* Every receipt in one notification.

   Loyverse's envelope is `{ merchant_id, type, created_at, receipts: [...] }`
   and the array holds **up to 100** objects — a batch, not a single event. The
   first version of this read `body.receipt` and would have found nothing in
   every real delivery.

   A bare receipt is still accepted, because the dashboard's "send test
   notification" and hand-made calls during setup send one. */
export function receiptsFromEvent(body) {
  if (!body || typeof body !== "object") return { error: "payload" };

  const batch = Array.isArray(body.receipts) ? body.receipts
    : Array.isArray(body.data?.receipts) ? body.data.receipts
      : null;

  if (batch) {
    const receipts = [];
    const rejected = [];
    for (const row of batch) {
      const out = oneReceipt(row);
      if (out.error) rejected.push(out.error);
      else receipts.push(out.receipt);
    }
    /* A batch where nothing at all could be read is a malformed delivery; one
       where some rows read is a partial success worth committing. */
    if (!receipts.length) return { error: rejected[0] || "receipts" };
    return { receipts, rejected };
  }

  const single = oneReceipt(body.receipt || body.data?.receipt || body.data || body);
  if (single.error) return { error: single.error };
  return { receipts: [single.receipt], rejected: [] };
}

/* The event this endpoint acts on.

   `receipts.update` is the only receipt event Loyverse defines, and it fires
   on creation as well as update — there is no `receipt.created`, despite both
   specifications naming one. Anything else is acknowledged and ignored rather
   than refused, because a non-2xx is a delivery failure to Loyverse and enough
   of them disable the webhook. */
export const RECEIPT_EVENTS = new Set(["receipts.update"]);

export function eventNameOf(body) {
  return String(body?.type || body?.event || body?.event_type || "").trim();
}
