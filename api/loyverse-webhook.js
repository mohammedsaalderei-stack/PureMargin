/* POST /api/loyverse-webhook?t=<org token>
   GET  /api/loyverse-webhook            — a health probe, no data

   The receiving end of Loyverse's `receipt.created` event. Configure the URL
   once in Loyverse with the token the Settings screen shows; every sale then
   arrives here within seconds of being rung up and is deducted from stock
   immediately, instead of waiting for somebody to open the dashboard.

   ── The path ─────────────────────────────────────────────────────────────

   The specification names `/api/integrations/loyverse/webhook` in one document
   and `/api/webhooks/loyverse/receipts` in the other. Neither is used, because
   this deployment routes `/api/<name>` from a flat directory — `server.js`
   matches a single path segment, and a nested file would work on Vercel and
   404 in local development, which is the worst of both. The URL is
   configuration rather than contract: it is pasted into a form once.

   ── What this endpoint deliberately does not do ──────────────────────────

   It does not deduct anything itself. It authenticates the caller, resolves
   which business the receipt belongs to, normalises the payload, and hands it
   to `depleteFromSales` — the same function the poller has always used, which
   matches recipes, converts units, writes append-only ledger entries and is
   idempotent by receipt number. A second implementation of stock deduction is
   a second answer to "what have I got", and they would not agree for long.

   ── Why it answers 200 so often ──────────────────────────────────────────

   A webhook sender retries anything that is not a success, and disables an
   endpoint that keeps failing. So the only 4xx here are for requests that are
   genuinely malformed or unauthorised — a receipt this business has already
   processed, an event type with no receipt in it, or an account that has
   turned automatic depletion off are all acknowledged, because in each case
   the sender did nothing wrong and repeating the delivery would not help. */

import {
  orgForToken, verifySignature, receiptsFromEvent, drawsStock, eventNameOf,
  noteDelivery, RECEIPT_EVENTS,
} from "./_loyversehook.js";
import { depleteFromSales, postedIds } from "./_salesdepletion.js";
import { getMeta } from "./_inventory.js";
import { recordAudit } from "./_audit.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  /* A GET so somebody configuring the webhook can confirm the URL resolves
     before pointing a till at it. Says nothing about any account. */
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, endpoint: "loyverse-webhook" });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    const token = String(req.query?.t || req.query?.token || req.headers?.["x-puremargin-token"] || "");
    const orgId = await orgForToken(token);
    /* Deliberately the same answer for a missing token and a wrong one: an
       endpoint that distinguishes them is an endpoint that confirms which
       tokens exist. */
    if (!orgId) return res.status(401).json({ error: "unauthorized" });

    const signature = verifySignature(req.rawBody, req.headers || {});
    if (!signature.ok) {
      /* `norawbody` is a deployment fault rather than an attack: a secret is
         set but the platform parsed the body before this handler saw it, so
         nothing can be verified. Logged distinctly so it is not spent hunting
         for a forged request that never happened. */
      console.error(signature.reason === "norawbody"
        ? "loyverse webhook: LOYVERSE_WEBHOOK_SECRET is set but the raw body is unavailable — disable body parsing for this route"
        : `loyverse webhook: signature ${signature.reason}`);
      return res.status(401).json({ error: "signature" });
    }

    const body = req.body || {};
    const event = eventNameOf(body);
    /* An unnamed event is accepted: the dashboard's test notification and a
       hand-made setup call both post a bare receipt. */
    if (event && !RECEIPT_EVENTS.has(event)) {
      return res.status(200).json({ status: "ignored", event });
    }

    const parsed = receiptsFromEvent(body);
    if (parsed.error) {
      /* 200, not 400, and this is Loyverse-specific rather than sloppy: a
         non-2xx is a delivery failure, retried 200 times over 48 hours, after
         which the webhook is DISABLED and the merchant stops receiving sales
         entirely. A payload this endpoint cannot read will not become readable
         on the two-hundredth attempt, so it is acknowledged and logged rather
         than retried into an outage. */
      console.error("loyverse webhook: unreadable payload —", parsed.error);
      return res.status(200).json({ status: "unprocessable", reason: parsed.error });
    }

    /* One notification can carry up to a hundred receipts, and they may span
       stores, so they are grouped and each store's batch posted together. */
    const byStore = new Map();
    const skipped = [];
    for (const receipt of parsed.receipts) {
      if (!receipt.branchId || receipt.branchId === "unknown") {
        skipped.push({ receipt_number: receipt.id, reason: "no_store" });
        continue;
      }
      if (!drawsStock(receipt)) {
        skipped.push({ receipt_number: receipt.id, reason: receipt.cancelledAt ? "cancelled" : "refund" });
        continue;
      }
      if (!byStore.has(receipt.branchId)) byStore.set(receipt.branchId, []);
      byStore.get(receipt.branchId).push(receipt);
    }

    /* Recorded before anything else is decided.

       A delivery that arrived and was then skipped — refunds only, or
       depletion switched off — still proves the webhook is wired up, and that
       is the question this record exists to answer. Recording it only on a
       successful deduction would make a correctly configured integration look
       dead on a day of nothing but refunds. */
    await noteDelivery(orgId, { at: Date.now(), receipts: parsed.receipts.length });

    /* The two settings that mean "do not write stock from sales". Off is a
       legitimate choice — a business keeping stock in the till, or one using
       the leakage screen, which needs actual and theoretical to come from
       different places — so this is acknowledged rather than refused. */
    const meta = await getMeta(orgId);
    if (meta.stockSource === "pos" || !meta.autoDepleteFromSales) {
      return res.status(200).json({ status: "depletion_disabled", received: parsed.receipts.length });
    }

    let posted = 0;
    let movements = 0;
    const unmatched = new Set();

    for (const [branchId, receipts] of byStore) {
      /* Already seen — an earlier delivery of the same event, a retry, or the
         poller getting there first. Filtered before posting so the response can
         say so, though `depleteFromSales` would refuse them anyway. */
      const seen = await postedIds(orgId, branchId);
      const fresh = receipts.filter((r) => !seen.has(r.id));
      if (!fresh.length) continue;

      const out = await depleteFromSales(orgId, branchId, fresh, {
        at: fresh[0].at,
        actor: "loyverse-webhook",
      });
      posted += out.posted;
      movements += out.movements;
      for (const name of out.unmatched) unmatched.add(name);

      if (out.movements) {
        await recordAudit(orgId, {
          actor: "loyverse-webhook",
          action: "stock.autoDeplete",
          detail: {
            branchId,
            receipts: out.posted,
            lines: out.movements,
            source: "webhook",
            receiptNumber: fresh.map((r) => r.id).join(","),
          },
        });
      }
    }

    return res.status(200).json({
      success: true,
      received: parsed.receipts.length,
      posted,
      movements,
      /* Refunds and cancellations, named. "My refunds do not affect stock" is
         a reasonable thing to be surprised by, so it is said rather than left
         to be inferred from a total that did not move. */
      skipped,
      /* Named rather than counted: a dish selling steadily with no recipe
         behind it is the single commonest reason stock stops depleting, and it
         is invisible unless something says so. */
      unmatched: [...unmatched],
    });
  } catch (err) {
    /* A 500 asks the sender to retry, which is right: the receipt is real and
       the failure is ours. Idempotency makes the retry safe. */
    console.error("loyverse webhook failed:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
